import { verify } from 'argon2';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../src/app';
import type { PrismaClient } from '../../src/generated/prisma/client';
import { adminFixture, cookieOf, fixturePassword } from '../helpers/admin-api';

vi.mock('argon2', async importOriginal => {
  const actual = await importOriginal<typeof import('argon2')>();
  return { ...actual, verify: vi.fn(actual.verify) };
});

let f: Awaited<ReturnType<typeof adminFixture>>;
beforeAll(async () => { f = await adminFixture(); });
afterAll(async () => { if (f) await f.cleanup(); });
const gate = () => {
  let release!: () => void;
  const promise = new Promise<void>(resolve => { release = resolve; });
  return { promise, release };
};

async function pausePasswordVerification() {
  const entered = gate();
  const resume = gate();
  const actual = await vi.importActual<typeof import('argon2')>('argon2');
  vi.mocked(verify).mockImplementationOnce(async (...args) => {
    const valid = await actual.verify(...args);
    entered.release();
    await resume.promise;
    return valid;
  });
  return { entered, resume };
}

async function user(suffix: string) {
  return f.db.adminUser.create({ data: { username: f.prefix + '.' + suffix, passwordHash: f.admin.passwordHash, role: 'STATION_SECURITY', stationId: f.stationA.id, mustChangePassword: false } });
}

describe('Session revocation under concurrent requests', () => {
  it('rejects an old-password login verified before an admin password reset', async () => {
    const account = await user('reset');
    const admin = await f.login();
    const pause = await pausePasswordVerification();
    const pending = f.login(account.username);
    try {
      await pause.entered.promise;
      const reset = await request(f.app).post('/api/v1/staff/' + account.id + '/reset-password').set('Cookie', admin.cookie).set('X-CSRF-Token', admin.csrf).send({ newPassword: 'Reset-race-passphrase-2026!' });
      expect(reset.status).toBe(200);
    } finally { pause.resume.release(); }
    expect((await pending).result.status).toBe(401);
  });

  it('rejects an old-username login verified before an account rename', async () => {
    const account = await user('rename');
    const admin = await f.login();
    const pause = await pausePasswordVerification();
    const pending = f.login(account.username);
    const username = f.prefix + '.renamed';
    try {
      await pause.entered.promise;
      const changed = await request(f.app).patch('/api/v1/staff/' + account.id).set('Cookie', admin.cookie).set('X-CSRF-Token', admin.csrf).send({ username });
      expect(changed.status).toBe(200);
    } finally { pause.resume.release(); }
    expect((await pending).result.status).toBe(401);
    expect((await f.login(username)).result.status).toBe(200);
  });

  it('cannot mint a replacement session when logout wins during password verification', async () => {
    const account = await user('logout');
    const login = await f.login(account.username);
    const pause = await pausePasswordVerification();
    const pending = request(f.app).post('/api/v1/auth/change-password').set('Cookie', login.cookie).set('X-CSRF-Token', login.csrf)
      .send({ currentPassword: fixturePassword, newPassword: 'Logout-race-passphrase-2026!' }).then(value => value);
    try {
      await pause.entered.promise;
      expect((await request(f.app).post('/api/v1/auth/logout').set('Cookie', login.cookie).set('X-CSRF-Token', login.csrf).send({})).status).toBe(200);
    } finally { pause.resume.release(); }
    expect((await pending).status).toBe(401);
    expect(await f.db.adminSession.count({ where: { adminUserId: account.id, revokedAt: null } })).toBe(0);
  });

  it('serializes logout after a password change that has already read its session', async () => {
    const account = await user('logout-lock');
    const login = await f.login(account.username);
    const session = await f.db.adminSession.findFirstOrThrow({ where: { adminUserId: account.id, revokedAt: null } });
    const sessionRead = gate();
    const resumeChange = gate();
    let replacementCommittedBeforeLogout = false;
    const extended = f.db.$extends({ query: { adminSession: {
      async findUnique({ args, query }) {
        const result = await query(args);
        if (args.where.id === session.id) {
          // The password-change transaction now holds the user lock and a valid session snapshot.
          sessionRead.release();
          await resumeChange.promise;
        }
        return result;
      },
      async updateMany({ args, query }) {
        if (args.where?.id === session.id) {
          // Logout reached this point only after acquiring the same user lock. A separate
          // connection must already see the replacement, proving password change committed.
          replacementCommittedBeforeLogout = await f.db.adminSession.count({
            where: { adminUserId: account.id, id: { not: session.id }, revokedAt: null },
          }) === 1;
        }
        return query(args);
      },
    } } });
    const app = createApp(f.config, undefined, undefined, extended as unknown as PrismaClient);
    const change = request(app).post('/api/v1/auth/change-password').set('Cookie', login.cookie).set('X-CSRF-Token', login.csrf)
      .send({ currentPassword: fixturePassword, newPassword: 'Serialized-logout-passphrase-2026!' }).then(value => value);
    let logout: Promise<request.Response> | undefined;
    let logoutWaitedForUser = false;
    try {
      await sessionRead.promise;
      logout = request(app).post('/api/v1/auth/logout').set('Cookie', login.cookie).set('X-CSRF-Token', login.csrf).send({}).then(value => value);
      const deadline = Date.now() + 2500;
      do {
        const rows = await f.db.$queryRaw<Array<{ waiting: boolean }>>`SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE application_name = ${f.prefix} AND wait_event_type = 'Lock' AND query LIKE '%admin_users%' AND query LIKE '%FOR UPDATE%') AS waiting`;
        logoutWaitedForUser = rows[0]?.waiting === true;
        if (logoutWaitedForUser) break;
        await new Promise(resolve => setTimeout(resolve, 15));
      } while (Date.now() < deadline);
    } finally { resumeChange.release(); }
    const changed = await change;
    const loggedOut = await logout!;
    expect(logoutWaitedForUser, 'Logout must wait for the password-change user lock').toBe(true);
    expect(changed.status).toBe(200);
    expect(loggedOut.status).toBe(200);
    expect(replacementCommittedBeforeLogout).toBe(true);
    expect((await request(f.app).get('/api/v1/auth/me').set('Cookie', login.cookie)).status).toBe(401);
    expect((await request(f.app).get('/api/v1/auth/me').set('Cookie', cookieOf(changed))).status).toBe(200);
  }, 15000);

  it('locks station before session rows so station deactivation and reset cannot deadlock', async () => {
    const account = await user('locking');
    const login = await f.login(account.username);
    const admin = await f.login();
    const session = await f.db.adminSession.findFirstOrThrow({ where: { adminUserId: account.id, revokedAt: null } });
    const locked = gate();
    const unblock = gate();
    const blocker = f.db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM admin_sessions WHERE id = ${session.id}::uuid FOR UPDATE`;
      locked.release();
      await unblock.promise;
    }, { timeout: 10000 });
    await locked.promise;
    const reset = request(f.app).post('/api/v1/staff/' + account.id + '/reset-password').set('Cookie', admin.cookie).set('X-CSRF-Token', admin.csrf)
      .send({ newPassword: 'Locking-race-passphrase-2026!' }).then(value => value);
    let deactivate: Promise<request.Response> | undefined;
    async function waitForLock(table: string) {
      const deadline = Date.now() + 2500;
      do {
        const rows = await f.db.$queryRaw<Array<{ waiting: boolean }>>`SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE application_name = ${f.prefix} AND wait_event_type = 'Lock' AND query LIKE ${'%' + table + '%'}) AS waiting`;
        if (rows[0]?.waiting) return;
        await new Promise(resolve => setTimeout(resolve, 15));
      } while (Date.now() < deadline);
      throw new Error('Expected lock order was not observed for ' + table);
    }
    try {
      await waitForLock('admin_sessions');
      deactivate = request(f.app).patch('/api/v1/stations/' + f.stationA.id).set('Cookie', admin.cookie).set('X-CSRF-Token', admin.csrf).send({ isActive: false }).then(value => value);
      await waitForLock('stations');
    } finally { unblock.release(); }
    await blocker;
    expect((await reset).status).toBe(200);
    expect((await deactivate!).status).toBe(200);
    expect((await request(f.app).get('/api/v1/auth/me').set('Cookie', login.cookie)).status).toBe(401);
  }, 15000);
});
