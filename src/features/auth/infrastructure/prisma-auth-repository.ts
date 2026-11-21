import { lockStationShared, lockUser } from '../../../shared/infrastructure/locks';
import type { Tx } from '../../../shared/infrastructure/prisma-unit-of-work';
import type { AuthRepository } from '../application/auth-repository';

const withStation = { station: true } as const;
const sessionInclude = { adminUser: { include: withStation } } as const;

export const prismaAuthRepository = (db: Tx): AuthRepository => ({
  findAccountByUsername: username => db.adminUser.findUnique({ where: { username }, include: withStation }),
  findAccount: id => db.adminUser.findUnique({ where: { id }, include: withStation }),
  lockStationShared: stationId => lockStationShared(db, stationId),
  lockUser: userId => lockUser(db, userId),

  async recordLogin(userId, at) {
    await db.adminUser.update({ where: { id: userId }, data: { lastLoginAt: at } });
  },

  async createSession(input) {
    await db.adminSession.create({ data: input });
  },

  findSessionByTokenHash: tokenHash => db.adminSession.findUnique({ where: { tokenHash }, include: sessionInclude }),
  findSessionById: id => db.adminSession.findUnique({ where: { id }, include: sessionInclude }),

  async revokeSession(id) {
    await db.adminSession.updateMany({ where: { id, revokedAt: null }, data: { revokedAt: new Date() } });
  },

  async revokeUserSessions(userId) {
    await db.adminSession.updateMany({ where: { adminUserId: userId, revokedAt: null }, data: { revokedAt: new Date() } });
  },

  setPassword: (userId, passwordHash) => db.adminUser.update({ where: { id: userId }, data: { passwordHash, mustChangePassword: false }, include: withStation }),
});
