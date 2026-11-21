import { lockAlertForUpdate, lockStationShared, lockUser } from '../../../shared/infrastructure/locks';
import type { Tx } from '../../../shared/infrastructure/prisma-unit-of-work';
import { DAY_MS } from '../../../shared/domain/time';
import type { ActorRepository, AlertRepository } from '../application/ports';

const publicSelect = {
  id: true, cameraSessionId: true, stationId: true, failureType: true, errorCode: true,
  status: true, assignedToId: true, resolutionNote: true, createdAt: true,
  acknowledgedAt: true, resolvedAt: true, expiresAt: true,
} as const;

export const prismaAlertRepository = (db: Tx): AlertRepository => ({
  async list({ stationId, status, notExpiredAt }, { page, pageSize }) {
    const where = { ...(stationId ? { stationId } : {}), ...(status ? { status } : {}), expiresAt: { gt: notExpiredAt } };
    const items = await db.alert.findMany({ where, select: publicSelect, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], skip: (page - 1) * pageSize, take: pageSize });
    const total = await db.alert.count({ where });
    return { items, total };
  },

  async findStationId(id) {
    const row = await db.alert.findUnique({ where: { id }, select: { stationId: true } });
    return row?.stationId ?? null;
  },

  lockForUpdate: id => lockAlertForUpdate(db, id),
  find: id => db.alert.findUnique({ where: { id } }),

  acknowledge: (id, handlerId, at) => db.alert.update({ where: { id }, data: { status: 'ACKNOWLEDGED', assignedToId: handlerId, acknowledgedAt: at }, select: publicSelect }),
  resolve: (id, notes, at) => db.alert.update({ where: { id }, data: { status: 'RESOLVED', resolvedAt: at, resolutionNote: notes }, select: publicSelect }),

  async averageResponseSeconds(stationId, day) {
    const [aggregate] = await db.$queryRaw<Array<{ averageResponseSeconds: number | null }>>`
      SELECT ROUND(AVG(EXTRACT(EPOCH FROM (acknowledged_at - created_at))))::int AS "averageResponseSeconds"
      FROM alerts WHERE station_id = ${stationId}::uuid
        AND acknowledged_at >= ${day} AND acknowledged_at < ${new Date(day.getTime() + DAY_MS)}
    `;
    return aggregate?.averageResponseSeconds ?? null;
  },
});

export const prismaActorRepository = (db: Tx): ActorRepository => ({
  lockStationShared: stationId => lockStationShared(db, stationId),
  lockUser: userId => lockUser(db, userId),
  findSessionById: id => db.adminSession.findUnique({ where: { id }, include: { adminUser: { include: { station: true } } } }),
});
