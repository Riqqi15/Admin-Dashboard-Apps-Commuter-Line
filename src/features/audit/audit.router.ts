import { Router } from 'express';
import type { Env } from '../../config/env';
import type { PrismaClient } from '../../generated/prisma/client';
import { auditQuery } from './audit.schema';
import { auditService } from './audit.service';
import { requireCsrf } from '../../middleware/require-csrf';
import { requirePasswordChanged, requireSuperAdmin } from '../../middleware/require-role';
import { requireSession } from '../../middleware/require-session';

export function auditRouter(db: PrismaClient, config: Env) {
  const router = Router();
  const service = auditService(db);
  router.use(requireSession(db, config), requirePasswordChanged, requireCsrf(config), requireSuperAdmin);
  router.get('/', async (request, response) => {
    response.json({ success: true, data: await service.list(auditQuery.parse(request.query)) });
  });
  return router;
}
