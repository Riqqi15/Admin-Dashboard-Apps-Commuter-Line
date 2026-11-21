import type { AuditTrail } from '../../../shared/application/audit-trail';
import type { UnitOfWork } from '../../../shared/application/unit-of-work';
import { notFound } from '../../../shared/domain/errors';
import type { AuthContext } from '../../../shared/domain/roles';
import { stationScope } from '../../../shared/domain/station-scope';
import type { NewStation, StationChanges } from '../domain/station';
import type { StationRepository } from './station-repository';

export type StationRepositories = { stations: StationRepository; audit: AuditTrail };

export function stationUseCases(uow: UnitOfWork<StationRepositories>) {
  return {
    list(auth: AuthContext, query: { page: number; pageSize: number; stationId?: string | undefined }) {
      const id = stationScope(auth, query.stationId);
      return uow.run(({ stations }) => stations.list({ id, activeOnly: auth.role === 'STATION_SECURITY' }, query));
    },

    create(actor: AuthContext, input: NewStation) {
      return uow.run(async ({ stations, audit }) => {
        const created = await stations.create(input);
        await audit.record({ actorId: actor.userId, action: 'STATION_CREATED', entityType: 'station', entityId: created.id, stationId: created.id });
        return created;
      });
    },

    update(actor: AuthContext, id: string, changes: StationChanges) {
      return uow.run(async ({ stations, audit }) => {
        if (!await stations.lockForUpdate(id)) throw notFound();
        const updated = await stations.update(id, changes);
        // Deactivating a station signs out everyone assigned to it.
        if (changes.isActive === false) await stations.revokeStaffSessions(id);
        await audit.record({ actorId: actor.userId, action: 'STATION_UPDATED', entityType: 'station', entityId: id, stationId: id });
        return updated;
      });
    },
  };
}

export type StationUseCases = ReturnType<typeof stationUseCases>;
