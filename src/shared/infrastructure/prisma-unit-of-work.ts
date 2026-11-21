import type { Prisma, PrismaClient } from '../../generated/prisma/client';
import type { UnitOfWork } from '../application/unit-of-work';

export type Tx = Prisma.TransactionClient;

export function prismaUnitOfWork<Repositories>(
  db: PrismaClient,
  bind: (tx: Tx) => Repositories,
  options?: { timeout?: number; maxWait?: number },
): UnitOfWork<Repositories> {
  return { run: work => db.$transaction(tx => work(bind(tx)), options) };
}
