import { Router } from 'express';
import type { AuthContext } from '../../../shared/domain/roles';
import { getAuth } from '../../../shared/presentation/get-auth';
import type { Guards } from '../../../shared/presentation/guards';
import { requirePasswordChanged } from '../../../shared/presentation/require-role';
import { idParams } from '../../../shared/presentation/validation';
import type { AlertUseCases } from '../application/alert-use-cases';
import type { AlertStream } from '../application/ports';
import { acknowledgeSchema, alertQuery, resolveSchema } from './alert.schema';

export function alertRouter(useCases: AlertUseCases, alertStream: AlertStream, guards: Guards, sessionStillCurrent: (auth: AuthContext) => Promise<boolean>) {
  const router = Router();
  router.use(guards.session, requirePasswordChanged, guards.csrf);
  router.get('/', async (request, response) => {
    response.json({ success: true, data: await useCases.list(getAuth(request), alertQuery.parse(request.query)) });
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
          if (!await sessionStillCurrent(auth)) { close(); return; }
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
    response.json({ success: true, data: await useCases.detail(getAuth(request), id) });
  });
  router.patch('/:id/acknowledge', async (request, response) => {
    const { id } = idParams.parse(request.params);
    acknowledgeSchema.parse(request.body ?? {});
    response.json({ success: true, data: await useCases.acknowledge(getAuth(request), id) });
  });
  router.patch('/:id/resolve', async (request, response) => {
    const { id } = idParams.parse(request.params);
    const { notes } = resolveSchema.parse(request.body);
    response.json({ success: true, data: await useCases.resolve(getAuth(request), id, notes) });
  });
  return router;
}
