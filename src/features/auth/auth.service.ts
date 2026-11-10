import { createHmac, randomBytes } from 'node:crypto';
import { verify } from 'argon2';
import type { Env } from '../../config/env';
import type { AdminUser, Prisma, PrismaClient } from '../../generated/prisma/client';
import { AppError } from '../../http/errors';
import { lockStation, lockUser, recordAudit } from '../../lib/admin-data';
import { hashPassword } from '../../lib/password';

export type AuthContext = Readonly<{
  sessionId: string; userId: string; username: string; role: AdminUser['role']; stationId: string | null;
  mustChangePassword: boolean; csrfTokenHash: string; expiresAt: Date;
}>;

export const profile = (user: AdminUser) => ({ id: user.id, username: user.username, role: user.role, stationId: user.stationId, mustChangePassword: user.mustChangePassword });
export const tokenHash = (config: Env, purpose: 'session' | 'csrf', token: string) => createHmac('sha256', config.SESSION_PEPPER).update(purpose + ':' + token).digest('hex');
const invalidLogin = () => new AppError(401, 'INVALID_CREDENTIALS', 'Invalid username or password');
export const invalidSession = () => new AppError(401, 'UNAUTHENTICATED', 'Authentication required');

export function authService(db: PrismaClient, config: Env) {
  // Unknown usernames still perform the same password KDF; this is not a usable account.
  const dummyHash = hashPassword(randomBytes(32).toString('hex'));

  async function createSession(tx: Prisma.TransactionClient, user: AdminUser, expiresAt = new Date(Date.now() + 8 * 3600000)) {
    const token = randomBytes(32).toString('hex');
    const csrfToken = randomBytes(32).toString('hex');
    await tx.adminSession.create({ data: { adminUserId: user.id, tokenHash: tokenHash(config, 'session', token), csrfTokenHash: tokenHash(config, 'csrf', csrfToken), expiresAt } });
    return { token, csrfToken, expiresAt, user: profile(user) };
  }

  return {
    async login(username: string, password: string) {
      const candidate = await db.adminUser.findUnique({ where: { username } });
      const valid = await verify(candidate?.passwordHash ?? await dummyHash, password);
      if (!candidate || !valid) throw invalidLogin();
      return db.$transaction(async tx => {
        // Station-before-user lock order also serializes login with station deactivation.
        if (candidate.stationId) await lockStation(tx, candidate.stationId);
        await lockUser(tx, candidate.id);
        const user = await tx.adminUser.findUnique({ where: { id: candidate.id }, include: { station: true } });
        if (!user || !user.isActive || user.username !== candidate.username || user.passwordHash !== candidate.passwordHash || user.stationId !== candidate.stationId || (user.role === 'STATION_SECURITY' && !user.station?.isActive)) throw invalidLogin();
        await tx.adminUser.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
        await recordAudit(tx, user.id, 'AUTH_LOGIN', 'admin_user', user.id, user.stationId);
        return createSession(tx, user);
      });
    },

    async logout(auth: AuthContext) {
      await db.$transaction(async tx => {
        if (auth.stationId) await lockStation(tx, auth.stationId);
        await lockUser(tx, auth.userId);
        await tx.adminSession.updateMany({ where: { id: auth.sessionId, revokedAt: null }, data: { revokedAt: new Date() } });
        await recordAudit(tx, auth.userId, 'AUTH_LOGOUT', 'admin_user', auth.userId, auth.stationId);
      });
    },

    async changePassword(auth: AuthContext, currentPassword: string, password: string) {
      const candidate = await db.adminUser.findUnique({ where: { id: auth.userId } });
      if (!candidate || !await verify(candidate.passwordHash, currentPassword)) throw invalidLogin();
      if (password === currentPassword) throw new AppError(400, 'PASSWORD_REUSE', 'Choose a different password');
      const passwordHash = await hashPassword(password);
      return db.$transaction(async tx => {
        if (auth.stationId) await lockStation(tx, auth.stationId);
        await lockUser(tx, auth.userId);
        const session = await tx.adminSession.findUnique({ where: { id: auth.sessionId }, include: { adminUser: { include: { station: true } } } });
        const user = session?.adminUser;
        if (!session || session.revokedAt || session.expiresAt <= new Date() || !user?.isActive || user.passwordHash !== candidate.passwordHash || user.stationId !== auth.stationId || (user.role === 'STATION_SECURITY' && !user.station?.isActive)) throw invalidSession();
        const updated = await tx.adminUser.update({ where: { id: user.id }, data: { passwordHash, mustChangePassword: false } });
        await tx.adminSession.updateMany({ where: { adminUserId: user.id, revokedAt: null }, data: { revokedAt: new Date() } });
        await recordAudit(tx, user.id, 'AUTH_PASSWORD_CHANGED', 'admin_user', user.id, user.stationId);
        // Rotate the current cookie too, while preserving its original absolute expiry.
        return createSession(tx, updated, session.expiresAt);
      });
    },
  };
}
