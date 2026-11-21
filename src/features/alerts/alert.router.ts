import { Router } from 'express';
import type { Env } from '../../config/env';
import type { PrismaClient } from '../../generated/prisma/client';
import { idParams } from '../../http/validation';
import { requireCsrf } from '../../middleware/require-csrf';
import { requirePasswordChanged } from '../../middleware/require-role';
import { getAuth, requireSession } from '../../middleware/require-session';
import { acknowledgeSchema, alertQuery, resolveSchema } from './alert.schema';
import { alertService } from './alert.service';
import type { AlertStream } from './alert-stream';

export function alertRouter(db: PrismaClient, config: Env, alertStream: AlertStream) {
  const router = Router();
  const service = alertService(db, config);
  router.use(requireSession(db, config), requirePasswordChanged, requireCsrf(config));
  router.get('/', async (request, response) => {
    response.json({ success: true, data: await service.list(getAuth(request), alertQuery.parse(request.query)) });
  });
  router.get('/stream', async (request, response) => {
    const auth = getAuth(request);
    const unsubscribe = alertStream.subscribe(auth, response);
    const startedAt = Date.now();
    let checking = false;
    let closed = false;
    let lastSessionCheck = 0;
    let heartbeat: NodeJS.Timeout;
    const close = () => {
      if (closed) return;
      closed = true;
      clearInterval(heartbeat);
      unsubscribe();
      if (!response.writableEnded) response.end();
    };
    response.status(200).set({
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    response.flushHeaders();
    response.write('retry: 3000\n: stream-ready\n\n');
    heartbeat = setInterval(async () => {
      if (checking || closed) return;
      checking = true;
      try {
        const now = Date.now();
        if (now - startedAt >= 5 * 60_000 || now >= auth.expiresAt.getTime()) { close(); return; }
        if (now - lastSessionCheck >= 30_000) {
          lastSessionCheck = now;
          const session = await db.adminSession.findUnique({
            where: { id: auth.sessionId },
            include: { adminUser: { include: { station: true } } },
          });
          const user = session?.adminUser;
          if (!session || session.revokedAt || session.expiresAt <= new Date() || !user?.isActive || user.mustChangePassword
            || user.id !== auth.userId || user.role !== auth.role || user.stationId !== auth.stationId
            || (user.role === 'STATION_SECURITY' && !user.station?.isActive)) { close(); return; }
        }
        response.write(': heartbeat\n\n');
      } catch {
        close();
      } finally {
        checking = false;
      }
    }, 15_000);
    heartbeat.unref();
    request.on('aborted', close);
    response.on('close', close);
  });
  router.get('/:id', async (request, response) => {
    const { id } = idParams.parse(request.params);
    response.json({ success: true, data: await service.detail(getAuth(request), id) });
  });
  router.patch('/:id/acknowledge', async (request, response) => {
    const { id } = idParams.parse(request.params);
    acknowledgeSchema.parse(request.body ?? {});
    const alert = await service.acknowledge(getAuth(request), id);
    alertStream.publish({ type: 'alert.updated', alertId: alert.id, stationId: alert.stationId, status: alert.status, occurredAt: new Date().toISOString() });
    response.json({ success: true, data: alert });
  });
  router.patch('/:id/resolve', async (request, response) => {
    const { id } = idParams.parse(request.params);
    const { notes } = resolveSchema.parse(request.body);
    const alert = await service.resolve(getAuth(request), id, notes);
    alertStream.publish({ type: 'alert.updated', alertId: alert.id, stationId: alert.stationId, status: alert.status, occurredAt: new Date().toISOString() });
    response.json({ success: true, data: alert });
  });
  return router;
}
