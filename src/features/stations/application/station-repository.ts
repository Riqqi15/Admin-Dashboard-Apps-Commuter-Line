import type { NewStation, Station, StationChanges } from '../domain/station';

export interface StationRepository {
  list(filter: { id?: string | undefined; activeOnly: boolean }, page: { page: number; pageSize: number }): Promise<{ items: Station[]; total: number }>;
  create(input: NewStation): Promise<Station>;
  // Row lock so concurrent updates and deactivations of the same station serialize.
  lockForUpdate(id: string): Promise<Station | null>;
  update(id: string, changes: StationChanges): Promise<Station>;
  revokeStaffSessions(stationId: string): Promise<void>;
}
