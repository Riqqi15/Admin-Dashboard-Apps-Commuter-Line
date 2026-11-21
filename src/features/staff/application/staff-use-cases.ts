import type { AuditTrail } from '../../../shared/application/audit-trail';
import type { PasswordHasher } from '../../../shared/application/password-hasher';
import type { UnitOfWork } from '../../../shared/application/unit-of-work';
import { AppError, notFound } from '../../../shared/domain/errors';
import type { AuthContext } from '../../../shared/domain/roles';
import type { StaffChanges } from '../domain/staff';
import type { StaffRepository } from './staff-repository';

export type StaffRepositories = { staff: StaffRepository; audit: AuditTrail };

async function activeStation(staff: StaffRepository, id: string) {
  await staff.lockStationShared(id);
  const station = await staff.stationStatus(id);
  if (!station) throw notFound();
  if (!station.isActive) throw new AppError(400, 'STATION_INACTIVE', 'Choose an active station');
}

async function staffAccount(staff: StaffRepository, id: string, destinationId?: string) {
  const candidate = await staff.findStaff(id);
  if (!candidate || candidate.role !== 'STATION_SECURITY') throw notFound();
  // Always lock stations before users/sessions, including the source station on moves, in a stable order.
  const stationIds = [...new Set([candidate.stationId, destinationId].filter((value): value is string => Boolean(value)))].sort();
  for (const stationId of stationIds) await staff.lockStationShared(stationId);
  await staff.lockUser(id);
  const user = await staff.findStaff(id);
  if (!user || user.role !== 'STATION_SECURITY') throw notFound();
  if (user.stationId !== candidate.stationId) throw new AppError(409, 'CONFLICT', 'Account assignment changed; retry the request');
  return user;
}

export function staffUseCases(uow: UnitOfWork<StaffRepositories>, hasher: PasswordHasher) {
  return {
    list(page: number, pageSize: number, stationId?: string) {
      return uow.run(({ staff }) => staff.list({ stationId }, { page, pageSize }));
    },

    async create(actor: AuthContext, input: { username: string; password: string; stationId: string }) {
      const passwordHash = await hasher.hash(input.password);
      return uow.run(async ({ staff, audit }) => {
        await activeStation(staff, input.stationId);
        const user = await staff.create({ username: input.username, stationId: input.stationId, passwordHash });
        await audit.record({ actorId: actor.userId, action: 'STAFF_CREATED', entityType: 'admin_user', entityId: user.id, stationId: user.stationId });
        return user;
      });
    },

    update(actor: AuthContext, id: string, changes: StaffChanges) {
      return uow.run(async ({ staff, audit }) => {
        const current = await staffAccount(staff, id, changes.stationId);
        if (changes.stationId || changes.isActive === true) await activeStation(staff, changes.stationId || current.stationId!);
        const user = await staff.update(id, changes);
        await staff.revokeSessions(id);
        await audit.record({ actorId: actor.userId, action: 'STAFF_UPDATED', entityType: 'admin_user', entityId: user.id, stationId: user.stationId });
        return user;
      });
    },

    async resetPassword(actor: AuthContext, id: string, password: string) {
      const passwordHash = await hasher.hash(password);
      return uow.run(async ({ staff, audit }) => {
        await staffAccount(staff, id);
        const user = await staff.setTemporaryPassword(id, passwordHash);
        await staff.revokeSessions(id);
        await audit.record({ actorId: actor.userId, action: 'STAFF_PASSWORD_RESET', entityType: 'admin_user', entityId: id, stationId: user.stationId });
        return user;
      });
    },
  };
}

export type StaffUseCases = ReturnType<typeof staffUseCases>;
