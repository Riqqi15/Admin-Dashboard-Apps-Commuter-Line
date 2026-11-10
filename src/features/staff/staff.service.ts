import type { z } from 'zod';
import type { Prisma, PrismaClient } from '../../generated/prisma/client';
import type { AuthContext } from '../auth/auth.service';
import { AppError } from '../../http/errors';
import { lockStation, lockUser, recordAudit } from '../../lib/admin-data';
import { hashPassword } from '../../lib/password';
import type { createStaffSchema, updateStaffSchema } from './staff.schema';

const staffSelect = { id: true, username: true, role: true, stationId: true, isActive: true, mustChangePassword: true, createdAt: true } as const;

async function activeStation(tx: Prisma.TransactionClient, id: string) {
  await lockStation(tx, id);
  const station = await tx.station.findUnique({ where: { id } });
  if (!station) throw new AppError(404, 'NOT_FOUND', 'Resource not found');
  if (!station.isActive) throw new AppError(400, 'STATION_INACTIVE', 'Choose an active station');
}

async function staffAccount(tx: Prisma.TransactionClient, id: string, destinationId?: string) {
  const candidate = await tx.adminUser.findUnique({ where: { id } });
  if (!candidate || candidate.role !== 'STATION_SECURITY') throw new AppError(404, 'NOT_FOUND', 'Resource not found');
  // Always lock stations before users/sessions, including the source station on moves.
  const stationIds = [...new Set([candidate.stationId, destinationId].filter((value): value is string => Boolean(value)))].sort();
  for (const stationId of stationIds) await lockStation(tx, stationId);
  await lockUser(tx, id);
  const user = await tx.adminUser.findUnique({ where: { id } });
  if (!user || user.role !== 'STATION_SECURITY') throw new AppError(404, 'NOT_FOUND', 'Resource not found');
  if (user.stationId !== candidate.stationId) throw new AppError(409, 'CONFLICT', 'Account assignment changed; retry the request');
  return user;
}

export function staffService(db: PrismaClient) {
  return {
    async list(page: number, pageSize: number, stationId?: string) {
      const where = { role: 'STATION_SECURITY' as const, ...(stationId ? { stationId } : {}) };
      const [items, total] = await db.$transaction([
        db.adminUser.findMany({ where, select: staffSelect, orderBy: { username: 'asc' }, skip: (page - 1) * pageSize, take: pageSize }),
        db.adminUser.count({ where }),
      ]);
      return { items, total, page, pageSize };
    },
    async create(actor: AuthContext, input: z.infer<typeof createStaffSchema>) {
      const passwordHash = await hashPassword(input.password);
      return db.$transaction(async tx => {
        await activeStation(tx, input.stationId);
        const user = await tx.adminUser.create({ data: { username: input.username, stationId: input.stationId, passwordHash, role: 'STATION_SECURITY', mustChangePassword: true }, select: staffSelect });
        await recordAudit(tx, actor.userId, 'STAFF_CREATED', 'admin_user', user.id, user.stationId);
        return user;
      });
    },
    async update(actor: AuthContext, id: string, input: z.infer<typeof updateStaffSchema>) {
      return db.$transaction(async tx => {
        const current = await staffAccount(tx, id, input.stationId);
        if (input.stationId || input.isActive === true) await activeStation(tx, input.stationId || current.stationId!);
        const user = await tx.adminUser.update({ where: { id }, data: {
          ...(input.username !== undefined ? { username: input.username } : {}),
          ...(input.stationId !== undefined ? { stationId: input.stationId } : {}),
          ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
        }, select: staffSelect });
        await tx.adminSession.updateMany({ where: { adminUserId: id, revokedAt: null }, data: { revokedAt: new Date() } });
        await recordAudit(tx, actor.userId, 'STAFF_UPDATED', 'admin_user', user.id, user.stationId);
        return user;
      });
    },
    async resetPassword(actor: AuthContext, id: string, password: string) {
      const passwordHash = await hashPassword(password);
      return db.$transaction(async tx => {
        await staffAccount(tx, id);
        const user = await tx.adminUser.update({ where: { id }, data: { passwordHash, mustChangePassword: true }, select: staffSelect });
        await tx.adminSession.updateMany({ where: { adminUserId: id, revokedAt: null }, data: { revokedAt: new Date() } });
        await recordAudit(tx, actor.userId, 'STAFF_PASSWORD_RESET', 'admin_user', id, user.stationId);
        return user;
      });
    },
  };
}
