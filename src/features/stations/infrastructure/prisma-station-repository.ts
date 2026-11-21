import { lockStationForUpdate } from '../../../shared/infrastructure/locks';
import type { Tx } from '../../../shared/infrastructure/prisma-unit-of-work';
import type { StationRepository } from '../application/station-repository';

export const prismaStationRepository = (db: Tx): StationRepository => ({
  async list({ id, activeOnly }, { page, pageSize }) {
    const where = { ...(id ? { id } : {}), ...(activeOnly ? { isActive: true } : {}) };
    const items = await db.station.findMany({ where, orderBy: { code: 'asc' }, skip: (page - 1) * pageSize, take: pageSize });
    const total = await db.station.count({ where });
    return { items, total };
  },

  create: input => db.station.create({ data: input }),

  async lockForUpdate(id) {
    await lockStationForUpdate(db, id);
    return db.station.findUnique({ where: { id } });
  },

  update: (id, changes) => db.station.update({ where: { id }, data: {
    ...(changes.code !== undefined ? { code: changes.code } : {}),
    ...(changes.name !== undefined ? { name: changes.name } : {}),
    ...(changes.isActive !== undefined ? { isActive: changes.isActive } : {}),
  } }),

  async revokeStaffSessions(stationId) {
    await db.adminSession.updateMany({ where: { adminUser: { stationId }, revokedAt: null }, data: { revokedAt: new Date() } });
  },
});
