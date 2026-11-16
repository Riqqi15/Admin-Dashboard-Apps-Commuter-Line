import { createHash, createHmac, randomUUID } from 'node:crypto';
import type { Env } from '../../config/env';
import type { CameraSession, Prisma, PrismaClient } from '../../generated/prisma/client';
import { AppError } from '../../http/errors';
import { lockStation, recordAudit } from '../../lib/admin-data';
import { decryptPii, encryptPii } from '../../lib/pii';
import { failureState } from '../alerts/alert-state';
import type { EventInput, SessionInput } from './ingest.schema';

const conflict = () => new AppError(409, 'IDEMPOTENCY_CONFLICT', 'Identifier was already used with a different payload');
const sourceAllowed = (session: CameraSession) => { if (session.source !== 'SIMULATOR') throw new AppError(403, 'INGEST_SOURCE_MISMATCH', 'Simulator credentials cannot access this session'); };
const publicSession = (session: CameraSession) => ({ id: session.id, externalSessionId: session.externalSessionId, stationId: session.stationId, status: session.status, startedAt: session.startedAt, expiresAt: session.expiresAt });
const fingerprint = (config: Env, type: string, value: object) => createHmac('sha256', config.SESSION_PEPPER).update('ingest:' + type + ':v1:' + JSON.stringify(value)).digest('hex');

async function lockIdentifier(tx: Prisma.TransactionClient, kind: string, id: string) {
  // Transaction-scoped advisory locks also serialize identifiers for rows that do not exist yet.
  const key = BigInt.asIntN(64, BigInt('0x' + createHash('sha256').update('timetable:' + kind + ':' + id).digest('hex').slice(0, 16)));
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(${key}::bigint)::text`;
}

function fresh(value: Date, now: Date) {
  if (Math.abs(value.getTime() - now.getTime()) > 5 * 60000) throw new AppError(400, 'TIMESTAMP_OUT_OF_RANGE', 'Timestamp must be within five minutes of server time');
}

export function ingestService(db: PrismaClient, config: Env) {
  return {
    async session(input: SessionInput) {
      const now = new Date();
      fresh(input.startedAt, now);
      const payloadFingerprint = fingerprint(config, 'session', { externalSessionId: input.externalSessionId, externalUserId: input.externalUserId, displayName: input.displayName, phone: input.phone ?? null, stationId: input.stationId, stationConfirmed: true, startedAt: input.startedAt.toISOString(), source: 'SIMULATOR' });
      return db.$transaction(async tx => {
        await lockIdentifier(tx, 'session', input.externalSessionId);
        const existing = await tx.cameraSession.findUnique({ where: { externalSessionId: input.externalSessionId } });
        if (existing) {
          sourceAllowed(existing);
          if (existing.payloadFingerprint !== payloadFingerprint) throw conflict();
          return { created: false, data: publicSession(existing) };
        }
        await lockStation(tx, input.stationId);
        const station = await tx.station.findUnique({ where: { id: input.stationId } });
        if (!station) throw new AppError(404, 'NOT_FOUND', 'Resource not found');
        if (!station.isActive) throw new AppError(400, 'STATION_INACTIVE', 'Station is inactive');
        await lockIdentifier(tx, 'user', input.externalUserId);
        const prior = await tx.trackedUser.findUnique({ where: { externalUserId: input.externalUserId } });
        const userId = prior?.id ?? randomUUID();
        const expiresAt = new Date(now.getTime() + 7 * 86400000);
        const pii = { displayNameCiphertext: encryptPii(input.displayName, config.PII_ENCRYPTION_KEY, 'user:' + userId + ':name'), phoneCiphertext: input.phone ? encryptPii(input.phone, config.PII_ENCRYPTION_KEY, 'user:' + userId + ':phone') : null, lastSeenAt: now, expiresAt };
        const user = prior ? await tx.trackedUser.update({ where: { id: userId }, data: pii }) : await tx.trackedUser.create({ data: { id: userId, externalUserId: input.externalUserId, ...pii } });
        const session = await tx.cameraSession.create({ data: { externalSessionId: input.externalSessionId, payloadFingerprint, trackedUserId: user.id, stationId: station.id, source: 'SIMULATOR', startedAt: input.startedAt, expiresAt } });
        return { created: true, data: publicSession(session) };
      });
    },

    async event(input: EventInput) {
      const now = new Date();
      fresh(input.occurredAt, now);
      const payloadFingerprint = fingerprint(config, 'event', { eventId: input.eventId, externalSessionId: input.externalSessionId, type: input.type, errorCode: input.errorCode ?? null, occurredAt: input.occurredAt.toISOString() });
      return db.$transaction(async tx => {
        // A global event ID is locked before choosing its session, including conflicting cross-session deliveries.
        await lockIdentifier(tx, 'event', input.eventId);
        const existing = await tx.cameraEvent.findUnique({ where: { eventId: input.eventId }, include: { cameraSession: { include: { alert: true } } } });
        if (existing) {
          sourceAllowed(existing.cameraSession);
          if (existing.payloadFingerprint !== payloadFingerprint) throw conflict();
          return { created: false, data: { id: existing.id, eventId: existing.eventId, sessionId: existing.cameraSessionId, consecutiveFailures: existing.cameraSession.consecutiveFailures, status: existing.cameraSession.status, alertId: existing.cameraSession.alert?.id ?? null } };
        }
        const candidate = await tx.cameraSession.findUnique({ where: { externalSessionId: input.externalSessionId } });
        if (!candidate) throw new AppError(404, 'NOT_FOUND', 'Resource not found');
        await lockStation(tx, candidate.stationId);
        await tx.$queryRaw`SELECT id FROM camera_sessions WHERE id = ${candidate.id}::uuid FOR UPDATE`;
        const session = await tx.cameraSession.findUniqueOrThrow({ where: { id: candidate.id }, include: { station: true, trackedUser: true, alert: true } });
        sourceAllowed(session);
        if (!session.station.isActive) throw new AppError(400, 'STATION_INACTIVE', 'Station is inactive');
        if (session.expiresAt <= now) throw new AppError(410, 'SESSION_EXPIRED', 'Camera session has expired');
        if (session.endedAt) throw new AppError(409, 'SESSION_CLOSED', 'Camera session has ended');
        const latest = await tx.cameraEvent.findFirst({ where: { cameraSessionId: session.id }, orderBy: { occurredAt: 'desc' } });
        if (input.occurredAt < session.startedAt || (latest && input.occurredAt < latest.occurredAt)) throw new AppError(409, 'EVENT_OUT_OF_ORDER', 'Event precedes session start or a previously accepted event');
        const event = await tx.cameraEvent.create({ data: { eventId: input.eventId, payloadFingerprint, cameraSessionId: session.id, type: input.type, errorCode: input.errorCode ?? null, occurredAt: input.occurredAt, expiresAt: session.expiresAt } });
        const state = failureState(session.consecutiveFailures, input.type);
        const failed = session.status === 'FAILED' || state.shouldAlert;
        const updated = await tx.cameraSession.update({ where: { id: session.id }, data: { consecutiveFailures: state.failures, status: failed ? 'FAILED' : input.type === 'SESSION_ENDED' ? 'COMPLETED' : 'ACTIVE', ...(input.type === 'SESSION_ENDED' ? { endedAt: input.occurredAt } : {}) } });
        let alertId = session.alert?.id ?? null;
        if (state.shouldAlert && !alertId) {
          alertId = randomUUID();
          const user = session.trackedUser;
          const name = decryptPii(user.displayNameCiphertext, config.PII_ENCRYPTION_KEY, 'user:' + user.id + ':name');
          const phone = user.phoneCiphertext ? decryptPii(user.phoneCiphertext, config.PII_ENCRYPTION_KEY, 'user:' + user.id + ':phone') : null;
          await tx.alert.create({ data: { id: alertId, cameraSessionId: session.id, sourceSessionId: session.id, stationId: session.stationId, trackedUserId: user.id, userNameCiphertext: encryptPii(name, config.PII_ENCRYPTION_KEY, 'alert:' + alertId + ':name'), userPhoneCiphertext: phone ? encryptPii(phone, config.PII_ENCRYPTION_KEY, 'alert:' + alertId + ':phone') : null, failureType: input.type as 'CAMERA_INIT_FAILED' | 'ANALYSIS_FAILED', errorCode: input.errorCode ?? null, expiresAt: new Date(now.getTime() + 30 * 86400000) } });
          await recordAudit(tx, null, 'ALERT_CREATED', 'alert', alertId, session.stationId);
        }
        await tx.trackedUser.update({ where: { id: session.trackedUserId }, data: { lastSeenAt: now, expiresAt: new Date(now.getTime() + 7 * 86400000) } });
        return { created: true, data: { id: event.id, eventId: event.eventId, sessionId: session.id, consecutiveFailures: state.failures, status: updated.status, alertId } };
      });
    },
  };
}
