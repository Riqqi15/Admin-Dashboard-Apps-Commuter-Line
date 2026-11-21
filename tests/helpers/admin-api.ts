import { randomUUID } from 'node:crypto';
import { loadEnvFile } from 'node:process';
import { argon2id, hash } from 'argon2';
import request from 'supertest';
import { createApp } from '../../src/app';
import { parseEnv } from '../../src/config/env';
import { createPrisma } from '../../src/lib/prisma';

loadEnvFile('.env');
export const fixturePassword = 'Fixture-passphrase-2026!';
const passwordHash = hash(fixturePassword, { type: argon2id, memoryCost: 65536, timeCost: 3, parallelism: 1 });

export async function adminFixture() {
  const prefix = 'test.' + randomUUID().slice(0, 8);
  const databaseUrl = new URL(process.env.DATABASE_URL!);
  databaseUrl.searchParams.set('application_name', prefix);
  const config = parseEnv({ ...process.env, DATABASE_URL: databaseUrl.toString(), NODE_ENV: 'test', LOG_LEVEL: 'silent', SIMULATOR_INGEST_KEY: 'fixture-ingest-key-' + randomUUID() });
  const target = new URL(config.DATABASE_URL);
  if (target.hostname !== '127.0.0.1' || !['5434', '5435'].includes(target.port) || target.pathname !== '/timetable_admin') {
    throw new Error('API fixtures require the isolated capstone database');
  }
  const db = createPrisma(config.DATABASE_URL);
  const stations = await Promise.all(['A', 'B'].map(suffix => db.station.create({ data: { code: `${prefix}-${suffix}`.toUpperCase(), name: `Fixture ${suffix}` } })));
  const stationA = stations[0]!;
  const stationB = stations[1]!;
  const users = await Promise.all([
    db.adminUser.create({ data: { username: prefix + '.admin', passwordHash: await passwordHash, role: 'SUPER_ADMIN', mustChangePassword: false } }),
    db.adminUser.create({ data: { username: prefix + '.a', passwordHash: await passwordHash, role: 'STATION_SECURITY', stationId: stationA.id, mustChangePassword: false } }),
    db.adminUser.create({ data: { username: prefix + '.b', passwordHash: await passwordHash, role: 'STATION_SECURITY', stationId: stationB.id, mustChangePassword: false } }),
  ]);
  const app = createApp(config, undefined, () => db.$queryRaw`SELECT 1`, db);
  const login = async (username = users[0]!.username, password = fixturePassword) => {
    const result = await request(app).post('/api/v1/auth/login').send({ username, password });
    return { result, cookie: cookieOf(result), csrf: result.body.data?.csrfToken as string };
  };
  return {
    config, db, app, prefix, stationA, stationB, admin: users[0]!, securityA: users[1]!, securityB: users[2]!, login,
    async cleanup() {
      // Delete only UUID-owned fixture rows, never seed/demo or unrelated project data.
      const stationIds = (await db.station.findMany({ where: { code: { startsWith: prefix.toUpperCase() } }, select: { id: true } })).map(s => s.id);
      const userIds = (await db.adminUser.findMany({ where: { username: { startsWith: prefix } }, select: { id: true } })).map(u => u.id);
      const trackedIds = (await db.trackedUser.findMany({ where: { externalUserId: { startsWith: prefix } }, select: { id: true } })).map(u => u.id);
      const cameraIds = (await db.cameraSession.findMany({ where: { stationId: { in: stationIds } }, select: { id: true } })).map(s => s.id);
      await db.alert.deleteMany({ where: { stationId: { in: stationIds } } });
      await db.cameraEvent.deleteMany({ where: { cameraSessionId: { in: cameraIds } } });
      await db.cameraSession.deleteMany({ where: { id: { in: cameraIds } } });
      await db.trackedUser.deleteMany({ where: { id: { in: trackedIds } } });
      await db.auditLog.deleteMany({ where: { OR: [{ actorAdminUserId: { in: userIds } }, { stationId: { in: stationIds } }] } });
      await db.adminSession.deleteMany({ where: { adminUserId: { in: userIds } } });
      await db.adminUser.deleteMany({ where: { id: { in: userIds } } });
      await db.dailyUsageStat.deleteMany({ where: { stationId: { in: stationIds } } });
      await db.station.deleteMany({ where: { id: { in: stationIds } } });
      await db.$disconnect();
    },
  };
}

export function cookieOf(result: { headers: Record<string, unknown> }): string {
  const raw = result.headers['set-cookie'];
  const cookies = Array.isArray(raw) ? raw : typeof raw === 'string' ? [raw] : [];
  return (cookies.find((value: string) => value.startsWith('admin_session=')) || '').split(';')[0]!;
}
