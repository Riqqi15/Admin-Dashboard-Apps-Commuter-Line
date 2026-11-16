import { Router } from 'express';
import type { Env } from '../../config/env';
import type { PrismaClient } from '../../generated/prisma/client';
import { AppError } from '../../http/errors';
import { ingestAuth } from './ingest-auth';
import { eventSchema, sessionSchema } from './ingest.schema';
import { ingestService } from './ingest.service';

export function ingestRouter(db: PrismaClient, config: Env) {
  const router = Router();
  const service = ingestService(db, config);
  router.use(...ingestAuth(config));
  router.post('/sessions', async (request, response) => {
    if (request.body?.source === 'MOBILE') throw new AppError(501, 'MOBILE_INGEST_UNSUPPORTED', 'Trusted mobile authentication is not configured');
    const result = await service.session(sessionSchema.parse(request.body));
    response.status(result.created ? 201 : 200).json({ success: true, data: result.data });
  });
  router.post('/events', async (request, response) => {
    const result = await service.event(eventSchema.parse(request.body));
    response.status(result.created ? 201 : 200).json({ success: true, data: result.data });
  });
  return router;
}
