import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma/client';

// The API keeps a 3 s statement limit; the retention worker passes a longer one for its batch deletes.
export function createPrisma(connectionString: string, queryTimeoutMs = 3000) {
  const adapter = new PrismaPg({ connectionString, connectionTimeoutMillis: 3000, query_timeout: queryTimeoutMs, max: 5, idleTimeoutMillis: 10000 });
  return new PrismaClient({ adapter, log: [] });
}
