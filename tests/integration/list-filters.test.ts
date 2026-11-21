import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminFixture } from '../helpers/admin-api';
import { alertFixture } from '../helpers/camera-api';
import { expectError } from '../helpers/expect-error';

let f: Awaited<ReturnType<typeof adminFixture>>;
beforeAll(async () => { f = await adminFixture(); });
afterAll(async () => { if (f) await f.cleanup(); });

const ids = (response: { body: { data: { items: Array<{ id: string }> } } }) => response.body.data.items.map(item => item.id);

describe('List filters and pagination not covered elsewhere', () => {
  it('lets the Super Admin filter stations by stationId and returns an empty page for an unknown one', async () => {
    const admin = await f.login();
    const one = await request(f.app).get('/api/v1/stations?stationId=' + f.stationA.id).set('Cookie', admin.cookie);
    expect(one.status).toBe(200);
    expect(ids(one)).toEqual([f.stationA.id]);
    expect(one.body.data.total).toBe(1);
    const none = await request(f.app).get('/api/v1/stations?stationId=' + randomUUID()).set('Cookie', admin.cookie);
    expect(none.status).toBe(200);
    expect(none.body.data).toMatchObject({ items: [], total: 0 });
  });

  it('filters alerts by status, station (Super Admin) and page, and rejects a bad status', async () => {
    const admin = await f.login();
    const handler = await f.login(f.securityA.username);
    const fresh = await alertFixture(f);
    const claimed = await alertFixture(f);
    const resolved = await alertFixture(f);
    const otherStation = await alertFixture(f, { stationId: f.stationB.id });
    const act = (id: string, action: 'acknowledge' | 'resolve', body: object) => request(f.app).patch(`/api/v1/alerts/${id}/${action}`).set('Cookie', handler.cookie).set('X-CSRF-Token', handler.csrf).send(body);
    expect((await act(claimed.alertId, 'acknowledge', {})).status).toBe(200);
    expect((await act(resolved.alertId, 'acknowledge', {})).status).toBe(200);
    expect((await act(resolved.alertId, 'resolve', { notes: 'Filter fixture' })).status).toBe(200);

    const list = (query: string) => request(f.app).get('/api/v1/alerts?pageSize=100&' + query).set('Cookie', admin.cookie);
    const byStatus = async (status: string) => ids(await list('status=' + status + '&stationId=' + f.stationA.id));
    const newOnes = await byStatus('NEW');
    expect(newOnes).toContain(fresh.alertId);
    expect(newOnes).not.toContain(claimed.alertId);
    expect(newOnes).not.toContain(resolved.alertId);
    const acknowledged = await byStatus('ACKNOWLEDGED');
    expect(acknowledged).toContain(claimed.alertId);
    expect(acknowledged).not.toContain(fresh.alertId);
    const done = await byStatus('RESOLVED');
    expect(done).toContain(resolved.alertId);
    expect(done).not.toContain(claimed.alertId);

    const stationB = ids(await list('stationId=' + f.stationB.id));
    expect(stationB).toContain(otherStation.alertId);
    expect(stationB).not.toContain(fresh.alertId);

    const first = await request(f.app).get('/api/v1/alerts?stationId=' + f.stationA.id + '&page=1&pageSize=1').set('Cookie', admin.cookie);
    const second = await request(f.app).get('/api/v1/alerts?stationId=' + f.stationA.id + '&page=2&pageSize=1').set('Cookie', admin.cookie);
    expect(first.body.data).toMatchObject({ page: 1, pageSize: 1 });
    expect(first.body.data.items).toHaveLength(1);
    expect(second.body.data.items).toHaveLength(1);
    expect(ids(second)[0]).not.toBe(ids(first)[0]);

    expectError(await request(f.app).get('/api/v1/alerts?status=UNKNOWN').set('Cookie', admin.cookie), 400, 'VALIDATION_ERROR');
  });

  it('paginates audit logs and rejects a reversed date range', async () => {
    const admin = await f.login();
    const first = await request(f.app).get('/api/v1/audit-logs?page=1&pageSize=1&stationId=' + f.stationA.id).set('Cookie', admin.cookie);
    const second = await request(f.app).get('/api/v1/audit-logs?page=2&pageSize=1&stationId=' + f.stationA.id).set('Cookie', admin.cookie);
    expect(first.status).toBe(200);
    expect(first.body.data).toMatchObject({ page: 1, pageSize: 1 });
    expect(first.body.data.total).toBeGreaterThanOrEqual(2);
    expect(second.body.data.page).toBe(2);
    expect(ids(second)[0]).not.toBe(ids(first)[0]);
    expectError(await request(f.app).get('/api/v1/audit-logs?from=2026-11-10&to=2026-11-01').set('Cookie', admin.cookie), 400, 'VALIDATION_ERROR');
    expectError(await request(f.app).get('/api/v1/audit-logs?pageSize=101').set('Cookie', admin.cookie), 400, 'VALIDATION_ERROR');
  });

  it('defaults analytics usage to the last seven days when no range is given', async () => {
    const admin = await f.login();
    await alertFixture(f);
    const result = await request(f.app).get('/api/v1/analytics/usage?stationId=' + f.stationA.id).set('Cookie', admin.cookie);
    expect(result.status).toBe(200);
    const today = new Date().toISOString().slice(0, 10);
    const sixDaysAgo = new Date(Date.now() - 6 * 86400000).toISOString().slice(0, 10);
    expect(result.body.data.to).toBe(today);
    expect(result.body.data.from).toBe(sixDaysAgo);
    expect(result.body.data.items.length).toBeGreaterThanOrEqual(1);
  });
});
