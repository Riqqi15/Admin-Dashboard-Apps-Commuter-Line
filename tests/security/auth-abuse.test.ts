import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app';
import { adminFixture, fixturePassword } from '../helpers/admin-api';
import { expectError } from '../helpers/expect-error';

let f: Awaited<ReturnType<typeof adminFixture>>;
beforeAll(async () => { f = await adminFixture(); });
afterAll(async () => { if (f) await f.cleanup(); });

describe('Authentication abuse controls', () => {
  it('requires the session CSRF token on mutations and refuses cross-origin requests', async () => {
    const first = await f.login();
    const second = await f.login();
    for (const token of [undefined, 'wrong', second.csrf]) {
      let call = request(f.app).post('/api/v1/auth/logout').set('Cookie', first.cookie);
      if (token) call = call.set('X-CSRF-Token', token);
      expectError(await call.send({}), 403, 'CSRF_INVALID');
    }
    expectError(await request(f.app).post('/api/v1/auth/logout').set('Cookie', first.cookie)
      .set('X-CSRF-Token', first.csrf).set('Origin', 'https://attacker.example').send({}), 403, 'ORIGIN_NOT_ALLOWED');
    expect((await request(f.app).get('/api/v1/auth/me').set('Cookie', first.cookie)).status).toBe(200);
    expectError(await request(f.app).post('/api/v1/auth/login').type('form').send({ username: f.admin.username, password: fixturePassword }), 415, 'JSON_REQUIRED');
  });

  it('rejects unknown fields, forged/fixed tokens, URL tokens, and duplicate session cookies', async () => {
    expectError(await request(f.app).post('/api/v1/auth/login').send({ username: f.admin.username, password: fixturePassword, role: 'SUPER_ADMIN' }), 400, 'VALIDATION_ERROR');
    const first = await f.login();
    expectError(await request(f.app).get('/api/v1/auth/me').set('Cookie', 'admin_session=' + 'a'.repeat(64)), 401, 'UNAUTHENTICATED');
    expectError(await request(f.app).get('/api/v1/auth/me?admin_session=' + first.cookie.split('=')[1]), 401, 'UNAUTHENTICATED');
    expectError(await request(f.app).get('/api/v1/auth/me').set('Cookie', first.cookie + '; ' + first.cookie), 401, 'UNAUTHENTICATED');
    const fixed = await request(f.app).post('/api/v1/auth/login').set('Cookie', 'admin_session=' + 'b'.repeat(64)).send({ username: f.admin.username, password: fixturePassword });
    expect(fixed.status).toBe(200);
    expect(String(fixed.headers['set-cookie'])).not.toContain('b'.repeat(64));
  });

  it('blocks the sixth failed attempt for a normalized username and IP, ignoring spoofed forwarding headers', async () => {
    const app = createApp(f.config, undefined, undefined, f.db);
    for (let i = 0; i < 5; i++) {
      const username = i % 2 ? ' ' + f.admin.username.toUpperCase() + ' ' : f.admin.username;
      expectError(await request(app).post('/api/v1/auth/login').set('X-Forwarded-For', `198.51.100.${i + 1}`)
        .send({ username, password: 'wrong-password' }), 401, 'INVALID_CREDENTIALS');
    }
    const limited = await request(app).post('/api/v1/auth/login').send({ username: f.admin.username, password: fixturePassword });
    expectError(limited, 429, 'RATE_LIMITED');
    expect(limited.headers['retry-after']).toBeDefined();
  });

  it('blocks the thirty-first login attempt from one IP even with valid credentials', async () => {
    const app = createApp(f.config, undefined, undefined, f.db);
    for (let i = 0; i < 30; i++) {
      expect((await request(app).post('/api/v1/auth/login').send({ username: f.admin.username, password: fixturePassword })).status).toBe(200);
    }
    expectError(await request(app).post('/api/v1/auth/login').send({ username: f.admin.username, password: fixturePassword }), 429, 'RATE_LIMITED');
  }, 30000);
});
