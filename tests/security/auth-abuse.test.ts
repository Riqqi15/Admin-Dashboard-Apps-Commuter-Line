import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app';
import { adminFixture, fixturePassword } from '../helpers/admin-api';

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
      expect((await call.send({})).status).toBe(403);
    }
    expect((await request(f.app).post('/api/v1/auth/logout').set('Cookie', first.cookie)
      .set('X-CSRF-Token', first.csrf).set('Origin', 'https://attacker.example').send({})).status).toBe(403);
    expect((await request(f.app).get('/api/v1/auth/me').set('Cookie', first.cookie)).status).toBe(200);
    expect((await request(f.app).post('/api/v1/auth/login').type('form').send({ username: f.admin.username, password: fixturePassword })).status).toBe(415);
  });

  it('rejects unknown fields, forged/fixed tokens, URL tokens, and duplicate session cookies', async () => {
    expect((await request(f.app).post('/api/v1/auth/login').send({ username: f.admin.username, password: fixturePassword, role: 'SUPER_ADMIN' })).status).toBe(400);
    const first = await f.login();
    expect((await request(f.app).get('/api/v1/auth/me').set('Cookie', 'admin_session=' + 'a'.repeat(64))).status).toBe(401);
    expect((await request(f.app).get('/api/v1/auth/me?admin_session=' + first.cookie.split('=')[1])).status).toBe(401);
    expect((await request(f.app).get('/api/v1/auth/me').set('Cookie', first.cookie + '; ' + first.cookie)).status).toBe(401);
    const fixed = await request(f.app).post('/api/v1/auth/login').set('Cookie', 'admin_session=' + 'b'.repeat(64)).send({ username: f.admin.username, password: fixturePassword });
    expect(fixed.status).toBe(200);
    expect(String(fixed.headers['set-cookie'])).not.toContain('b'.repeat(64));
  });

  it('blocks the sixth failed attempt for a normalized username and IP, ignoring spoofed forwarding headers', async () => {
    const app = createApp(f.config, undefined, undefined, f.db);
    for (let i = 0; i < 5; i++) {
      const username = i % 2 ? ' ' + f.admin.username.toUpperCase() + ' ' : f.admin.username;
      expect((await request(app).post('/api/v1/auth/login').set('X-Forwarded-For', `198.51.100.${i + 1}`)
        .send({ username, password: 'wrong-password' })).status).toBe(401);
    }
    const limited = await request(app).post('/api/v1/auth/login').send({ username: f.admin.username, password: fixturePassword });
    expect(limited.status).toBe(429);
    expect(limited.headers['retry-after']).toBeDefined();
  });

  it('blocks the thirty-first login attempt from one IP even with valid credentials', async () => {
    const app = createApp(f.config, undefined, undefined, f.db);
    for (let i = 0; i < 30; i++) {
      expect((await request(app).post('/api/v1/auth/login').send({ username: f.admin.username, password: fixturePassword })).status).toBe(200);
    }
    expect((await request(app).post('/api/v1/auth/login').send({ username: f.admin.username, password: fixturePassword })).status).toBe(429);
  }, 30000);
});
