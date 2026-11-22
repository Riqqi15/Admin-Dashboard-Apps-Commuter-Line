import { parseEnv } from '../config/env';
import { createPrisma } from '../shared/infrastructure/prisma';
import { runRetention } from './retention-job';

async function main() {
  const config = parseEnv(process.env);
  const db = createPrisma(config.DATABASE_URL, 120_000);
  try {
    const result = await runRetention(db, new Date(), { dryRun: process.argv.includes('--dry-run') });
    console.info(JSON.stringify({ job: 'retention', ...result }));
  } finally {
    await db.$disconnect();
  }
}

main().catch((error: unknown) => {
  // Error class and code only: messages can echo SQL or connection details.
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : undefined;
  console.error('Retention job failed; review database availability and migration status.', { error: error instanceof Error ? error.name : 'unknown', code });
  process.exitCode = 1;
});
