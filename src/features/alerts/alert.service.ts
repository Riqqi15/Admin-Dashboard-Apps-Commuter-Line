import type { z } from 'zod';
import type { Alert, Prisma, PrismaClient } from '../../generated/prisma/client';
import type { Env } from '../../config/env';
import { AppError } from '../../http/errors';
import { lockStation, lockUser, recordAudit } from '../../lib/admin-data';
import { decryptPii } from '../../lib/pii';
import { stationScope } from '../../middleware/station-scope';
import { invalidSession, type AuthContext } from '../auth/auth.service';
import { assertAlertTransition } from './alert-state';
import type { alertQuery } from './alert.schema';

const notFound = () => new AppError(404, 'NOT_FOUND', 'Resource not found');
const publicSelect = {
  id: true, cameraSessionId: true, stationId: true, failureType: true, errorCode: true,
  status: true, assignedToId: true, resolutionNote: true, createdAt: true,
  acknowledgedAt: true, resolvedAt: true, expiresAt: true,
} as const;

function metadata(alert: Alert) {
  return Object.fromEntries(Object.keys(publicSelect).map(key => [key, alert[key as keyof Alert]]));
}

// Station -> account -> alert is the same lock order as staff reassignment.
// Revalidate after taking the account lock: middleware authentication can become stale.
async function currentActor(tx: Prisma.TransactionClient, auth: AuthContext, stationId?: string) {
  if (stationId) await lockStation(tx, stationId);
  await lockUser(tx, auth.userId);
  const session = await tx.adminSession.findUnique({ where: { id: auth.sessionId }, include: { adminUser: { include: { station: true } } } });
  if (!session || session.adminUserId !== auth.userId || session.revokedAt || session.expiresAt <= new Date()) throw invalidSession();
  const user = session.adminUser;
  if (!user.isActive || (user.role === 'STATION_SECURITY' && !user.station?.isActive)) throw invalidSession();
  if (user.mustChangePassword) throw new AppError(403, 'PASSWORD_CHANGE_REQUIRED', 'Change your temporary password first');
  return { ...auth, role: user.role, stationId: user.stationId };
}

async function accessibleAlert(tx: Prisma.TransactionClient, auth: AuthContext, id: string) {
  const candidate = await tx.alert.findUnique({ where: { id }, select: { stationId: true } });
  if (!candidate) throw notFound();
  const actor = await currentActor(tx, auth, candidate.stationId);
  await tx.$queryRaw`SELECT id FROM alerts WHERE id = ${id}::uuid FOR UPDATE`;
  const alert = await tx.alert.findUnique({ where: { id } });
  if (!alert || alert.expiresAt <= new Date() || (actor.role === 'STATION_SECURITY' && actor.stationId !== alert.stationId)) throw notFound();
  return { actor, alert };
}

export function alertService(db: PrismaClient, config: Env) {
  return {
    async list(auth: AuthContext, query: z.infer<typeof alertQuery>) {
      return db.$transaction(async tx => {
        const actor = await currentActor(tx, auth, auth.role === 'STATION_SECURITY' ? auth.stationId ?? undefined : undefined);
        const stationId = stationScope(actor, query.stationId);
        const where = { ...(stationId ? { stationId } : {}), ...(query.status ? { status: query.status } : {}), expiresAt: { gt: new Date() } };
        const items = await tx.alert.findMany({ where, select: publicSelect, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], skip: (query.page - 1) * query.pageSize, take: query.pageSize });
        const total = await tx.alert.count({ where });
        return { items, total, page: query.page, pageSize: query.pageSize };
      });
    },
    async detail(auth: AuthContext, id: string) {
      return db.$transaction(async tx => {
        const { alert } = await accessibleAlert(tx, auth, id);
        const visible = !alert.piiPurgedAt && alert.createdAt.getTime() + 7 * 86400000 > Date.now() && alert.userNameCiphertext;
        const user = visible ? {
          displayName: decryptPii(alert.userNameCiphertext!, config.PII_ENCRYPTION_KEY, `alert:${alert.id}:name`),
          phone: alert.userPhoneCiphertext ? decryptPii(alert.userPhoneCiphertext, config.PII_ENCRYPTION_KEY, `alert:${alert.id}:phone`) : null,
        } : null;
        return { ...metadata(alert), user };
      });
    },
    async acknowledge(auth: AuthContext, id: string) {
      return db.$transaction(async tx => {
        const { actor, alert } = await accessibleAlert(tx, auth, id);
        if (alert.status !== 'NEW') throw new AppError(409, 'ALERT_ALREADY_ACKNOWLEDGED', 'Alert has already been claimed');
        const updated = await tx.alert.update({ where: { id }, data: { status: 'ACKNOWLEDGED', assignedToId: actor.userId, acknowledgedAt: new Date() }, select: publicSelect });
        await recordAudit(tx, actor.userId, 'ALERT_ACKNOWLEDGED', 'alert', id, alert.stationId);
        return updated;
      });
    },
    async resolve(auth: AuthContext, id: string, notes: string) {
      return db.$transaction(async tx => {
        const { actor, alert } = await accessibleAlert(tx, auth, id);
        assertAlertTransition(alert.status, 'RESOLVED');
        if (actor.role !== 'SUPER_ADMIN' && alert.assignedToId !== actor.userId) throw new AppError(403, 'FORBIDDEN', 'Only the assigned handler can resolve this alert');
        const updated = await tx.alert.update({ where: { id }, data: { status: 'RESOLVED', resolvedAt: new Date(), resolutionNote: notes }, select: publicSelect });
        await recordAudit(tx, actor.userId, 'ALERT_RESOLVED', 'alert', id, alert.stationId);
        return updated;
      });
    },
  };
}
