import type { PrismaClient } from '../generated/prisma/client';
import { retentionUseCase, type RetentionResult } from '../features/retention/application/run-retention';
import { RETENTION_LOCK_KEY } from '../features/retention/domain/policy';
import { prismaRetentionStore } from '../features/retention/infrastructure/prisma-retention-store';
import { prismaAuditTrail } from '../shared/infrastructure/prisma-audit-trail';
import { prismaUnitOfWork } from '../shared/infrastructure/prisma-unit-of-work';

export type { RetentionResult };
export const retentionLockKey = RETENTION_LOCK_KEY;

// Composition root of the retention worker: wires the use case to PostgreSQL.
export function runRetention(db: PrismaClient, now = new Date(), options: { dryRun?: boolean } = {}): Promise<RetentionResult> {
  const uow = prismaUnitOfWork(db, tx => ({ retention: prismaRetentionStore(tx), audit: prismaAuditTrail(tx) }), { timeout: 600_000, maxWait: 10_000 });
  return retentionUseCase(uow).run(now, options);
}
