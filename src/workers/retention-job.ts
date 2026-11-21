import type { Prisma, PrismaClient } from '../generated/prisma/client';

const batchSize = 500;
// Arbitrary constant shared by every retention process so two runs can never overlap.
export const retentionLockKey = 4_207_001;

export type RetentionResult = { dryRun: boolean; skipped: boolean; purgedAlertPii: number; deleted: Record<string, number> };

class DryRunRollback extends Error {
  constructor(readonly result: RetentionResult) { super('dry-run rollback'); }
}

async function deleteExpired(label: string, removeBatch: () => Promise<number>) {
  let total = 0;
  for (;;) {
    const count = await removeBatch();
    total += count;
    if (count < batchSize) break;
  }
  console.info(JSON.stringify({ job: 'retention', step: label, deleted: total }));
  return [label, total] as const;
}

// Order matters: camera events reference sessions (RESTRICT) and sessions reference tracked users.
async function work(tx: Prisma.TransactionClient, now: Date, dryRun: boolean): Promise<RetentionResult> {
  const counts = [];
  counts.push(await deleteExpired('expired alerts', () => tx.$executeRaw`
    DELETE FROM alerts WHERE id IN (
      SELECT id FROM alerts WHERE expires_at <= ${now} ORDER BY expires_at LIMIT ${batchSize}
    )`));
  counts.push(await deleteExpired('expired audit logs', () => tx.$executeRaw`
    DELETE FROM audit_logs WHERE id IN (
      SELECT id FROM audit_logs WHERE expires_at <= ${now} ORDER BY expires_at LIMIT ${batchSize}
    )`));
  counts.push(await deleteExpired('expired admin sessions', () => tx.$executeRaw`
    DELETE FROM admin_sessions WHERE id IN (
      SELECT id FROM admin_sessions WHERE expires_at <= ${now} OR revoked_at IS NOT NULL ORDER BY expires_at LIMIT ${batchSize}
    )`));

  // Purging also detaches the alert from the passenger record; COALESCE keeps the first purge time.
  let purgedAlertPii = 0;
  for (;;) {
    const count = await tx.$executeRaw`
      UPDATE alerts SET user_name_ciphertext = NULL, user_phone_ciphertext = NULL, tracked_user_id = NULL,
        pii_purged_at = COALESCE(pii_purged_at, ${now})
      WHERE id IN (
        SELECT id FROM alerts
        WHERE created_at <= ${new Date(now.getTime() - 7 * 86400000)}
          AND (user_name_ciphertext IS NOT NULL OR user_phone_ciphertext IS NOT NULL OR tracked_user_id IS NOT NULL)
        ORDER BY created_at LIMIT ${batchSize}
      )`;
    purgedAlertPii += count;
    if (count < batchSize) break;
  }
  console.info(JSON.stringify({ job: 'retention', step: 'purged alert PII', updated: purgedAlertPii }));

  counts.push(await deleteExpired('expired camera events', () => tx.$executeRaw`
    DELETE FROM camera_events WHERE id IN (
      SELECT id FROM camera_events WHERE expires_at <= ${now} ORDER BY expires_at LIMIT ${batchSize}
    )`));
  counts.push(await deleteExpired('expired camera sessions', () => tx.$executeRaw`
    DELETE FROM camera_sessions WHERE id IN (
      SELECT id FROM camera_sessions WHERE expires_at <= ${now} ORDER BY expires_at LIMIT ${batchSize}
    )`));
  counts.push(await deleteExpired('expired tracked users', () => tx.$executeRaw`
    DELETE FROM tracked_users WHERE id IN (
      SELECT id FROM tracked_users WHERE expires_at <= ${now} ORDER BY expires_at LIMIT ${batchSize}
    )`));

  const result: RetentionResult = { dryRun, skipped: false, purgedAlertPii, deleted: Object.fromEntries(counts) };
  if (!dryRun) {
    // Counts only: no row contents, so the audit trail never carries PII.
    await tx.auditLog.create({ data: { action: 'RETENTION_RUN', entityType: 'retention', details: { purgedAlertPii, deleted: result.deleted }, expiresAt: new Date(now.getTime() + 30 * 86400000) } });
  }
  return result;
}

// One transaction under a transaction-scoped advisory lock: runs never overlap, a failure leaves nothing half-done,
// and a dry run executes the real statements then rolls them back, so its counts equal a real run's.
export async function runRetention(db: PrismaClient, now = new Date(), { dryRun = false } = {}): Promise<RetentionResult> {
  try {
    return await db.$transaction(async tx => {
      const [lock] = await tx.$queryRaw<Array<{ locked: boolean }>>`SELECT pg_try_advisory_xact_lock(${retentionLockKey}::bigint) AS locked`;
      if (!lock?.locked) return { dryRun, skipped: true, purgedAlertPii: 0, deleted: {} };
      const result = await work(tx, now, dryRun);
      if (dryRun) throw new DryRunRollback(result);
      return result;
    }, { timeout: 600_000, maxWait: 10_000 });
  } catch (error) {
    if (error instanceof DryRunRollback) return error.result;
    throw error;
  }
}
