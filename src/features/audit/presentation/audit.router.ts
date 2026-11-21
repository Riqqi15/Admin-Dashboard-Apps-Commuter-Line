import { Router } from 'express';
import type { Guards } from '../../../shared/presentation/guards';
import { requirePasswordChanged, requireSuperAdmin } from '../../../shared/presentation/require-role';
import type { AuditUseCases } from '../application/audit-use-cases';
import { auditQuery } from './audit.schema';

export function auditRouter(useCases: AuditUseCases, guards: Guards) {
  const router = Router();
  router.use(guards.session, requirePasswordChanged, guards.csrf, requireSuperAdmin);
  router.get('/', async (request, response) => {
    response.json({ success: true, data: await useCases.list(auditQuery.parse(request.query)) });
  });
  return router;
}
