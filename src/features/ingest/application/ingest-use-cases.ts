import type { AuditTrail } from '../../../shared/application/audit-trail';
import type { DailyUsage } from '../../../shared/application/daily-usage';
import type { IdGenerator } from '../../../shared/application/id-generator';
import type { PiiCipher } from '../../../shared/application/pii-cipher';
import type { UnitOfWork } from '../../../shared/application/unit-of-work';
import { AppError, notFound } from '../../../shared/domain/errors';
import { DAY_MS, utcDay } from '../../../shared/domain/time';
import { failureState } from '../../alerts/domain/alert-state';
import type { AlertEvent } from '../../alerts/domain/alert-event';
import type { AlertNotifier } from '../../alerts/application/ports';
import { assertFresh, assertSimulatorSource, idempotencyConflict, type EventInput, type SessionInput } from '../domain/ingest-rules';
import type { IngestRepository, PayloadFingerprint, StoredSession } from './ports';

export type IngestRepositories = { ingest: IngestRepository; audit: AuditTrail; usage: DailyUsage };

const publicSession = (session: StoredSession) => ({
  id: session.id, externalSessionId: session.externalSessionId, stationId: session.stationId,
  status: session.status, startedAt: session.startedAt, expiresAt: session.expiresAt,
});

export function ingestUseCases(uow: UnitOfWork<IngestRepositories>, cipher: PiiCipher, fingerprint: PayloadFingerprint, ids: IdGenerator, notifier: AlertNotifier) {
  return {
    async session(input: SessionInput) {
      const now = new Date();
      assertFresh(input.startedAt, now);
      const payloadFingerprint = fingerprint.of('session', {
        externalSessionId: input.externalSessionId, externalUserId: input.externalUserId, displayName: input.displayName,
        phone: input.phone ?? null, stationId: input.stationId, stationConfirmed: true, startedAt: input.startedAt.toISOString(), source: 'SIMULATOR',
      });
      return uow.run(async ({ ingest, usage }) => {
        await ingest.lockIdentifier('session', input.externalSessionId);
        const existing = await ingest.findSessionByExternalId(input.externalSessionId);
        if (existing) {
          assertSimulatorSource(existing.source);
          if (existing.payloadFingerprint !== payloadFingerprint) throw idempotencyConflict();
          return { created: false, data: publicSession(existing) };
        }
        await ingest.lockStationShared(input.stationId);
        const station = await ingest.findStation(input.stationId);
        if (!station) throw notFound();
        if (!station.isActive) throw new AppError(400, 'STATION_INACTIVE', 'Station is inactive');
        await ingest.lockIdentifier('user', input.externalUserId);
        const prior = await ingest.findTrackedUser(input.externalUserId);
        const userId = prior?.id ?? ids.newId();
        const expiresAt = new Date(now.getTime() + 7 * DAY_MS);
        const snapshot = {
          displayNameCiphertext: cipher.encrypt(input.displayName, `user:${userId}:name`),
          phoneCiphertext: input.phone ? cipher.encrypt(input.phone, `user:${userId}:phone`) : null,
          lastSeenAt: now, expiresAt,
        };
        const user = prior ? await ingest.updateTrackedUser(userId, snapshot) : await ingest.createTrackedUser(userId, input.externalUserId, snapshot);
        const session = await ingest.createSession({ externalSessionId: input.externalSessionId, payloadFingerprint, trackedUserId: user.id, stationId: station.id, startedAt: input.startedAt, expiresAt });
        const sawUserToday = await ingest.hadSessionOnDay(station.id, user.id, session.id, utcDay(input.startedAt));
        await usage.increment(station.id, input.startedAt, { sessionCount: 1, uniqueUserCount: sawUserToday ? 0 : 1 });
        return { created: true, data: publicSession(session) };
      });
    },

    async event(input: EventInput) {
      const now = new Date();
      assertFresh(input.occurredAt, now);
      const payloadFingerprint = fingerprint.of('event', {
        eventId: input.eventId, externalSessionId: input.externalSessionId, type: input.type,
        errorCode: input.errorCode ?? null, occurredAt: input.occurredAt.toISOString(),
      });
      const result = await uow.run(async ({ ingest, audit, usage }) => {
        // A global event ID is locked before choosing its session, including conflicting cross-session deliveries.
        await ingest.lockIdentifier('event', input.eventId);
        const existing = await ingest.findEventById(input.eventId);
        if (existing) {
          assertSimulatorSource(existing.cameraSession.source);
          if (existing.payloadFingerprint !== payloadFingerprint) throw idempotencyConflict();
          return {
            created: false, notification: undefined as AlertEvent | undefined,
            data: { id: existing.id, eventId: existing.eventId, sessionId: existing.cameraSessionId, consecutiveFailures: existing.cameraSession.consecutiveFailures, status: existing.cameraSession.status, alertId: existing.cameraSession.alert?.id ?? null },
          };
        }
        const candidate = await ingest.findSessionByExternalId(input.externalSessionId);
        if (!candidate) throw notFound();
        await ingest.lockStationShared(candidate.stationId);
        await ingest.lockSessionForUpdate(candidate.id);
        const session = await ingest.findSessionForEvent(candidate.id);
        assertSimulatorSource(session.source);
        if (!session.station.isActive) throw new AppError(400, 'STATION_INACTIVE', 'Station is inactive');
        if (session.expiresAt <= now) throw new AppError(410, 'SESSION_EXPIRED', 'Camera session has expired');
        if (session.endedAt) throw new AppError(409, 'SESSION_CLOSED', 'Camera session has ended');
        const latest = await ingest.findLatestEvent(session.id);
        if (input.occurredAt < session.startedAt || (latest && input.occurredAt < latest.occurredAt)) throw new AppError(409, 'EVENT_OUT_OF_ORDER', 'Event precedes session start or a previously accepted event');
        const event = await ingest.createEvent({ eventId: input.eventId, payloadFingerprint, cameraSessionId: session.id, type: input.type, errorCode: input.errorCode ?? null, occurredAt: input.occurredAt, expiresAt: session.expiresAt });
        const state = failureState(session.consecutiveFailures, input.type);
        const failed = session.status === 'FAILED' || state.shouldAlert;
        const updated = await ingest.updateSession(session.id, {
          consecutiveFailures: state.failures,
          status: failed ? 'FAILED' : input.type === 'SESSION_ENDED' ? 'COMPLETED' : 'ACTIVE',
          ...(input.type === 'SESSION_ENDED' ? { endedAt: input.occurredAt } : {}),
        });
        if (session.status !== 'FAILED' && updated.status === 'FAILED') await usage.increment(session.stationId, session.startedAt, { failedSessionCount: 1 });
        let alertId = session.alert?.id ?? null;
        let notification: AlertEvent | undefined;
        if (state.shouldAlert && !alertId) {
          alertId = ids.newId();
          const user = session.trackedUser;
          const name = cipher.decrypt(user.displayNameCiphertext, `user:${user.id}:name`);
          const phone = user.phoneCiphertext ? cipher.decrypt(user.phoneCiphertext, `user:${user.id}:phone`) : null;
          const alert = await ingest.createAlert({
            id: alertId, cameraSessionId: session.id, sourceSessionId: session.id, stationId: session.stationId, trackedUserId: user.id,
            userNameCiphertext: cipher.encrypt(name, `alert:${alertId}:name`),
            userPhoneCiphertext: phone ? cipher.encrypt(phone, `alert:${alertId}:phone`) : null,
            failureType: input.type, errorCode: input.errorCode ?? null, expiresAt: new Date(now.getTime() + 30 * DAY_MS),
          });
          await audit.record({ actorId: null, action: 'ALERT_CREATED', entityType: 'alert', entityId: alertId, stationId: session.stationId });
          await usage.increment(session.stationId, session.startedAt, { alertCount: 1 });
          notification = { type: 'alert.created', alertId, stationId: alert.stationId, status: alert.status, occurredAt: alert.createdAt.toISOString() };
        }
        await ingest.touchTrackedUser(session.trackedUserId, now, new Date(now.getTime() + 7 * DAY_MS));
        return { created: true, notification, data: { id: event.id, eventId: event.eventId, sessionId: session.id, consecutiveFailures: state.failures, status: updated.status, alertId } };
      });
      // Notify only after the transaction committed.
      if (result.notification) notifier.publish(result.notification);
      return { created: result.created, data: result.data };
    },
  };
}

export type IngestUseCases = ReturnType<typeof ingestUseCases>;
