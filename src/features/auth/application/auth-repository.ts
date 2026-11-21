import type { AdminAccount, SessionRecord } from '../../../shared/domain/session';

export interface AuthRepository {
  findAccountByUsername(username: string): Promise<AdminAccount | null>;
  findAccount(id: string): Promise<AdminAccount | null>;
  lockStationShared(stationId: string): Promise<void>;
  lockUser(userId: string): Promise<void>;
  recordLogin(userId: string, at: Date): Promise<void>;
  createSession(input: { adminUserId: string; tokenHash: string; csrfTokenHash: string; expiresAt: Date }): Promise<void>;
  findSessionByTokenHash(tokenHash: string): Promise<SessionRecord | null>;
  findSessionById(id: string): Promise<SessionRecord | null>;
  revokeSession(id: string): Promise<void>;
  revokeUserSessions(userId: string): Promise<void>;
  setPassword(userId: string, passwordHash: string): Promise<AdminAccount>;
}
