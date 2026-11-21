import { createHmac } from 'node:crypto';
import { verify } from 'argon2';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app';
import { adminFixture, cookieOf, fixturePassword } from '../helpers/admin-api';
import { expectError } from '../helpers/expect-error';

let f: Awaited<ReturnType<typeof adminFixture>>;
beforeAll(async () => { f = await adminFixture(); });
afterAll(async () => { if (f) await f.cleanup(); });

describe('Username/password authentication with real PostgreSQL sessions', () => {
  it('normalizes username, returns a safe profile and stores only token hashes', async () => {
    const { result, cookie, csrf } = await f.login('  ' + f.admin.username.toUpperCase() + '  ');
    expect(result.status).toBe(200);
    expect(result.body.data.user).toMatchObject({ id: f.admin.id, username: f.admin.username, role: 'SUPER_ADMIN', stationId: null });
    expect(result.text).not.toMatch(/passwordHash|tokenHash|csrfTokenHash/);
    const rawCookie = String(result.headers['set-cookie']);
    expect(rawCookie).toContain('HttpOnly');
    expect(rawCookie).toContain('SameSite=Strict');
    expect(rawCookie).toContain('Path=/api/v1');
    const token = cookie.slice('admin_session='.length);
    expect(token).toMatch(/^[a-f0-9]{64}$/);
    expect(csrf).toMatch(/^[a-f0-9]{64}$/);
    expect(result.text).not.toContain(token);
    const tokenHash = createHmac('sha256', f.config.SESSION_PEPPER).update('session:' + token).digest('hex');
    const session = await f.db.adminSession.findUniqueOrThrow({ where: { tokenHash } });
    expect(session.tokenHash).not.toBe(token);
    expect(session.csrfTokenHash).not.toBe(csrf);
    expect(session.expiresAt.getTime() - session.createdAt.getTime()).toBeLessThanOrEqual(8 * 60 * 60 * 1000 + 1000);
    const me = await request(f.app).get('/api/v1/auth/me').set('Cookie', cookie);
    expect(me.status).toBe(200);
    expect(me.body.data.id).toBe(f.admin.id);
    expect(me.text).not.toMatch(/passwordHash|tokenHash|csrfTokenHash/);
  });

  it('uses identical errors for unknown user, wrong password, inactive account and station', async () => {
    const wrong = await f.login(f.admin.username, 'wrong-password');
    const unknown = await f.login(f.prefix + '.unknown', 'wrong-password');
    await f.db.adminUser.update({ where: { id: f.securityB.id }, data: { isActive: false } });
    const disabled = await f.login(f.securityB.username);
    await f.db.adminUser.update({ where: { id: f.securityB.id }, data: { isActive: true } });
    await f.db.station.update({ where: { id: f.stationB.id }, data: { isActive: false } });
    const disabledStation = await f.login(f.securityB.username);
    await f.db.station.update({ where: { id: f.stationB.id }, data: { isActive: true } });
    for (const attempt of [wrong, unknown, disabled, disabledStation]) {
      expectError(attempt.result, 401, 'INVALID_CREDENTIALS');
      expect(attempt.result.body).toEqual(wrong.result.body);
      expect(attempt.cookie).toBe('');
    }
  });

  it('revokes logout sessions and rejects expired or deactivated sessions', async () => {
    const first = await f.login();
    const logout = await request(f.app).post('/api/v1/auth/logout').set('Cookie', first.cookie).set('X-CSRF-Token', first.csrf).send({});
    expect(logout.status).toBe(200);
    expectError(await request(f.app).get('/api/v1/auth/me').set('Cookie', first.cookie), 401, 'UNAUTHENTICATED');
    const expired = await f.login();
    await f.db.adminSession.updateMany({ where: { adminUserId: f.admin.id, revokedAt: null }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expectError(await request(f.app).get('/api/v1/auth/me').set('Cookie', expired.cookie), 401, 'UNAUTHENTICATED');
    const disabled = await f.login(f.securityA.username);
    await f.db.adminUser.update({ where: { id: f.securityA.id }, data: { isActive: false } });
    expectError(await request(f.app).get('/api/v1/auth/me').set('Cookie', disabled.cookie), 401, 'UNAUTHENTICATED');
    await f.db.adminUser.update({ where: { id: f.securityA.id }, data: { isActive: true } });
    expectError(await request(f.app).get('/api/v1/auth/me').set('Cookie', disabled.cookie), 401, 'UNAUTHENTICATED');
  });

  it('rejects reusing the current password and a wrong current password with distinct codes', async () => {
    const session = await f.login(f.securityA.username);
    const change = (body: object) => request(f.app).post('/api/v1/auth/change-password').set('Cookie', session.cookie).set('X-CSRF-Token', session.csrf).send(body);
    expectError(await change({ currentPassword: fixturePassword, newPassword: fixturePassword }), 400, 'PASSWORD_REUSE');
    expectError(await change({ currentPassword: 'Wrong-current-passphrase-2026!', newPassword: 'Another-fixture-passphrase-2026!' }), 401, 'INVALID_CREDENTIALS');
    expect((await request(f.app).get('/api/v1/auth/me').set('Cookie', session.cookie)).status).toBe(200);
  });

  it('rotates the current session, revokes other sessions and clears the temporary-password flag', async () => {
    const first = await f.login(f.securityB.username);
    const other = await f.login(f.securityB.username);
    await f.db.adminUser.update({ where: { id: f.securityB.id }, data: { mustChangePassword: true } });
    const updated = await request(f.app).post('/api/v1/auth/change-password').set('Cookie', first.cookie).set('X-CSRF-Token', first.csrf)
      .send({ currentPassword: fixturePassword, newPassword: 'Changed-fixture-passphrase-2026!' });
    expect(updated.status).toBe(200);
    expect(updated.body.data.user.mustChangePassword).toBe(false);
    expect(cookieOf(updated)).not.toBe(first.cookie);
    expectError(await request(f.app).get('/api/v1/auth/me').set('Cookie', first.cookie), 401, 'UNAUTHENTICATED');
    expectError(await request(f.app).get('/api/v1/auth/me').set('Cookie', other.cookie), 401, 'UNAUTHENTICATED');
    expect((await request(f.app).get('/api/v1/auth/me').set('Cookie', cookieOf(updated))).status).toBe(200);
    const stored = await f.db.adminUser.findUniqueOrThrow({ where: { id: f.securityB.id } });
    expect(await verify(stored.passwordHash, 'Changed-fixture-passphrase-2026!')).toBe(true);
    expect(await verify(stored.passwordHash, fixturePassword)).toBe(false);
  });

  it('sets Secure cookies in production', async () => {
    const app = createApp({ ...f.config, NODE_ENV: 'production', CORS_ORIGIN: 'https://admin.example.test' }, undefined, undefined, f.db);
    const result = await request(app).post('/api/v1/auth/login').send({ username: f.admin.username, password: fixturePassword });
    expect(result.status).toBe(200);
    expect(String(result.headers['set-cookie'])).toContain('Secure');
  });
});
