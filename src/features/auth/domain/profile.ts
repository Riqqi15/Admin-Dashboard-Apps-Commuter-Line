import type { Role } from '../../../shared/domain/roles';
import type { AdminAccount } from '../../../shared/domain/session';

export type Profile = Readonly<{ id: string; username: string; role: Role; stationId: string | null; mustChangePassword: boolean }>;

// The only account fields that ever leave the API: no hash, token or internal flag.
export const profile = (user: AdminAccount): Profile => ({
  id: user.id, username: user.username, role: user.role, stationId: user.stationId, mustChangePassword: user.mustChangePassword,
});
