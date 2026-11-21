import { Router } from 'express';
import { getAuth } from '../../../shared/presentation/get-auth';
import type { Guards } from '../../../shared/presentation/guards';
import { requirePasswordChanged } from '../../../shared/presentation/require-role';
import type { AnalyticsUseCases } from '../application/analytics-use-cases';
import { summaryQuery, usageQuery } from './analytics.schema';

export function analyticsRouter(useCases: AnalyticsUseCases, guards: Guards) {
  const router = Router();
  router.use(guards.session, requirePasswordChanged, guards.csrf);
  router.get('/dashboard/summary', async (request, response) => {
    const query = summaryQuery.parse(request.query);
    response.json({ success: true, data: await useCases.summary(getAuth(request), query.stationId) });
  });
  router.get('/analytics/usage', async (request, response) => {
    response.json({ success: true, data: await useCases.usage(getAuth(request), usageQuery.parse(request.query)) });
  });
  return router;
}
