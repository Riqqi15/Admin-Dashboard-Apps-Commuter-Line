import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminFixture } from '../helpers/admin-api';
import { alertFixture, ingestEvent, ingestSession, sessionPayload } from '../helpers/camera-api';

let f: Awaited<ReturnType<typeof adminFixture>>;
beforeAll(async () => { f = await adminFixture(); });
afterAll(async () => { if (f) await f.cleanup(); });

describe('Dashboard summary', () => {
  it('returns scoped summary for station security', async () => {
    await alertFixture(f);
    await alertFixture(f, { stationId: f.stationB.id });
    const a = await f.login(f.securityA.username);
    const result = await request(f.app).get('/api/v1/dashboard/summary').set('Cookie', a.cookie);
    expect(result.status).toBe(200);
    expect(result.body.data.byStation.every((row: { stationId: string }) => row.stationId === f.stationA.id)).toBe(true);
    expect(result.body.data.totals).toHaveProperty('sessionCount');
    expect(result.body.data.totals).toHaveProperty('openAlerts');
    expect(result.body.data.totals).toHaveProperty('activeSessions');
  });

  it('allows Super Admin to filter by station or see all', async () => {
    const admin = await f.login();
    const all = await request(f.app).get('/api/v1/dashboard/summary').set('Cookie', admin.cookie);
    expect(all.status).toBe(200);
    expect(all.body.data.byStation.length).toBeGreaterThanOrEqual(1);
    const filtered = await request(f.app).get('/api/v1/dashboard/summary?stationId=' + f.stationA.id).set('Cookie', admin.cookie);
    expect(filtered.status).toBe(200);
    expect(filtered.body.data.byStation.every((row: { stationId: string }) => row.stationId === f.stationA.id)).toBe(true);
  });

  it('rejects station security with stationId parameter', async () => {
    const a = await f.login(f.securityA.username);
    const result = await request(f.app).get('/api/v1/dashboard/summary?stationId=' + f.stationA.id).set('Cookie', a.cookie);
    expect(result.status).toBe(403);
  });
});

describe('Analytics usage', () => {
  it('returns usage data for station security within date range', async () => {
    const a = await f.login(f.securityA.username);
    const today = new Date().toISOString().slice(0, 10);
    const result = await request(f.app).get(`/api/v1/analytics/usage?from=${today}&to=${today}`).set('Cookie', a.cookie);
    expect(result.status).toBe(200);
    expect(result.body.data).toHaveProperty('items');
    expect(result.body.data).toHaveProperty('truncated');
    if (result.body.data.items.length > 0) {
      expect(result.body.data.items.every((row: { stationId: string }) => row.stationId === f.stationA.id)).toBe(true);
    }
  });

  it('rejects station security with stationId parameter', async () => {
    const a = await f.login(f.securityA.username);
    const today = new Date().toISOString().slice(0, 10);
    const result = await request(f.app).get(`/api/v1/analytics/usage?from=${today}&to=${today}&stationId=${f.stationB.id}`).set('Cookie', a.cookie);
    expect(result.status).toBe(403);
  });

  it('allows Super Admin stationId filter', async () => {
    const admin = await f.login();
    const today = new Date().toISOString().slice(0, 10);
    const result = await request(f.app).get(`/api/v1/analytics/usage?from=${today}&to=${today}&stationId=${f.stationA.id}`).set('Cookie', admin.cookie);
    expect(result.status).toBe(200);
    if (result.body.data.items.length > 0) {
      expect(result.body.data.items.every((row: { stationId: string }) => row.stationId === f.stationA.id)).toBe(true);
    }
  });

  it('rejects date range exceeding 31 days', async () => {
    const admin = await f.login();
    const result = await request(f.app).get('/api/v1/analytics/usage?from=2026-01-01&to=2026-03-01').set('Cookie', admin.cookie);
    expect(result.status).toBe(400);
    expect(result.body.error.code).toBe('DATE_RANGE_INVALID');
  });

  it('rejects reversed date range', async () => {
    const admin = await f.login();
    const result = await request(f.app).get('/api/v1/analytics/usage?from=2026-11-20&to=2026-11-10').set('Cookie', admin.cookie);
    expect(result.status).toBe(400);
  });

  it('defaults to 7 days when no dates given', async () => {
    const admin = await f.login();
    const result = await request(f.app).get('/api/v1/analytics/usage').set('Cookie', admin.cookie);
    expect(result.status).toBe(200);
    expect(result.body.data).toHaveProperty('from');
    expect(result.body.data).toHaveProperty('to');
    const from = new Date(result.body.data.from);
    const to = new Date(result.body.data.to);
    const days = (to.getTime() - from.getTime()) / 86400000 + 1;
    expect(days).toBe(7);
  });

  it('rejects unauthenticated request', async () => {
    expect((await request(f.app).get('/api/v1/analytics/usage')).status).toBe(401);
    expect((await request(f.app).get('/api/v1/dashboard/summary')).status).toBe(401);
  });
});

describe('Audit logs', () => {
  it('returns audit logs for Super Admin only', async () => {
    const admin = await f.login();
    const result = await request(f.app).get('/api/v1/audit-logs').set('Cookie', admin.cookie);
    expect(result.status).toBe(200);
    expect(result.body.data).toHaveProperty('items');
    expect(result.body.data).toHaveProperty('total');
    expect(result.body.data).toHaveProperty('page');
  });

  it('rejects station security', async () => {
    const a = await f.login(f.securityA.username);
    const result = await request(f.app).get('/api/v1/audit-logs').set('Cookie', a.cookie);
    expect(result.status).toBe(403);
  });

  it('filters by station, action, and date range', async () => {
    const admin = await f.login();
    const today = new Date().toISOString().slice(0, 10);
    const byStation = await request(f.app).get('/api/v1/audit-logs?stationId=' + f.stationA.id).set('Cookie', admin.cookie);
    expect(byStation.status).toBe(200);
    if (byStation.body.data.items.length > 0) {
      expect(byStation.body.data.items.every((row: { stationId: string }) => row.stationId === f.stationA.id)).toBe(true);
    }
    const byAction = await request(f.app).get('/api/v1/audit-logs?action=ALERT_CREATED').set('Cookie', admin.cookie);
    expect(byAction.status).toBe(200);
    if (byAction.body.data.items.length > 0) {
      expect(byAction.body.data.items.every((row: { action: string }) => row.action === 'ALERT_CREATED')).toBe(true);
    }
    const byDate = await request(f.app).get(`/api/v1/audit-logs?from=${today}&to=${today}`).set('Cookie', admin.cookie);
    expect(byDate.status).toBe(200);
  });

  it('does not expose details field', async () => {
    const admin = await f.login();
    const result = await request(f.app).get('/api/v1/audit-logs').set('Cookie', admin.cookie);
    expect(result.status).toBe(200);
    for (const item of result.body.data.items) {
      expect(item).not.toHaveProperty('details');
    }
  });

  it('paginates with pageSize and rejects over 100', async () => {
    const admin = await f.login();
    const small = await request(f.app).get('/api/v1/audit-logs?pageSize=2').set('Cookie', admin.cookie);
    expect(small.status).toBe(200);
    expect(small.body.data.items.length).toBeLessThanOrEqual(2);
    expect(small.body.data.pageSize).toBe(2);
    const oversized = await request(f.app).get('/api/v1/audit-logs?pageSize=101').set('Cookie', admin.cookie);
    expect(oversized.status).toBe(400);
  });

  it('rejects unauthenticated request', async () => {
    expect((await request(f.app).get('/api/v1/audit-logs')).status).toBe(401);
  });
});
