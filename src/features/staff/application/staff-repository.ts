import type { NewStaff, StaffAccount, StaffChanges } from '../domain/staff';

export interface StaffRepository {
  list(filter: { stationId?: string | undefined }, page: { page: number; pageSize: number }): Promise<{ items: StaffAccount[]; total: number }>;
  findStaff(id: string): Promise<StaffAccount | null>;
  lockStationShared(stationId: string): Promise<void>;
  lockUser(userId: string): Promise<void>;
  stationStatus(stationId: string): Promise<{ isActive: boolean } | null>;
  create(input: NewStaff): Promise<StaffAccount>;
  update(id: string, changes: StaffChanges): Promise<StaffAccount>;
  setTemporaryPassword(id: string, passwordHash: string): Promise<StaffAccount>;
  revokeSessions(userId: string): Promise<void>;
}
