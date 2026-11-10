import { Router } from 'express';
import type { Env } from '../../config/env';
import type { PrismaClient } from '../../generated/prisma/client';
import { idParams, listQuery } from '../../http/validation';
import { requireCsrf } from '../../middleware/require-csrf';
import { requirePasswordChanged, requireSuperAdmin } from '../../middleware/require-role';
import { getAuth, requireSession } from '../../middleware/require-session';
import { createStaffSchema, resetPasswordSchema, updateStaffSchema } from './staff.schema';
import { staffService } from './staff.service';

export function staffRouter(db: PrismaClient, config: Env) {
  const router = Router();
  const service = staffService(db);
  router.use(requireSession(db, config), requirePasswordChanged, requireCsrf(config), requireSuperAdmin);
  router.get('/', async (request, response) => {
    const query = listQuery.parse(request.query);
    response.json({ success: true, data: await service.list(query.page, query.pageSize, query.stationId) });
  });
  router.post('/', async (request, response) => {
    const input = createStaffSchema.parse(request.body);
    response.status(201).json({ success: true, data: await service.create(getAuth(request), input) });
  });
  router.patch('/:id', async (request, response) => {
    const { id } = idParams.parse(request.params);
    const input = updateStaffSchema.parse(request.body);
    response.json({ success: true, data: await service.update(getAuth(request), id, input) });
  });
  router.post('/:id/reset-password', async (request, response) => {
    const { id } = idParams.parse(request.params);
    const input = resetPasswordSchema.parse(request.body);
    response.json({ success: true, data: await service.resetPassword(getAuth(request), id, input.newPassword) });
  });
  return router;
}
