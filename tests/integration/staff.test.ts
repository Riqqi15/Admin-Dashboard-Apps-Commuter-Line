import { randomUUID } from 'node:crypto';
import { verify } from 'argon2';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app';
import type { PrismaClient } from '../../src/generated/prisma/client';
import { adminFixture, fixturePassword } from '../helpers/admin-api';
import { expectError } from '../helpers/expect-error';

let f: Awaited<ReturnType<typeof adminFixture>>;
beforeAll(async () => { f = await adminFixture(); });
afterAll(async () => { if (f) await f.cleanup(); });

describe('Super Admin station and staff management', () => {
  it('creates a station, validates unique codes and returns paginated safe lists', async () => {
    const admin = await f.login();
    const code = (f.prefix + '-C').toUpperCase();
    const created = await request(f.app).post('/api/v1/stations').set('Cookie', admin.cookie).set('X-CSRF-Token', admin.csrf).send({ code: code.toLowerCase(), name: 'Fixture C' });
    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({ code, name: 'Fixture C', isActive: true });
    const duplicate = await request(f.app).post('/api/v1/stations').set('Cookie', admin.cookie).set('X-CSRF-Token', admin.csrf).send({ code, name: 'Duplicate' });
    expectError(duplicate, 409, 'CONFLICT');
    expect(duplicate.text).not.toMatch(/prisma|constraint|password|stack/i);
    const list = await request(f.app).get('/api/v1/stations?page=1&pageSize=1').set('Cookie', admin.cookie);
    expect(list.status).toBe(200);
    expect(list.body.data.items).toHaveLength(1);
    expect(list.body.data.pageSize).toBe(1);
    expect((await request(f.app).get('/api/v1/stations?pageSize=10000').set('Cookie', admin.cookie)).status).toBe(400);
  });

  it('creates station-security accounts only, with hashed temporary passwords and one active station', async () => {
    const admin = await f.login();
    const body = { username: '  ' + f.prefix.toUpperCase() + '.new  ', password: fixturePassword, stationId: f.stationA.id };
    const created = await request(f.app).post('/api/v1/staff').set('Cookie', admin.cookie).set('X-CSRF-Token', admin.csrf).send(body);
    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({ username: f.prefix + '.new', role: 'STATION_SECURITY', stationId: f.stationA.id, mustChangePassword: true });
    expect(created.text).not.toMatch(/passwordHash|tokenHash|csrfTokenHash/);
    const stored = await f.db.adminUser.findUniqueOrThrow({ where: { id: created.body.data.id } });
    expect(await verify(stored.passwordHash, fixturePassword)).toBe(true);
    expectError(await request(f.app).post('/api/v1/staff').set('Cookie', admin.cookie).set('X-CSRF-Token', admin.csrf).send(body), 409, 'CONFLICT');
    expectError(await request(f.app).post('/api/v1/staff').set('Cookie', admin.cookie).set('X-CSRF-Token', admin.csrf).send({ ...body, username: f.prefix + '.bad', stationId: randomUUID() }), 404, 'NOT_FOUND');
    const login = await f.login(stored.username);
    expect((await request(f.app).get('/api/v1/stations').set('Cookie', login.cookie)).status).toBe(403);
    expect((await request(f.app).get('/api/v1/auth/me').set('Cookie', login.cookie)).status).toBe(200);
    const staff = await request(f.app).get('/api/v1/staff').set('Cookie', admin.cookie);
    expect(staff.status).toBe(200);
    expect(staff.body.data.items.every((user: { role: string }) => user.role === 'STATION_SECURITY')).toBe(true);
    expect(staff.text).not.toMatch(/passwordHash|tokenHash|csrfTokenHash/);
  });

  it('moves and deactivates staff, revoking sessions while preserving historical alert stations', async () => {
    const admin = await f.login();
    const staff = await f.login(f.securityA.username);
    const alert = await f.db.alert.create({ data: { sourceSessionId: randomUUID(), stationId: f.stationA.id, failureType: 'CAMERA_INIT_FAILED', status: 'ACKNOWLEDGED', assignedToId: f.securityA.id, acknowledgedAt: new Date(), expiresAt: new Date(Date.now() + 86400000) } });
    try {
      const moved = await request(f.app).patch('/api/v1/staff/' + f.securityA.id).set('Cookie', admin.cookie).set('X-CSRF-Token', admin.csrf).send({ stationId: f.stationB.id });
      expect(moved.status).toBe(200);
      expect(moved.body.data.stationId).toBe(f.stationB.id);
      expect((await request(f.app).get('/api/v1/auth/me').set('Cookie', staff.cookie)).status).toBe(401);
      expect((await f.db.alert.findUniqueOrThrow({ where: { id: alert.id } })).stationId).toBe(f.stationA.id);
      const newLogin = await f.login(f.securityA.username);
      const disabled = await request(f.app).patch('/api/v1/staff/' + f.securityA.id).set('Cookie', admin.cookie).set('X-CSRF-Token', admin.csrf).send({ isActive: false });
      expect(disabled.status).toBe(200);
      expect((await request(f.app).get('/api/v1/auth/me').set('Cookie', newLogin.cookie)).status).toBe(401);
      expect((await f.login(f.securityA.username)).result.status).toBe(401);
    } finally { await f.db.alert.delete({ where: { id: alert.id } }); }
  });

  it('resets passwords, revokes sessions and requires a new password change', async () => {
    const admin = await f.login();
    const staff = await f.login(f.securityB.username);
    const password = 'Reset-fixture-passphrase-2026!';
    const reset = await request(f.app).post('/api/v1/staff/' + f.securityB.id + '/reset-password').set('Cookie', admin.cookie).set('X-CSRF-Token', admin.csrf).send({ newPassword: password });
    expect(reset.status).toBe(200);
    expect(reset.body.data.mustChangePassword).toBe(true);
    expect(reset.text).not.toContain(password);
    expect((await request(f.app).get('/api/v1/auth/me').set('Cookie', staff.cookie)).status).toBe(401);
    expect((await f.login(f.securityB.username)).result.status).toBe(401);
    expect((await f.login(f.securityB.username, password)).result.status).toBe(200);
    const audit = await f.db.auditLog.findFirst({ where: { entityId: f.securityB.id, action: 'STAFF_PASSWORD_RESET' } });
    expect(audit).not.toBeNull();
    expect(JSON.stringify(audit)).not.toContain(password);
  });

  it('deactivates stations and revokes affected sessions', async () => {
    const admin = await f.login();
    // Previous tests may reset credentials; use a separate fixture-owned user.
    const user = await f.db.adminUser.create({ data: { username: f.prefix + '.active', role: 'STATION_SECURITY', stationId: f.stationB.id, passwordHash: f.admin.passwordHash, mustChangePassword: false } });
    const staff = await f.login(user.username);
    const changed = await request(f.app).patch('/api/v1/stations/' + f.stationB.id).set('Cookie', admin.cookie).set('X-CSRF-Token', admin.csrf).send({ isActive: false });
    expect(changed.status).toBe(200);
    expect((await request(f.app).get('/api/v1/auth/me').set('Cookie', staff.cookie)).status).toBe(401);
    expect((await f.login(user.username)).result.status).toBe(401);
    const invalid = await request(f.app).post('/api/v1/staff').set('Cookie', admin.cookie).set('X-CSRF-Token', admin.csrf).send({ username: f.prefix + '.inactive', password: fixturePassword, stationId: f.stationB.id });
    expectError(invalid, 400, 'STATION_INACTIVE');
    const moved = await request(f.app).patch('/api/v1/staff/' + user.id).set('Cookie', admin.cookie).set('X-CSRF-Token', admin.csrf).send({ stationId: f.stationB.id });
    expectError(moved, 400, 'STATION_INACTIVE');
    await f.db.station.update({ where: { id: f.stationB.id }, data: { isActive: true } });
  });

  it('answers 404 NOT_FOUND when updating a station that does not exist', async () => {
    const admin = await f.login();
    expectError(await request(f.app).patch('/api/v1/stations/' + randomUUID()).set('Cookie', admin.cookie).set('X-CSRF-Token', admin.csrf).send({ name: 'Ghost' }), 404, 'NOT_FOUND');
  });

  it('filters and paginates the staff list by station for the Super Admin', async () => {
    const admin = await f.login();
    const extra = await f.db.adminUser.create({ data: { username: f.prefix + '.extra', role: 'STATION_SECURITY', stationId: f.stationA.id, passwordHash: f.admin.passwordHash, mustChangePassword: false } });
    const all = await request(f.app).get('/api/v1/staff?stationId=' + f.stationA.id + '&pageSize=100').set('Cookie', admin.cookie);
    expect(all.status).toBe(200);
    expect(all.body.data.items.length).toBeGreaterThanOrEqual(2);
    expect(all.body.data.items.every((row: { stationId: string }) => row.stationId === f.stationA.id)).toBe(true);
    const first = await request(f.app).get('/api/v1/staff?stationId=' + f.stationA.id + '&page=1&pageSize=1').set('Cookie', admin.cookie);
    const second = await request(f.app).get('/api/v1/staff?stationId=' + f.stationA.id + '&page=2&pageSize=1').set('Cookie', admin.cookie);
    expect(first.body.data).toMatchObject({ page: 1, pageSize: 1, total: all.body.data.total });
    expect(first.body.data.items).toHaveLength(1);
    expect(second.body.data.items).toHaveLength(1);
    expect(second.body.data.items[0].id).not.toBe(first.body.data.items[0].id);
    expect(all.body.data.items.some((row: { id: string }) => row.id === extra.id)).toBe(true);
    expectError(await request(f.app).get('/api/v1/staff?pageSize=101').set('Cookie', admin.cookie), 400, 'VALIDATION_ERROR');
    expectError(await request(f.app).get('/api/v1/staff?stationId=not-a-uuid').set('Cookie', admin.cookie), 400, 'VALIDATION_ERROR');
  });

  it('returns CONFLICT when the account is reassigned between the first read and the locked re-read', async () => {
    const admin = await f.login();
    const user = await f.db.adminUser.create({ data: { username: f.prefix + '.race', role: 'STATION_SECURITY', stationId: f.stationA.id, passwordHash: f.admin.passwordHash, mustChangePassword: false } });
    let moved = false;
    const extended = f.db.$extends({ query: { adminUser: { async findUnique({ args, query }) {
      const result = await query(args);
      if (!moved && args.where.id === user.id) {
        moved = true;
        await f.db.adminUser.update({ where: { id: user.id }, data: { stationId: f.stationB.id } });
      }
      return result;
    } } } });
    const app = createApp(f.config, undefined, undefined, extended as unknown as PrismaClient);
    const result = await request(app).patch('/api/v1/staff/' + user.id).set('Cookie', admin.cookie).set('X-CSRF-Token', admin.csrf).send({ isActive: false });
    expectError(result, 409, 'CONFLICT');
    expect((await f.db.adminUser.findUniqueOrThrow({ where: { id: user.id } })).isActive).toBe(true);
  });
});
