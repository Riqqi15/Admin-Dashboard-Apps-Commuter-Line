import { parseEnv } from '../config/env';
import { createPrisma } from '../shared/infrastructure/prisma';
import { runRetention } from './retention-job';

async function main() {
  const config = parseEnv(process.env);
  const db = createPrisma(config.DATABASE_URL);
  try {
    const result = await runRetention(db, new Date(), { dryRun: process.argv.includes('--dry-run') });
    console.info(JSON.stringify({ job: 'retention', ...result }));
  } finally {
    await db.$disconnect();
  }
}

main().catch(() => {
  console.error('Retention job failed; review database availability and migration status.');
  process.exitCode = 1;
});
