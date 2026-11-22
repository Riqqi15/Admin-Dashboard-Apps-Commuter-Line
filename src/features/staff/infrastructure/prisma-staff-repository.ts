import { lockStationShared, lockUser } from '../../../shared/infrastructure/locks';
import type { Tx } from '../../../shared/infrastructure/prisma-unit-of-work';
import type { StaffRepository } from '../application/staff-repository';

const staffSelect = { id: true, username: true, role: true, stationId: true, isActive: true, mustChangePassword: true, createdAt: true, lastLoginAt: true } as const;

export const prismaStaffRepository = (db: Tx): StaffRepository => ({
  async list({ stationId }, { page, pageSize }) {
    const where = { role: 'STATION_SECURITY' as const, ...(stationId ? { stationId } : {}) };
    const items = await db.adminUser.findMany({ where, select: staffSelect, orderBy: { username: 'asc' }, skip: (page - 1) * pageSize, take: pageSize });
    const total = await db.adminUser.count({ where });
    return { items, total };
  },

  findStaff: id => db.adminUser.findUnique({ where: { id }, select: staffSelect }),
  lockStationShared: stationId => lockStationShared(db, stationId),
  lockUser: userId => lockUser(db, userId),
  stationStatus: stationId => db.station.findUnique({ where: { id: stationId }, select: { isActive: true } }),

  create: ({ username, stationId, passwordHash }) => db.adminUser.create({
    data: { username, stationId, passwordHash, role: 'STATION_SECURITY', mustChangePassword: true }, select: staffSelect,
  }),

  update: (id, changes) => db.adminUser.update({ where: { id }, data: {
    ...(changes.username !== undefined ? { username: changes.username } : {}),
    ...(changes.stationId !== undefined ? { stationId: changes.stationId } : {}),
    ...(changes.isActive !== undefined ? { isActive: changes.isActive } : {}),
  }, select: staffSelect }),

  setTemporaryPassword: (id, passwordHash) => db.adminUser.update({ where: { id }, data: { passwordHash, mustChangePassword: true }, select: staffSelect }),

  async revokeSessions(userId) {
    await db.adminSession.updateMany({ where: { adminUserId: userId, revokedAt: null }, data: { revokedAt: new Date() } });
  },
});
