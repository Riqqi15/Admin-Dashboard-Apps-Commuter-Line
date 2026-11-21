import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app';
import { hmacTokenService } from '../../src/shared/infrastructure/hmac-token-service';
import type { PrismaClient } from '../../src/generated/prisma/client';
import { adminFixture } from '../helpers/admin-api';
import { alertFixture } from '../helpers/camera-api';

let f: Awaited<ReturnType<typeof adminFixture>>;
beforeAll(async () => { f = await adminFixture(); });
afterAll(async () => { if (f) await f.cleanup(); });

describe('Alert transaction races', () => {
  it('assigns one handler when two accounts claim in parallel', async () => {
    const fixture = await alertFixture(f);
    const handler = await f.login(f.securityA.username);
    const admin = await f.login();
    const results = await Promise.all([handler, admin].map(auth => request(f.app).patch('/api/v1/alerts/' + fixture.alertId + '/acknowledge').set('Cookie', auth.cookie).set('X-CSRF-Token', auth.csrf).send({})));
    expect(results.map(result => result.status).sort()).toEqual([200, 409]);
    const winner = results.find(result => result.status === 200)!.body.data.assignedToId;
    expect((await f.db.alert.findUniqueOrThrow({ where: { id: fixture.alertId } })).assignedToId).toBe(winner);
    expect(await f.db.auditLog.count({ where: { entityId: fixture.alertId, action: 'ALERT_ACKNOWLEDGED' } })).toBe(1);
  });

  it('revalidates a session moved/revoked after authentication but before claim', async () => {
    const fixture = await alertFixture(f);
    const handler = await f.login(f.securityA.username);
    const admin = await f.login();
    const session = await f.db.adminSession.findUniqueOrThrow({ where: { tokenHash: hmacTokenService(f.config.SESSION_PEPPER).hash('session', handler.cookie.split('=')[1]!) } });
    let resume!: () => void;
    let reached!: () => void;
    const barrier = new Promise<void>(resolve => { resume = resolve; });
    const entered = new Promise<void>(resolve => { reached = resolve; });
    const extended = f.db.$extends({ query: { adminSession: { async findUnique({ args, query }) {
      const result = await query(args);
      if (args.where.tokenHash === session.tokenHash) { reached(); await barrier; }
      return result;
    } } } });
    const app = createApp(f.config, undefined, undefined, extended as unknown as PrismaClient);
    const pending = request(app).patch('/api/v1/alerts/' + fixture.alertId + '/acknowledge').set('Cookie', handler.cookie).set('X-CSRF-Token', handler.csrf).send({}).then(value => value);
    try {
      await entered;
      const moved = await request(f.app).patch('/api/v1/staff/' + f.securityA.id).set('Cookie', admin.cookie).set('X-CSRF-Token', admin.csrf).send({ stationId: f.stationB.id });
      expect(moved.status).toBe(200);
    } finally { resume(); }
    expect((await pending).status).toBe(401);
    expect((await f.db.alert.findUniqueOrThrow({ where: { id: fixture.alertId } })).status).toBe('NEW');
  });
});
