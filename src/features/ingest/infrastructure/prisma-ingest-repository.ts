import { createHash } from 'node:crypto';
import { DAY_MS } from '../../../shared/domain/time';
import { advisoryXactLock, lockCameraSessionForUpdate, lockStationShared } from '../../../shared/infrastructure/locks';
import type { Tx } from '../../../shared/infrastructure/prisma-unit-of-work';
import type { IngestRepository } from '../application/ports';

const advisoryKey = (kind: string, id: string) => BigInt.asIntN(64, BigInt('0x' + createHash('sha256').update('timetable:' + kind + ':' + id).digest('hex').slice(0, 16)));

export const prismaIngestRepository = (db: Tx): IngestRepository => ({
  lockIdentifier: (kind, id) => advisoryXactLock(db, advisoryKey(kind, id)),
  lockStationShared: stationId => lockStationShared(db, stationId),
  lockSessionForUpdate: sessionId => lockCameraSessionForUpdate(db, sessionId),

  findSessionByExternalId: externalSessionId => db.cameraSession.findUnique({ where: { externalSessionId } }),
  findEventById: eventId => db.cameraEvent.findUnique({ where: { eventId }, include: { cameraSession: { include: { alert: true } } } }),
  findStation: id => db.station.findUnique({ where: { id }, select: { id: true, isActive: true } }),
  findTrackedUser: externalUserId => db.trackedUser.findUnique({ where: { externalUserId }, select: { id: true } }),

  createTrackedUser: (id, externalUserId, snapshot) => db.trackedUser.create({ data: { id, externalUserId, ...snapshot }, select: { id: true } }),
  updateTrackedUser: (id, snapshot) => db.trackedUser.update({ where: { id }, data: snapshot, select: { id: true } }),
  async touchTrackedUser(id, lastSeenAt, expiresAt) {
    await db.trackedUser.update({ where: { id }, data: { lastSeenAt, expiresAt } });
  },

  createSession: input => db.cameraSession.create({ data: { ...input, source: 'SIMULATOR' } }),

  async hadSessionOnDay(stationId, trackedUserId, excludeSessionId, day) {
    const row = await db.cameraSession.findFirst({
      where: { id: { not: excludeSessionId }, stationId, trackedUserId, startedAt: { gte: day, lt: new Date(day.getTime() + DAY_MS) } },
      select: { id: true },
    });
    return row !== null;
  },

  findSessionForEvent: sessionId => db.cameraSession.findUniqueOrThrow({ where: { id: sessionId }, include: { station: true, trackedUser: true, alert: true } }),
  findLatestEvent: sessionId => db.cameraEvent.findFirst({ where: { cameraSessionId: sessionId }, orderBy: { occurredAt: 'desc' }, select: { occurredAt: true } }),
  createEvent: input => db.cameraEvent.create({ data: input, select: { id: true, eventId: true } }),

  updateSession: (sessionId, changes) => db.cameraSession.update({
    where: { id: sessionId },
    data: { consecutiveFailures: changes.consecutiveFailures, status: changes.status, ...(changes.endedAt ? { endedAt: changes.endedAt } : {}) },
    select: { status: true },
  }),

  createAlert: input => db.alert.create({ data: input, select: { stationId: true, status: true, createdAt: true } }),
});
