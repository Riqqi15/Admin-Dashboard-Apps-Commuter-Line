import { parseEnv } from '../config/env';
import { createPrisma } from '../lib/prisma';

const batchSize = 500;

async function deleteExpired(
  label: string,
  removeBatch: () => Promise<number>,
) {
  let total = 0;
  for (;;) {
    const count = await removeBatch();
    total += count;
    if (count < batchSize) break;
  }
  console.info(JSON.stringify({ job: 'retention', step: label, deleted: total }));
  return [label, total] as const;
}

async function main() {
  const config = parseEnv(process.env);
  const db = createPrisma(config.DATABASE_URL);
  const now = new Date();
  try {
    const counts = [];
    counts.push(await deleteExpired('expired alerts', () => db.$executeRaw`
      DELETE FROM alerts WHERE id IN (
        SELECT id FROM alerts WHERE expires_at <= ${now} ORDER BY expires_at LIMIT ${batchSize}
      )`));
    counts.push(await deleteExpired('expired audit logs', () => db.$executeRaw`
      DELETE FROM audit_logs WHERE id IN (
        SELECT id FROM audit_logs WHERE expires_at <= ${now} ORDER BY expires_at LIMIT ${batchSize}
      )`));
    counts.push(await deleteExpired('expired admin sessions', () => db.$executeRaw`
      DELETE FROM admin_sessions WHERE id IN (
        SELECT id FROM admin_sessions WHERE expires_at <= ${now} OR revoked_at IS NOT NULL ORDER BY expires_at LIMIT ${batchSize}
      )`));

    let purgedPii = 0;
    for (;;) {
      const count = await db.$executeRaw`
        UPDATE alerts SET user_name_ciphertext = NULL, user_phone_ciphertext = NULL, pii_purged_at = ${now}
        WHERE id IN (
          SELECT id FROM alerts
          WHERE created_at <= ${new Date(now.getTime() - 7 * 86400000)}
            AND pii_purged_at IS NULL
            AND (user_name_ciphertext IS NOT NULL OR user_phone_ciphertext IS NOT NULL)
          ORDER BY created_at LIMIT ${batchSize}
        )`;
      purgedPii += count;
      if (count < batchSize) break;
    }
    console.info(JSON.stringify({ job: 'retention', step: 'purged alert PII', updated: purgedPii }));

    counts.push(await deleteExpired('expired camera events', () => db.$executeRaw`
      DELETE FROM camera_events WHERE id IN (
        SELECT id FROM camera_events WHERE expires_at <= ${now} ORDER BY expires_at LIMIT ${batchSize}
      )`));
    counts.push(await deleteExpired('expired camera sessions', () => db.$executeRaw`
      DELETE FROM camera_sessions WHERE id IN (
        SELECT id FROM camera_sessions WHERE expires_at <= ${now} ORDER BY expires_at LIMIT ${batchSize}
      )`));
    counts.push(await deleteExpired('expired tracked users', () => db.$executeRaw`
      DELETE FROM tracked_users WHERE id IN (
        SELECT id FROM tracked_users WHERE expires_at <= ${now} ORDER BY expires_at LIMIT ${batchSize}
      )`));

    console.info(JSON.stringify({ job: 'retention', purgedAlertPii: purgedPii, deleted: Object.fromEntries(counts) }));
  } finally {
    await db.$disconnect();
  }
}

main().catch(() => {
  console.error('Retention job failed; review database availability and migration status.');
  process.exitCode = 1;
});
