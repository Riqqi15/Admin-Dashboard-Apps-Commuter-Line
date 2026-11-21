import type { AuditTrail } from '../../../shared/application/audit-trail';
import type { DailyUsage } from '../../../shared/application/daily-usage';
import type { PiiCipher } from '../../../shared/application/pii-cipher';
import type { UnitOfWork } from '../../../shared/application/unit-of-work';
import { AppError, invalidSession, notFound } from '../../../shared/domain/errors';
import type { AuthContext } from '../../../shared/domain/roles';
import { accountCanSignIn, sessionLive } from '../../../shared/domain/session';
import { stationScope } from '../../../shared/domain/station-scope';
import { utcDay } from '../../../shared/domain/time';
import { CrossStationDenied, piiVisible, publicAlert, type AlertStatus } from '../domain/alert';
import { assertAlertTransition } from '../domain/alert-state';
import type { ActorRepository, AlertNotifier, AlertRepository } from './ports';

export type AlertRepositories = { alerts: AlertRepository; actors: ActorRepository; audit: AuditTrail; usage: DailyUsage };

// Station -> account -> alert is the same lock order as staff reassignment.
// Revalidate after taking the account lock: middleware authentication can become stale.
async function currentActor(actors: ActorRepository, auth: AuthContext, stationId?: string) {
  if (stationId) await actors.lockStationShared(stationId);
  await actors.lockUser(auth.userId);
  const session = await actors.findSessionById(auth.sessionId);
  if (!session || session.adminUserId !== auth.userId || !sessionLive(session)) throw invalidSession();
  const user = session.adminUser;
  if (!accountCanSignIn(user)) throw invalidSession();
  if (user.mustChangePassword) throw new AppError(403, 'PASSWORD_CHANGE_REQUIRED', 'Change your temporary password first');
  return { ...auth, role: user.role, stationId: user.stationId };
}

async function accessibleAlert(repositories: AlertRepositories, auth: AuthContext, id: string) {
  const stationId = await repositories.alerts.findStationId(id);
  if (!stationId) throw notFound();
  const actor = await currentActor(repositories.actors, auth, stationId);
  await repositories.alerts.lockForUpdate(id);
  const alert = await repositories.alerts.find(id);
  if (!alert || alert.expiresAt <= new Date()) throw notFound();
  if (actor.role === 'STATION_SECURITY' && actor.stationId !== alert.stationId) throw new CrossStationDenied(alert.stationId);
  return { actor, alert };
}

export function alertUseCases(uow: UnitOfWork<AlertRepositories>, cipher: PiiCipher, notifier: AlertNotifier) {
  // The failed transaction rolls back, so the denial is recorded on its own afterwards.
  async function guarded<T>(auth: AuthContext, id: string, run: () => Promise<T>) {
    try {
      return await run();
    } catch (error) {
      if (error instanceof CrossStationDenied) {
        await uow.run(({ audit }) => audit.record({ actorId: auth.userId, action: 'ALERT_ACCESS_DENIED', entityType: 'alert', entityId: id, stationId: error.alertStationId }));
      }
      throw error;
    }
  }

  const announce = (alert: { id: string; stationId: string; status: AlertStatus }) =>
    notifier.publish({ type: 'alert.updated', alertId: alert.id, stationId: alert.stationId, status: alert.status, occurredAt: new Date().toISOString() });

  return {
    list(auth: AuthContext, query: { page: number; pageSize: number; stationId?: string | undefined; status?: AlertStatus | undefined }) {
      return uow.run(async repositories => {
        const actor = await currentActor(repositories.actors, auth, auth.role === 'STATION_SECURITY' ? auth.stationId ?? undefined : undefined);
        const stationId = stationScope(actor, query.stationId);
        const { items, total } = await repositories.alerts.list({ stationId, status: query.status, notExpiredAt: new Date() }, query);
        return { items, total, page: query.page, pageSize: query.pageSize };
      });
    },

    detail(auth: AuthContext, id: string) {
      return guarded(auth, id, () => uow.run(async repositories => {
        const { alert } = await accessibleAlert(repositories, auth, id);
        const user = piiVisible(alert) ? {
          displayName: cipher.decrypt(alert.userNameCiphertext!, `alert:${alert.id}:name`),
          phone: alert.userPhoneCiphertext ? cipher.decrypt(alert.userPhoneCiphertext, `alert:${alert.id}:phone`) : null,
        } : null;
        return { ...publicAlert(alert), user };
      }));
    },

    async acknowledge(auth: AuthContext, id: string) {
      const updated = await guarded(auth, id, () => uow.run(async repositories => {
        const { actor, alert } = await accessibleAlert(repositories, auth, id);
        if (alert.status !== 'NEW') throw new AppError(409, 'ALERT_ALREADY_ACKNOWLEDGED', 'Alert has already been claimed');
        const result = await repositories.alerts.acknowledge(id, actor.userId, new Date());
        await repositories.audit.record({ actorId: actor.userId, action: 'ALERT_ACKNOWLEDGED', entityType: 'alert', entityId: id, stationId: alert.stationId });
        const day = utcDay(result.acknowledgedAt!);
        await repositories.usage.setAverageResponseSeconds(alert.stationId, day, await repositories.alerts.averageResponseSeconds(alert.stationId, day));
        return result;
      }));
      announce(updated);
      return updated;
    },

    async resolve(auth: AuthContext, id: string, notes: string) {
      const updated = await guarded(auth, id, () => uow.run(async repositories => {
        const { actor, alert } = await accessibleAlert(repositories, auth, id);
        assertAlertTransition(alert.status, 'RESOLVED');
        if (actor.role !== 'SUPER_ADMIN' && alert.assignedToId !== actor.userId) throw new AppError(403, 'FORBIDDEN', 'Only the assigned handler can resolve this alert');
        const result = await repositories.alerts.resolve(id, notes, new Date());
        await repositories.audit.record({ actorId: actor.userId, action: 'ALERT_RESOLVED', entityType: 'alert', entityId: id, stationId: alert.stationId });
        await repositories.usage.increment(alert.stationId, result.resolvedAt!, { resolvedAlertCount: 1 });
        return result;
      }));
      announce(updated);
      return updated;
    },
  };
}

export type AlertUseCases = ReturnType<typeof alertUseCases>;
