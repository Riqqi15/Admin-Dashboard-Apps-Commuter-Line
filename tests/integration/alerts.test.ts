import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminFixture } from '../helpers/admin-api';
import { alertFixture, ingestSession, sessionPayload } from '../helpers/camera-api';
import { expectError } from '../helpers/expect-error';

let f: Awaited<ReturnType<typeof adminFixture>>;
beforeAll(async () => { f = await adminFixture(); });
afterAll(async () => { if (f) await f.cleanup(); });

describe('Station-scoped alert lifecycle', () => {
  it('scopes lists/details/mutations and exposes PII only on authorized detail', async () => {
    const alertA = await alertFixture(f);
    const alertB = await alertFixture(f, { stationId: f.stationB.id });
    const a = await f.login(f.securityA.username);
    const b = await f.login(f.securityB.username);
    const list = await request(f.app).get('/api/v1/alerts').set('Cookie', a.cookie);
    expect(list.status).toBe(200);
    expect(list.body.data.items.some((row: { id: string }) => row.id === alertA.alertId)).toBe(true);
    expect(list.body.data.items.every((row: { stationId: string }) => row.stationId === f.stationA.id)).toBe(true);
    expect(list.text).not.toMatch(/Fixture Passenger|081234567890|Ciphertext|payloadFingerprint/);
    const detail = await request(f.app).get('/api/v1/alerts/' + alertA.alertId).set('Cookie', a.cookie);
    expect(detail.status).toBe(200);
    expect(detail.body.data.user).toEqual({ displayName: 'Fixture Passenger', phone: '081234567890' });
    expect(detail.text).not.toMatch(/Ciphertext|passwordHash|tokenHash/);
    expectError(await request(f.app).get('/api/v1/alerts/' + alertA.alertId).set('Cookie', b.cookie), 404, 'NOT_FOUND');
    expectError(await request(f.app).get('/api/v1/alerts?stationId=' + f.stationA.id).set('Cookie', b.cookie), 403, 'FORBIDDEN');
    for (const action of ['acknowledge', 'resolve']) {
      const denied = await request(f.app).patch('/api/v1/alerts/' + alertB.alertId + '/' + action).set('Cookie', a.cookie).set('X-CSRF-Token', a.csrf).send(action === 'resolve' ? { notes: 'Not allowed' } : {});
      expectError(denied, 404, 'NOT_FOUND');
      expect(denied.text).not.toContain('Fixture Passenger');
    }
    expectError(await request(f.app).get('/api/v1/alerts/' + alertA.alertId), 401, 'UNAUTHENTICATED');
  });

  it('requires claim before resolution, a nonblank note, and the assigned handler or Super Admin', async () => {
    const fixture = await alertFixture(f);
    const handler = await f.login(f.securityA.username);
    const admin = await f.login();
    const peerUser = await f.db.adminUser.create({ data: { username: f.prefix + '.peer', passwordHash: f.admin.passwordHash, role: 'STATION_SECURITY', stationId: f.stationA.id, mustChangePassword: false } });
    const peer = await f.login(peerUser.username);
    const mutate = (action: string, auth: typeof handler, body: object) => request(f.app).patch('/api/v1/alerts/' + fixture.alertId + '/' + action).set('Cookie', auth.cookie).set('X-CSRF-Token', auth.csrf).send(body);
    expectError(await mutate('resolve', handler, { notes: 'Premature resolution' }), 422, 'INVALID_STATE_TRANSITION');
    expectError(await mutate('acknowledge', handler, { assignedToId: f.admin.id }), 400, 'VALIDATION_ERROR');
    const claimed = await mutate('acknowledge', handler, {});
    expect(claimed.status).toBe(200);
    expect(claimed.body.data).toMatchObject({ status: 'ACKNOWLEDGED', assignedToId: f.securityA.id });
    expectError(await mutate('acknowledge', handler, {}), 409, 'ALERT_ALREADY_ACKNOWLEDGED');
    expectError(await mutate('resolve', handler, { notes: '  ' }), 400, 'VALIDATION_ERROR');
    expectError(await mutate('resolve', handler, { notes: 'x'.repeat(1001) }), 400, 'VALIDATION_ERROR');
    expectError(await mutate('resolve', peer, { notes: 'Peer cannot resolve' }), 403, 'FORBIDDEN');
    const resolved = await mutate('resolve', admin, { notes: '  Passenger assisted at station  ' });
    expect(resolved.status).toBe(200);
    expect(resolved.body.data).toMatchObject({ status: 'RESOLVED', assignedToId: f.securityA.id, resolutionNote: 'Passenger assisted at station' });
    expectError(await mutate('resolve', handler, { notes: 'Already resolved' }), 422, 'INVALID_STATE_TRANSITION');
    expect(await f.db.auditLog.count({ where: { entityId: fixture.alertId, action: { in: ['ALERT_CREATED', 'ALERT_ACKNOWLEDGED', 'ALERT_RESOLVED'] } } })).toBe(3);
  });

  it('keeps an immutable encrypted alert snapshot and suppresses expired PII before cleanup runs', async () => {
    const fixture = await alertFixture(f);
    const admin = await f.login();
    expect((await ingestSession(f, sessionPayload(f, { displayName: 'Updated User Name', phone: '089999999999' }))).status).toBe(201);
    const original = await request(f.app).get('/api/v1/alerts/' + fixture.alertId).set('Cookie', admin.cookie);
    expect(original.body.data.user).toEqual({ displayName: 'Fixture Passenger', phone: '081234567890' });
    await f.db.alert.update({ where: { id: fixture.alertId }, data: { createdAt: new Date(Date.now() - 8 * 86400000) } });
    const expiredPii = await request(f.app).get('/api/v1/alerts/' + fixture.alertId).set('Cookie', admin.cookie);
    expect(expiredPii.status).toBe(200);
    expect(expiredPii.body.data.user).toBeNull();
    expect(expiredPii.text).not.toMatch(/Fixture Passenger|081234567890/);
    await f.db.alert.update({ where: { id: fixture.alertId }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await request(f.app).get('/api/v1/alerts/' + fixture.alertId).set('Cookie', admin.cookie)).status).toBe(404);
  });

  it('requires CSRF and rejects invalid IDs, filters and pagination', async () => {
    const fixture = await alertFixture(f);
    const handler = await f.login(f.securityA.username);
    expect((await request(f.app).patch('/api/v1/alerts/' + fixture.alertId + '/acknowledge').set('Cookie', handler.cookie).send({})).status).toBe(403);
    expect((await request(f.app).get('/api/v1/alerts/not-a-uuid').set('Cookie', handler.cookie)).status).toBe(400);
    expect((await request(f.app).get('/api/v1/alerts?pageSize=101').set('Cookie', handler.cookie)).status).toBe(400);
    expect((await request(f.app).get('/api/v1/alerts?status=UNKNOWN').set('Cookie', handler.cookie)).status).toBe(400);
  });
});
