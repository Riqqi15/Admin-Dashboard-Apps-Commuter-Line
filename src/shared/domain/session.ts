import type { Role } from './roles';

export type AdminAccount = Readonly<{
  id: string; username: string; passwordHash: string; role: Role; stationId: string | null;
  isActive: boolean; mustChangePassword: boolean; station: Readonly<{ isActive: boolean }> | null;
}>;

export type SessionRecord = Readonly<{
  id: string; adminUserId: string; tokenHash: string; csrfTokenHash: string;
  expiresAt: Date; revokedAt: Date | null; adminUser: AdminAccount;
}>;

// A station security account is only usable while both the account and its station are active.
export const accountCanSignIn = (user: AdminAccount) => user.isActive && !(user.role === 'STATION_SECURITY' && !user.station?.isActive);

export const sessionLive = (session: SessionRecord, now = new Date()) => !session.revokedAt && session.expiresAt > now;
