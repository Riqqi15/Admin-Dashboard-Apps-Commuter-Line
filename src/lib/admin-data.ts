import type { Prisma } from '../generated/prisma/client';

export async function lockUser(tx: Prisma.TransactionClient, id: string) {
  await tx.$queryRaw`SELECT id FROM admin_users WHERE id = ${id}::uuid FOR UPDATE`;
}

export async function lockStation(tx: Prisma.TransactionClient, id: string) {
  await tx.$queryRaw`SELECT id FROM stations WHERE id = ${id}::uuid FOR SHARE`;
}

export async function recordAudit(tx: Prisma.TransactionClient, actorId: string | null, action: string, entityType: string, entityId: string, stationId: string | null = null) {
  await tx.auditLog.create({ data: { actorAdminUserId: actorId, action, entityType, entityId, stationId, expiresAt: new Date(Date.now() + 30 * 86400000) } });
}
