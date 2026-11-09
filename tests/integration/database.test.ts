import { randomUUID } from 'node:crypto';
import { loadEnvFile } from 'node:process';
import { afterAll, describe, expect, it } from 'vitest';
import { createPrisma } from '../../src/lib/prisma';
import type { Prisma } from '../../src/generated/prisma/client';

loadEnvFile('.env');
const url = new URL(process.env.DATABASE_URL!);
if (url.hostname !== '127.0.0.1' || !['5434', '5435'].includes(url.port) || url.pathname !== '/timetable_admin') {
  throw new Error('Database tests require the isolated local capstone database');
}
const prisma = createPrisma(url.toString());
afterAll(() => prisma.$disconnect());

async function rollback(run: (tx: Prisma.TransactionClient) => Promise<void>) {
  const sentinel = new Error('ROLLBACK_TEST_FIXTURE');
  try {
    await prisma.$transaction(async tx => { await run(tx); throw sentinel; });
  } catch (error) { if (error !== sentinel) throw error; }
}

const station = (tx: Prisma.TransactionClient) => tx.station.create({ data: { code: randomUUID().slice(0, 20).toUpperCase(), name: 'Fixture station' } });

describe('PostgreSQL schema integration (fixtures rolled back)', () => {
  it('executes a safe SELECT 1 through Prisma', async () => {
    expect(await prisma.$queryRaw<Array<{ value: number }>>`SELECT 1 AS value`).toEqual([{ value: 1 }]);
  });

  it('enforces one station for station security at database level', async () => {
    await rollback(async tx => {
      await expect(tx.adminUser.create({ data: { username: randomUUID(), passwordHash: 'fixture-only', role: 'STATION_SECURITY' } })).rejects.toThrow(/admin_users_role_station_check/);
    });
    await rollback(async tx => {
      const assigned = await station(tx);
      await expect(tx.adminUser.create({ data: { username: randomUUID(), passwordHash: 'fixture-only', role: 'SUPER_ADMIN', stationId: assigned.id } })).rejects.toThrow(/admin_users_role_station_check/);
    });
    await rollback(async tx => {
      const assigned = await station(tx);
      const security = await tx.adminUser.create({ data: { username: randomUUID(), passwordHash: 'fixture-only', role: 'STATION_SECURITY', stationId: assigned.id } });
      expect(security.stationId).toBe(assigned.id);
    });
  });

  it('rejects non-normalized usernames and negative counters', async () => {
    await rollback(async tx => {
      await expect(tx.adminUser.create({ data: { username: 'UPPERCASE', passwordHash: 'fixture-only', role: 'SUPER_ADMIN' } })).rejects.toThrow(/admin_users_username_check/);
    });
    await rollback(async tx => {
      const assigned = await station(tx);
      await expect(tx.dailyUsageStat.create({ data: { stationId: assigned.id, statDate: new Date(), sessionCount: -1 } })).rejects.toThrow(/daily_usage_stats_counts_check/);
    });
  });

  it('keeps exactly one alert per session and allows retention to unlink the session', async () => {
    await rollback(async tx => {
      const assigned = await station(tx);
      const now = new Date();
      const expiresAt = new Date(now.getTime() + 7 * 86400000);
      const tracked = await tx.trackedUser.create({ data: { externalUserId: randomUUID(), displayNameCiphertext: 'encrypted-fixture', lastSeenAt: now, expiresAt } });
      const session = await tx.cameraSession.create({ data: { externalSessionId: randomUUID(), payloadFingerprint: 'a'.repeat(64), trackedUserId: tracked.id, stationId: assigned.id, source: 'SIMULATOR', startedAt: now, expiresAt } });
      const data = { cameraSessionId: session.id, sourceSessionId: session.id, stationId: assigned.id, trackedUserId: tracked.id, failureType: 'CAMERA_INIT_FAILED' as const, expiresAt: new Date(now.getTime() + 30 * 86400000) };
      const alert = await tx.alert.create({ data });
      // createMany(skipDuplicates) must not produce a second alert.
      expect((await tx.alert.createMany({ data: [data], skipDuplicates: true })).count).toBe(0);
      await tx.cameraSession.delete({ where: { id: session.id } });
      await tx.trackedUser.delete({ where: { id: tracked.id } });
      const retained = await tx.alert.findUniqueOrThrow({ where: { id: alert.id } });
      expect(retained.cameraSessionId).toBeNull();
      expect(retained.trackedUserId).toBeNull();
      expect(retained.sourceSessionId).toBe(session.id);
    });
  });
});
