import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';

export function createPrisma(connectionString: string) {
  const adapter = new PrismaPg({ connectionString, connectionTimeoutMillis: 3000, query_timeout: 3000, max: 5, idleTimeoutMillis: 10000 });
  return new PrismaClient({ adapter, log: [] });
}
