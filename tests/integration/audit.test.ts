import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminFixture, cookieOf, fixturePassword } from '../helpers/admin-api';
import { alertFixture } from '../helpers/camera-api';
import { expectError } from '../helpers/expect-error';

let f: Awaited<ReturnType<typeof adminFixture>>;
beforeAll(async () => { f = await adminFixture(); });
afterAll(async () => { if (f) await f.cleanup(); });

const one = async (action: string, entityId: string) => {
  const rows = await f.db.auditLog.findMany({ where: { action, entityId } });
  expect(rows, `${action} for ${entityId}`).toHaveLength(1);
  return rows[0]!;
};

describe('Audit trail', () => {
  it('records auth, station and staff actions with actor, entity and station', async () => {
    const admin = await f.login();
    const station = await request(f.app).post('/api/v1/stations').set('Cookie', admin.cookie).set('X-CSRF-Token', admin.csrf)
      .send({ code: (f.prefix + '-AU').toUpperCase(), name: 'Audit fixture' });
    expect(station.status).toBe(201);
    const stationId = station.body.data.id as string;
    expect((await request(f.app).patch('/api/v1/stations/' + stationId).set('Cookie', admin.cookie).set('X-CSRF-Token', admin.csrf).send({ name: 'Audit fixture 2' })).status).toBe(200);
    const staff = await request(f.app).post('/api/v1/staff').set('Cookie', admin.cookie).set('X-CSRF-Token', admin.csrf)
      .send({ username: f.prefix + '.audit', password: fixturePassword, stationId: f.stationA.id });
    expect(staff.status).toBe(201);
    const staffId = staff.body.data.id as string;
    expect((await request(f.app).patch('/api/v1/staff/' + staffId).set('Cookie', admin.cookie).set('X-CSRF-Token', admin.csrf).send({ stationId: f.stationB.id })).status).toBe(200);
    const resetPassword = 'Audit-reset-passphrase-2026!';
    expect((await request(f.app).post('/api/v1/staff/' + staffId + '/reset-password').set('Cookie', admin.cookie).set('X-CSRF-Token', admin.csrf).send({ newPassword: resetPassword })).status).toBe(200);
    const staffLogin = await f.login(f.prefix + '.audit', resetPassword);
    const changed = await request(f.app).post('/api/v1/auth/change-password').set('Cookie', staffLogin.cookie).set('X-CSRF-Token', staffLogin.csrf)
      .send({ currentPassword: resetPassword, newPassword: 'Audit-changed-passphrase-2026!' });
    expect(changed.status).toBe(200);
    expect((await request(f.app).post('/api/v1/auth/logout').set('Cookie', cookieOf(changed)).set('X-CSRF-Token', changed.body.data.csrfToken).send({})).status).toBe(200);

    expect(await one('STATION_CREATED', stationId)).toMatchObject({ actorAdminUserId: f.admin.id, entityType: 'station', stationId });
    expect(await one('STATION_UPDATED', stationId)).toMatchObject({ actorAdminUserId: f.admin.id, stationId });
    expect(await one('STAFF_CREATED', staffId)).toMatchObject({ actorAdminUserId: f.admin.id, entityType: 'admin_user', stationId: f.stationA.id });
    expect(await one('STAFF_UPDATED', staffId)).toMatchObject({ actorAdminUserId: f.admin.id, stationId: f.stationB.id });
    expect(await one('STAFF_PASSWORD_RESET', staffId)).toMatchObject({ actorAdminUserId: f.admin.id });
    expect(await one('AUTH_PASSWORD_CHANGED', staffId)).toMatchObject({ actorAdminUserId: staffId, stationId: f.stationB.id });
    expect(await one('AUTH_LOGOUT', staffId)).toMatchObject({ actorAdminUserId: staffId });
    expect(await f.db.auditLog.count({ where: { action: 'AUTH_LOGIN', entityId: f.admin.id, actorAdminUserId: f.admin.id } })).toBeGreaterThan(0);
  });

  it('records alert creation, claim and resolution with the right actor and station', async () => {
    const fixture = await alertFixture(f);
    const handler = await f.login(f.securityA.username);
    const base = '/api/v1/alerts/' + fixture.alertId;
    expect((await request(f.app).patch(base + '/acknowledge').set('Cookie', handler.cookie).set('X-CSRF-Token', handler.csrf).send({})).status).toBe(200);
    expect((await request(f.app).patch(base + '/resolve').set('Cookie', handler.cookie).set('X-CSRF-Token', handler.csrf).send({ notes: 'Audit resolution' })).status).toBe(200);
    expect(await one('ALERT_CREATED', fixture.alertId)).toMatchObject({ actorAdminUserId: null, entityType: 'alert', stationId: f.stationA.id });
    expect(await one('ALERT_ACKNOWLEDGED', fixture.alertId)).toMatchObject({ actorAdminUserId: f.securityA.id, stationId: f.stationA.id });
    expect(await one('ALERT_RESOLVED', fixture.alertId)).toMatchObject({ actorAdminUserId: f.securityA.id, stationId: f.stationA.id });
  });

  it('records denied cross-station alert access without changing the alert or leaking its existence', async () => {
    const fixture = await alertFixture(f);
    const intruder = await f.login(f.securityB.username);
    const base = '/api/v1/alerts/' + fixture.alertId;
    const responses = [
      await request(f.app).get(base).set('Cookie', intruder.cookie),
      await request(f.app).patch(base + '/acknowledge').set('Cookie', intruder.cookie).set('X-CSRF-Token', intruder.csrf).send({}),
      await request(f.app).patch(base + '/resolve').set('Cookie', intruder.cookie).set('X-CSRF-Token', intruder.csrf).send({ notes: 'Not mine' }),
    ];
    const missing = await request(f.app).get('/api/v1/alerts/' + randomUUID()).set('Cookie', intruder.cookie);
    expect(missing.status).toBe(404);
    for (const response of responses) {
      expect(response.status).toBe(404);
      expect(response.body.error).toEqual(missing.body.error);
    }
    expect(await f.db.alert.findUniqueOrThrow({ where: { id: fixture.alertId } })).toMatchObject({ status: 'NEW', assignedToId: null });
    const denied = await f.db.auditLog.findMany({ where: { action: 'ALERT_ACCESS_DENIED', entityId: fixture.alertId } });
    expect(denied).toHaveLength(3);
    for (const row of denied) expect(row).toMatchObject({ actorAdminUserId: f.securityB.id, entityType: 'alert', stationId: f.stationA.id });
    expect(await f.db.auditLog.count({ where: { action: 'ALERT_ACCESS_DENIED', actorAdminUserId: f.securityB.id, NOT: { entityId: fixture.alertId } } })).toBe(0);

    const admin = await f.login();
    const listed = await request(f.app).get('/api/v1/audit-logs?action=ALERT_ACCESS_DENIED&stationId=' + f.stationA.id).set('Cookie', admin.cookie);
    expect(listed.status).toBe(200);
    expect(listed.body.data.items.filter((row: { entityId: string }) => row.entityId === fixture.alertId)).toHaveLength(3);
  });

  it('records failed logins for known and unknown usernames without username, password or IP', async () => {
    const since = new Date();
    const unknownName = f.prefix + '.nobody';
    const wrong = 'Wrong-login-passphrase-2026!';
    const known = await request(f.app).post('/api/v1/auth/login').send({ username: f.securityA.username, password: wrong });
    const unknown = await request(f.app).post('/api/v1/auth/login').send({ username: unknownName, password: wrong });
    expectError(known, 401, 'INVALID_CREDENTIALS');
    expectError(unknown, 401, 'INVALID_CREDENTIALS');
    expect(unknown.body).toEqual(known.body);

    const rows = await f.db.auditLog.findMany({ where: { action: 'AUTH_LOGIN_FAILED', createdAt: { gte: since } } });
    const forKnown = rows.filter(row => row.entityId === f.securityA.id);
    const forUnknown = rows.filter(row => row.entityId === null);
    expect(forKnown).toHaveLength(1);
    expect(forKnown[0]).toMatchObject({ actorAdminUserId: null, entityType: 'admin_user', stationId: f.stationA.id, details: null });
    // Other test files also fail logins for unknown names in parallel, so only a lower bound is stable here.
    expect(forUnknown.length).toBeGreaterThanOrEqual(1);
    for (const row of forUnknown) expect(row).toMatchObject({ actorAdminUserId: null, entityType: 'admin_user', stationId: null, details: null });
    const text = JSON.stringify(rows);
    for (const secret of [wrong, unknownName, f.securityA.username, '127.0.0.1', '::ffff:']) expect(text).not.toContain(secret);
  });

  it('never stores passwords, tokens, keys or passenger data in audit rows', async () => {
    const rows = await f.db.auditLog.findMany({ where: { OR: [{ actorAdminUserId: { in: [f.admin.id, f.securityA.id, f.securityB.id] } }, { stationId: { in: [f.stationA.id, f.stationB.id] } }] } });
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(row.details).toBeNull();
    const text = JSON.stringify(rows);
    for (const secret of [fixturePassword, 'Audit-reset-passphrase-2026!', 'Audit-changed-passphrase-2026!', f.config.SIMULATOR_INGEST_KEY!, f.config.SESSION_PEPPER, 'Fixture Passenger', '081234567890']) {
      expect(text).not.toContain(secret);
    }
  });
});
