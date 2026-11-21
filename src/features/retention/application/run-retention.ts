import type { AuditTrail } from '../../../shared/application/audit-trail';
import type { UnitOfWork } from '../../../shared/application/unit-of-work';
import { BATCH_SIZE, RETENTION_LOCK_KEY, piiCutoff } from '../domain/policy';
import type { RetentionStore } from './ports';

export type RetentionRepositories = { retention: RetentionStore; audit: AuditTrail };
export type RetentionResult = { dryRun: boolean; skipped: boolean; purgedAlertPii: number; deleted: Record<string, number> };

class DryRunRollback extends Error {
  constructor(readonly result: RetentionResult) { super('dry-run rollback'); }
}

async function drain(batch: () => Promise<number>) {
  let total = 0;
  for (;;) {
    const count = await batch();
    total += count;
    if (count < BATCH_SIZE) return total;
  }
}

async function work({ retention, audit }: RetentionRepositories, now: Date, dryRun: boolean): Promise<RetentionResult> {
  const deleted: Record<string, number> = {};
  deleted['expired alerts'] = await drain(() => retention.deleteExpiredAlerts(now, BATCH_SIZE));
  deleted['expired audit logs'] = await drain(() => retention.deleteExpiredAuditLogs(now, BATCH_SIZE));
  deleted['expired admin sessions'] = await drain(() => retention.deleteExpiredAdminSessions(now, BATCH_SIZE));
  const purgedAlertPii = await drain(() => retention.purgeAlertPii(now, piiCutoff(now), BATCH_SIZE));
  deleted['expired camera events'] = await drain(() => retention.deleteExpiredCameraEvents(now, BATCH_SIZE));
  deleted['expired camera sessions'] = await drain(() => retention.deleteExpiredCameraSessions(now, BATCH_SIZE));
  deleted['expired tracked users'] = await drain(() => retention.deleteExpiredTrackedUsers(now, BATCH_SIZE));
  const result: RetentionResult = { dryRun, skipped: false, purgedAlertPii, deleted };
  // Counts only: no row contents, so the audit trail never carries PII.
  if (!dryRun) await audit.record({ actorId: null, action: 'RETENTION_RUN', entityType: 'retention', entityId: null, stationId: null, details: { purgedAlertPii, deleted } });
  return result;
}

// One transaction under a transaction-scoped advisory lock: runs never overlap, a failure leaves nothing half-done,
// and a dry run executes the real statements then rolls them back, so its counts equal a real run's.
export function retentionUseCase(uow: UnitOfWork<RetentionRepositories>) {
  return {
    async run(now = new Date(), { dryRun = false } = {}): Promise<RetentionResult> {
      try {
        return await uow.run(async repositories => {
          if (!await repositories.retention.tryLock(RETENTION_LOCK_KEY)) return { dryRun, skipped: true, purgedAlertPii: 0, deleted: {} };
          const result = await work(repositories, now, dryRun);
          if (dryRun) throw new DryRunRollback(result);
          return result;
        });
      } catch (error) {
        if (error instanceof DryRunRollback) return error.result;
        throw error;
      }
    },
  };
}
