import type { Prisma } from '../generated/prisma/client';

export function utcDay(value: Date) {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

export async function incrementDailyUsage(
  tx: Prisma.TransactionClient,
  stationId: string,
  value: Date,
  delta: { sessionCount?: number; uniqueUserCount?: number; failedSessionCount?: number; alertCount?: number; resolvedAlertCount?: number },
) {
  const statDate = utcDay(value);
  return tx.dailyUsageStat.upsert({
    where: { stationId_statDate: { stationId, statDate } },
    create: { stationId, statDate, ...delta },
    update: {
      ...(delta.sessionCount ? { sessionCount: { increment: delta.sessionCount } } : {}),
      ...(delta.uniqueUserCount ? { uniqueUserCount: { increment: delta.uniqueUserCount } } : {}),
      ...(delta.failedSessionCount ? { failedSessionCount: { increment: delta.failedSessionCount } } : {}),
      ...(delta.alertCount ? { alertCount: { increment: delta.alertCount } } : {}),
      ...(delta.resolvedAlertCount ? { resolvedAlertCount: { increment: delta.resolvedAlertCount } } : {}),
    },
  });
}

export async function lockUser(tx: Prisma.TransactionClient, id: string) {
  await tx.$queryRaw`SELECT id FROM admin_users WHERE id = ${id}::uuid FOR UPDATE`;
}

export async function lockStation(tx: Prisma.TransactionClient, id: string) {
  await tx.$queryRaw`SELECT id FROM stations WHERE id = ${id}::uuid FOR SHARE`;
}

export async function recordAudit(tx: Prisma.TransactionClient, actorId: string | null, action: string, entityType: string, entityId: string, stationId: string | null = null) {
  await tx.auditLog.create({ data: { actorAdminUserId: actorId, action, entityType, entityId, stationId, expiresAt: new Date(Date.now() + 30 * 86400000) } });
}
