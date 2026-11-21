import type { z } from 'zod';
import type { PrismaClient } from '../../generated/prisma/client';
import type { auditQuery } from './audit.schema';

export function auditService(db: PrismaClient) {
  return {
    async list(query: z.infer<typeof auditQuery>) {
      const from = query.from ? new Date(`${query.from}T00:00:00.000Z`) : undefined;
      const to = query.to ? new Date(new Date(`${query.to}T00:00:00.000Z`).getTime() + 86400000) : undefined;
      const where = {
        ...(query.stationId ? { stationId: query.stationId } : {}),
        ...(query.action ? { action: query.action } : {}),
        ...(from || to ? { createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lt: to } : {}) } } : {}),
      };
      const [items, total] = await db.$transaction([
        db.auditLog.findMany({
          where,
          select: { id: true, actorAdminUserId: true, stationId: true, action: true, entityType: true, entityId: true, createdAt: true },
          orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
        }),
        db.auditLog.count({ where }),
      ]);
      return { items, total, page: query.page, pageSize: query.pageSize };
    },
  };
}
