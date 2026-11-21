import type { AuditTrail } from '../../../shared/application/audit-trail';
import type { PasswordHasher } from '../../../shared/application/password-hasher';
import type { TokenService } from '../../../shared/application/token-service';
import type { UnitOfWork } from '../../../shared/application/unit-of-work';
import { AppError, invalidSession } from '../../../shared/domain/errors';
import type { AuthContext } from '../../../shared/domain/roles';
import { accountCanSignIn, sessionLive, type AdminAccount } from '../../../shared/domain/session';
import { profile } from '../domain/profile';
import type { AuthRepository } from './auth-repository';

export type AuthRepositories = { auth: AuthRepository; audit: AuditTrail };

const invalidLogin = () => new AppError(401, 'INVALID_CREDENTIALS', 'Invalid username or password');
const SESSION_LIFETIME_MS = 8 * 3_600_000;

export function authUseCases(read: AuthRepository, uow: UnitOfWork<AuthRepositories>, hasher: PasswordHasher, tokens: TokenService) {
  // Unknown usernames still perform the same password KDF; this is not a usable account.
  const dummyHash = hasher.hash(tokens.generate());

  async function createSession(repository: AuthRepository, user: AdminAccount, expiresAt = new Date(Date.now() + SESSION_LIFETIME_MS)) {
    const token = tokens.generate();
    const csrfToken = tokens.generate();
    await repository.createSession({ adminUserId: user.id, tokenHash: tokens.hash('session', token), csrfTokenHash: tokens.hash('csrf', csrfToken), expiresAt });
    return { token, csrfToken, expiresAt, user: profile(user) };
  }

  return {
    async login(username: string, password: string) {
      const candidate = await read.findAccountByUsername(username);
      const valid = await hasher.verify(candidate?.passwordHash ?? await dummyHash, password);
      if (!candidate || !valid) throw invalidLogin();
      return uow.run(async ({ auth, audit }) => {
        // Station-before-user lock order also serializes login with station deactivation.
        if (candidate.stationId) await auth.lockStationShared(candidate.stationId);
        await auth.lockUser(candidate.id);
        const user = await auth.findAccount(candidate.id);
        if (!user || !accountCanSignIn(user) || user.username !== candidate.username || user.passwordHash !== candidate.passwordHash || user.stationId !== candidate.stationId) throw invalidLogin();
        await auth.recordLogin(user.id, new Date());
        await audit.record({ actorId: user.id, action: 'AUTH_LOGIN', entityType: 'admin_user', entityId: user.id, stationId: user.stationId });
        return createSession(auth, user);
      });
    },

    async logout(actor: AuthContext) {
      await uow.run(async ({ auth, audit }) => {
        if (actor.stationId) await auth.lockStationShared(actor.stationId);
        await auth.lockUser(actor.userId);
        await auth.revokeSession(actor.sessionId);
        await audit.record({ actorId: actor.userId, action: 'AUTH_LOGOUT', entityType: 'admin_user', entityId: actor.userId, stationId: actor.stationId });
      });
    },

    async changePassword(actor: AuthContext, currentPassword: string, newPassword: string) {
      const candidate = await read.findAccount(actor.userId);
      if (!candidate || !await hasher.verify(candidate.passwordHash, currentPassword)) throw invalidLogin();
      if (newPassword === currentPassword) throw new AppError(400, 'PASSWORD_REUSE', 'Choose a different password');
      const passwordHash = await hasher.hash(newPassword);
      return uow.run(async ({ auth, audit }) => {
        if (actor.stationId) await auth.lockStationShared(actor.stationId);
        await auth.lockUser(actor.userId);
        const session = await auth.findSessionById(actor.sessionId);
        const user = session?.adminUser;
        if (!session || !sessionLive(session) || !user || !accountCanSignIn(user) || user.passwordHash !== candidate.passwordHash || user.stationId !== actor.stationId) throw invalidSession();
        const updated = await auth.setPassword(user.id, passwordHash);
        await auth.revokeUserSessions(user.id);
        await audit.record({ actorId: user.id, action: 'AUTH_PASSWORD_CHANGED', entityType: 'admin_user', entityId: user.id, stationId: user.stationId });
        // Rotate the current cookie too, while preserving its original absolute expiry.
        return createSession(auth, updated, session.expiresAt);
      });
    },

    // Resolves a cookie token into the caller's context; a deactivated account or station revokes its sessions.
    async authenticate(token: string): Promise<AuthContext> {
      const session = await read.findSessionByTokenHash(tokens.hash('session', token));
      if (!session || !sessionLive(session)) throw invalidSession();
      const user = session.adminUser;
      if (!accountCanSignIn(user)) {
        await read.revokeUserSessions(user.id);
        throw invalidSession();
      }
      return Object.freeze({
        sessionId: session.id, userId: user.id, username: user.username, role: user.role, stationId: user.stationId,
        mustChangePassword: user.mustChangePassword, csrfTokenHash: session.csrfTokenHash, expiresAt: session.expiresAt,
      });
    },

    // Used by long-lived streams to notice revoked sessions, moved accounts and deactivated stations.
    async stillCurrent(actor: AuthContext) {
      const session = await read.findSessionById(actor.sessionId);
      const user = session?.adminUser;
      return Boolean(session && sessionLive(session) && user && accountCanSignIn(user) && !user.mustChangePassword
        && user.id === actor.userId && user.role === actor.role && user.stationId === actor.stationId);
    },
  };
}

export type AuthUseCases = ReturnType<typeof authUseCases>;
