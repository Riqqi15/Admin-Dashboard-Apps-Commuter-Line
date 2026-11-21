import { Router } from 'express';
import type { Env } from '../../../config/env';
import { AppError } from '../../../shared/domain/errors';
import type { IngestUseCases } from '../application/ingest-use-cases';
import { ingestAuth } from './ingest-auth';
import { eventSchema, sessionSchema } from './ingest.schema';

export function ingestRouter(useCases: IngestUseCases, config: Env) {
  const router = Router();
  router.use(...ingestAuth(config));
  router.post('/sessions', async (request, response) => {
    if (request.body?.source === 'MOBILE') throw new AppError(501, 'MOBILE_INGEST_UNSUPPORTED', 'Trusted mobile authentication is not configured');
    const result = await useCases.session(sessionSchema.parse(request.body));
    response.status(result.created ? 201 : 200).json({ success: true, data: result.data });
  });
  router.post('/events', async (request, response) => {
    const result = await useCases.event(eventSchema.parse(request.body));
    response.status(result.created ? 201 : 200).json({ success: true, data: result.data });
  });
  return router;
}
