import type { Role } from '../../../shared/domain/roles';

export type StaffAccount = Readonly<{
  id: string; username: string; role: Role; stationId: string | null;
  isActive: boolean; mustChangePassword: boolean; createdAt: Date;
}>;

export type NewStaff = Readonly<{ username: string; stationId: string; passwordHash: string }>;

export type StaffChanges = Readonly<{
  username?: string | undefined; stationId?: string | undefined; isActive?: boolean | undefined;
}>;
