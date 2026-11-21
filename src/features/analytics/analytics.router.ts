import { Router } from 'express';
import type { Env } from '../../config/env';
import type { PrismaClient } from '../../generated/prisma/client';
import { AppError } from '../../http/errors';
import { requireCsrf } from '../../middleware/require-csrf';
import { requirePasswordChanged } from '../../middleware/require-role';
import { getAuth, requireSession } from '../../middleware/require-session';
import { stationScope } from '../../middleware/station-scope';
import { analyticsService } from './analytics.service';
import { summaryQuery, usageQuery, usageRange } from './analytics.schema';

export function analyticsRouter(db: PrismaClient, config: Env) {
  const router = Router();
  const service = analyticsService(db);
  router.use(requireSession(db, config), requirePasswordChanged, requireCsrf(config));
  router.get('/dashboard/summary', async (request, response) => {
    const auth = getAuth(request);
    const query = summaryQuery.parse(request.query);
    const scope = stationScope(auth, query.stationId);
    response.json({ success: true, data: await service.summary(scope) });
  });
  router.get('/analytics/usage', async (request, response) => {
    const query = usageQuery.parse(request.query);
    const range = usageRange(query);
    if (!range) throw new AppError(400, 'DATE_RANGE_INVALID', 'Date range must be at most 31 days');
    const scope = stationScope(getAuth(request), query.stationId);
    response.json({ success: true, data: { from: range.from.toISOString().slice(0, 10), to: new Date(range.to.getTime() - 86400000).toISOString().slice(0, 10), ...(await service.usage(range.from, range.to, scope)) } });
  });
  return router;
}
