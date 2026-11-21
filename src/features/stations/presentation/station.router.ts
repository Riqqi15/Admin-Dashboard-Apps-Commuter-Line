import { Router } from 'express';
import { getAuth } from '../../../shared/presentation/get-auth';
import type { Guards } from '../../../shared/presentation/guards';
import { requirePasswordChanged, requireSuperAdmin } from '../../../shared/presentation/require-role';
import { idParams, listQuery } from '../../../shared/presentation/validation';
import type { StationUseCases } from '../application/station-use-cases';
import { createStationSchema, updateStationSchema } from './station.schema';

export function stationRouter(useCases: StationUseCases, guards: Guards) {
  const router = Router();
  router.use(guards.session, requirePasswordChanged, guards.csrf);
  router.get('/', async (request, response) => {
    const query = listQuery.parse(request.query);
    const data = await useCases.list(getAuth(request), query);
    response.json({ success: true, data: { ...data, page: query.page, pageSize: query.pageSize } });
  });
  router.use(requireSuperAdmin);
  router.post('/', async (request, response) => {
    const station = await useCases.create(getAuth(request), createStationSchema.parse(request.body));
    response.status(201).json({ success: true, data: station });
  });
  router.patch('/:id', async (request, response) => {
    const { id } = idParams.parse(request.params);
    const station = await useCases.update(getAuth(request), id, updateStationSchema.parse(request.body));
    response.json({ success: true, data: station });
  });
  return router;
}
