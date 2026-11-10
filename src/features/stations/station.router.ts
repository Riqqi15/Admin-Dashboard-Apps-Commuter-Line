import { Router } from 'express';
import type { Env } from '../../config/env';
import type { PrismaClient } from '../../generated/prisma/client';
import { AppError } from '../../http/errors';
import { idParams, listQuery } from '../../http/validation';
import { recordAudit } from '../../lib/admin-data';
import { requireCsrf } from '../../middleware/require-csrf';
import { requirePasswordChanged, requireSuperAdmin } from '../../middleware/require-role';
import { getAuth, requireSession } from '../../middleware/require-session';
import { stationScope } from '../../middleware/station-scope';
import { createStationSchema, updateStationSchema } from './station.schema';

export function stationRouter(db: PrismaClient, config: Env) {
  const router = Router();
  router.use(requireSession(db, config), requirePasswordChanged, requireCsrf(config));
  router.get('/', async (request, response) => {
    const query = listQuery.parse(request.query);
    const auth = getAuth(request);
    const id = stationScope(auth, query.stationId);
    const where = { ...(id ? { id } : {}), ...(auth.role === 'STATION_SECURITY' ? { isActive: true } : {}) };
    const [items, total] = await db.$transaction([
      db.station.findMany({ where, orderBy: { code: 'asc' }, skip: (query.page - 1) * query.pageSize, take: query.pageSize }),
      db.station.count({ where }),
    ]);
    response.json({ success: true, data: { items, total, page: query.page, pageSize: query.pageSize } });
  });
  router.use(requireSuperAdmin);
  router.post('/', async (request, response) => {
    const input = createStationSchema.parse(request.body);
    const station = await db.$transaction(async tx => {
      const created = await tx.station.create({ data: input });
      await recordAudit(tx, getAuth(request).userId, 'STATION_CREATED', 'station', created.id, created.id);
      return created;
    });
    response.status(201).json({ success: true, data: station });
  });
  router.patch('/:id', async (request, response) => {
    const { id } = idParams.parse(request.params);
    const input = updateStationSchema.parse(request.body);
    const station = await db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM stations WHERE id = ${id}::uuid FOR UPDATE`;
      if (!await tx.station.findUnique({ where: { id } })) throw new AppError(404, 'NOT_FOUND', 'Resource not found');
      const updated = await tx.station.update({ where: { id }, data: {
        ...(input.code !== undefined ? { code: input.code } : {}),
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      } });
      if (input.isActive === false) {
        await tx.adminSession.updateMany({ where: { adminUser: { stationId: id }, revokedAt: null }, data: { revokedAt: new Date() } });
      }
      await recordAudit(tx, getAuth(request).userId, 'STATION_UPDATED', 'station', id, id);
      return updated;
    });
    response.json({ success: true, data: station });
  });
  return router;
}
