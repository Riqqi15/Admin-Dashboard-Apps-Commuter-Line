import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminFixture, fixturePassword } from '../helpers/admin-api';

let f: Awaited<ReturnType<typeof adminFixture>>;
beforeAll(async () => { f = await adminFixture(); });
afterAll(async () => { if (f) await f.cleanup(); });

describe('Station scope and management authorization', () => {
  it('limits station security to their own station and denies all management operations', async () => {
    const staff = await f.login(f.securityA.username);
    const list = await request(f.app).get('/api/v1/stations').set('Cookie', staff.cookie);
    expect(list.status).toBe(200);
    expect(list.body.data.items.map((station: { id: string }) => station.id)).toEqual([f.stationA.id]);
    const denied = await request(f.app).get('/api/v1/stations?stationId=' + f.stationB.id).set('Cookie', staff.cookie);
    expect(denied.status).toBe(403);
    const attempts = [
      request(f.app).get('/api/v1/staff'),
      request(f.app).post('/api/v1/stations').send({ code: 'BOLA', name: 'Forbidden' }),
      request(f.app).patch('/api/v1/stations/' + f.stationB.id).send({ name: 'Forbidden' }),
      request(f.app).post('/api/v1/staff').send({ username: f.prefix + '.evil', password: fixturePassword, stationId: f.stationB.id }),
      request(f.app).patch('/api/v1/staff/' + f.securityB.id).send({ stationId: f.stationA.id }),
      request(f.app).post('/api/v1/staff/' + f.securityB.id + '/reset-password').send({ newPassword: fixturePassword }),
    ];
    for (const attempt of attempts) expect((await attempt.set('Cookie', staff.cookie).set('X-CSRF-Token', staff.csrf)).status).toBe(403);
    expect((await f.db.station.findUniqueOrThrow({ where: { id: f.stationB.id } })).name).toBe('Fixture B');
  });

  it('rejects mass-assignment, missing CSRF and edits of Super Admin through staff routes', async () => {
    const admin = await f.login();
    for (const fields of [{ role: 'SUPER_ADMIN' }, { passwordHash: 'attacker' }, { mustChangePassword: false }, { stationId: null }]) {
      const result = await request(f.app).patch('/api/v1/staff/' + f.securityA.id).set('Cookie', admin.cookie).set('X-CSRF-Token', admin.csrf).send(fields);
      expect(result.status).toBe(400);
    }
    expect((await request(f.app).patch('/api/v1/staff/' + f.securityA.id).set('Cookie', admin.cookie).send({ isActive: false })).status).toBe(403);
    expect((await request(f.app).patch('/api/v1/staff/' + f.admin.id).set('Cookie', admin.cookie).set('X-CSRF-Token', admin.csrf).send({ isActive: false })).status).toBe(404);
    expect((await request(f.app).post('/api/v1/staff/' + f.admin.id + '/reset-password').set('Cookie', admin.cookie).set('X-CSRF-Token', admin.csrf).send({ newPassword: fixturePassword })).status).toBe(404);
    expect((await request(f.app).patch('/api/v1/stations/not-a-uuid').set('Cookie', admin.cookie).set('X-CSRF-Token', admin.csrf).send({ name: 'Invalid' })).status).toBe(400);
    expect((await request(f.app).get('/api/v1/stations')).status).toBe(401);
  });
});
