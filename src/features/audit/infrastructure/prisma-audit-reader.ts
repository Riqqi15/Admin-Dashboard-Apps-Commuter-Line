import type { Tx } from '../../../shared/infrastructure/prisma-unit-of-work';
import type { AuditReader } from '../application/audit-reader';

export const prismaAuditReader = (db: Tx): AuditReader => ({
  async list({ stationId, action, from, toExclusive }, { page, pageSize }) {
    const where = {
      ...(stationId ? { stationId } : {}),
      ...(action ? { action } : {}),
      ...(from || toExclusive ? { createdAt: { ...(from ? { gte: from } : {}), ...(toExclusive ? { lt: toExclusive } : {}) } } : {}),
    };
    // `details` is deliberately not selected: audit reads never return free-form data.
    const items = await db.auditLog.findMany({
      where,
      select: { id: true, actorAdminUserId: true, stationId: true, action: true, entityType: true, entityId: true, createdAt: true },
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    });
    const total = await db.auditLog.count({ where });
    return { items, total };
  },
});
