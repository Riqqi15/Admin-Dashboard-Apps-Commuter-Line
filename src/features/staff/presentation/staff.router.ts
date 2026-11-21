import { Router } from 'express';
import { getAuth } from '../../../shared/presentation/get-auth';
import type { Guards } from '../../../shared/presentation/guards';
import { requirePasswordChanged, requireSuperAdmin } from '../../../shared/presentation/require-role';
import { idParams, listQuery } from '../../../shared/presentation/validation';
import type { StaffUseCases } from '../application/staff-use-cases';
import { createStaffSchema, resetPasswordSchema, updateStaffSchema } from './staff.schema';

export function staffRouter(useCases: StaffUseCases, guards: Guards) {
  const router = Router();
  router.use(guards.session, requirePasswordChanged, guards.csrf, requireSuperAdmin);
  router.get('/', async (request, response) => {
    const query = listQuery.parse(request.query);
    const data = await useCases.list(query.page, query.pageSize, query.stationId);
    response.json({ success: true, data: { ...data, page: query.page, pageSize: query.pageSize } });
  });
  router.post('/', async (request, response) => {
    response.status(201).json({ success: true, data: await useCases.create(getAuth(request), createStaffSchema.parse(request.body)) });
  });
  router.patch('/:id', async (request, response) => {
    const { id } = idParams.parse(request.params);
    response.json({ success: true, data: await useCases.update(getAuth(request), id, updateStaffSchema.parse(request.body)) });
  });
  router.post('/:id/reset-password', async (request, response) => {
    const { id } = idParams.parse(request.params);
    const input = resetPasswordSchema.parse(request.body);
    response.json({ success: true, data: await useCases.resetPassword(getAuth(request), id, input.newPassword) });
  });
  return router;
}
