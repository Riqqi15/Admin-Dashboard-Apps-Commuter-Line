import { Router } from 'express';
import type { Env } from '../../config/env';
import type { PrismaClient } from '../../generated/prisma/client';
import { idParams } from '../../http/validation';
import { requireCsrf } from '../../middleware/require-csrf';
import { requirePasswordChanged } from '../../middleware/require-role';
import { getAuth, requireSession } from '../../middleware/require-session';
import { acknowledgeSchema, alertQuery, resolveSchema } from './alert.schema';
import { alertService } from './alert.service';

export function alertRouter(db: PrismaClient, config: Env) {
  const router = Router();
  const service = alertService(db, config);
  router.use(requireSession(db, config), requirePasswordChanged, requireCsrf(config));
  router.get('/', async (request, response) => {
    response.json({ success: true, data: await service.list(getAuth(request), alertQuery.parse(request.query)) });
  });
  router.get('/:id', async (request, response) => {
    const { id } = idParams.parse(request.params);
    response.json({ success: true, data: await service.detail(getAuth(request), id) });
  });
  router.patch('/:id/acknowledge', async (request, response) => {
    const { id } = idParams.parse(request.params);
    acknowledgeSchema.parse(request.body ?? {});
    response.json({ success: true, data: await service.acknowledge(getAuth(request), id) });
  });
  router.patch('/:id/resolve', async (request, response) => {
    const { id } = idParams.parse(request.params);
    const { notes } = resolveSchema.parse(request.body);
    response.json({ success: true, data: await service.resolve(getAuth(request), id, notes) });
  });
  return router;
}
