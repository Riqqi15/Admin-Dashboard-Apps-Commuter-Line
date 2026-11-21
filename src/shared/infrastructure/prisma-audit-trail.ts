import type { Prisma } from '../../generated/prisma/client';
import type { AuditTrail } from '../application/audit-trail';
import { DAY_MS } from '../domain/time';
import type { Tx } from './prisma-unit-of-work';

export const prismaAuditTrail = (tx: Tx): AuditTrail => ({
  async record({ actorId, action, entityType, entityId, stationId, details }) {
    await tx.auditLog.create({
      data: {
        actorAdminUserId: actorId, action, entityType, entityId, stationId,
        ...(details ? { details: details as Prisma.InputJsonValue } : {}),
        expiresAt: new Date(Date.now() + 30 * DAY_MS),
      },
    });
  },
});
