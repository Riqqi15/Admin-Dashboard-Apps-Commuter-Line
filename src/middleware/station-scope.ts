import type { AuthContext } from '../features/auth/auth.service';
import { AppError } from '../http/errors';

export function stationScope(auth: AuthContext, requestedStationId?: string) {
  if (auth.role === 'SUPER_ADMIN') return requestedStationId;
  if (requestedStationId !== undefined) throw new AppError(403, 'FORBIDDEN', 'Station scope is assigned by the server');
  if (!auth.stationId) throw new AppError(403, 'FORBIDDEN', 'Station assignment required');
  return auth.stationId;
}
