import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminFixture } from '../helpers/admin-api';
import { alertFixture, ingestSession, sessionPayload } from '../helpers/camera-api';

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
    expect((await request(f.app).get('/api/v1/alerts/' + alertA.alertId).set('Cookie', b.cookie)).status).toBe(404);
    expect((await request(f.app).get('/api/v1/alerts?stationId=' + f.stationA.id).set('Cookie', b.cookie)).status).toBe(403);
    for (const action of ['acknowledge', 'resolve']) {
      const denied = await request(f.app).patch('/api/v1/alerts/' + alertB.alertId + '/' + action).set('Cookie', a.cookie).set('X-CSRF-Token', a.csrf).send(action === 'resolve' ? { notes: 'Not allowed' } : {});
      expect(denied.status).toBe(404);
      expect(denied.text).not.toContain('Fixture Passenger');
    }
    expect((await request(f.app).get('/api/v1/alerts/' + alertA.alertId)).status).toBe(401);
  });

  it('requires claim before resolution, a nonblank note, and the assigned handler or Super Admin', async () => {
    const fixture = await alertFixture(f);
    const handler = await f.login(f.securityA.username);
    const admin = await f.login();
    const peerUser = await f.db.adminUser.create({ data: { username: f.prefix + '.peer', passwordHash: f.admin.passwordHash, role: 'STATION_SECURITY', stationId: f.stationA.id, mustChangePassword: false } });
    const peer = await f.login(peerUser.username);
    const mutate = (action: string, auth: typeof handler, body: object) => request(f.app).patch('/api/v1/alerts/' + fixture.alertId + '/' + action).set('Cookie', auth.cookie).set('X-CSRF-Token', auth.csrf).send(body);
    expect((await mutate('resolve', handler, { notes: 'Premature resolution' })).status).toBe(422);
    expect((await mutate('acknowledge', handler, { assignedToId: f.admin.id })).status).toBe(400);
    const claimed = await mutate('acknowledge', handler, {});
    expect(claimed.status).toBe(200);
    expect(claimed.body.data).toMatchObject({ status: 'ACKNOWLEDGED', assignedToId: f.securityA.id });
    expect((await mutate('acknowledge', handler, {})).status).toBe(409);
    expect((await mutate('resolve', handler, { notes: '  ' })).status).toBe(400);
    expect((await mutate('resolve', handler, { notes: 'x'.repeat(1001) })).status).toBe(400);
    expect((await mutate('resolve', peer, { notes: 'Peer cannot resolve' })).status).toBe(403);
    const resolved = await mutate('resolve', admin, { notes: '  Passenger assisted at station  ' });
    expect(resolved.status).toBe(200);
    expect(resolved.body.data).toMatchObject({ status: 'RESOLVED', assignedToId: f.securityA.id, resolutionNote: 'Passenger assisted at station' });
    expect((await mutate('resolve', handler, { notes: 'Already resolved' })).status).toBe(422);
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
