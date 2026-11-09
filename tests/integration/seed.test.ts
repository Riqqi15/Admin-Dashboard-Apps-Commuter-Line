import { randomBytes } from 'node:crypto';
import { loadEnvFile } from 'node:process';
import { verify } from 'argon2';
import { afterAll, describe, expect, it } from 'vitest';
import { createPrisma } from '../../src/lib/prisma';
import { seedDemo } from '../../src/lib/seed';

loadEnvFile('.env');
const url = new URL(process.env.DATABASE_URL!);
if (url.hostname !== '127.0.0.1' || !['5434', '5435'].includes(url.port) || url.pathname !== '/timetable_admin') throw new Error('Seed tests require isolated local database');
const prisma = createPrisma(url.toString());
afterAll(() => prisma.$disconnect());
const credentials = {
  NODE_ENV: 'development',
  SEED_SUPER_ADMIN_PASSWORD: randomBytes(24).toString('hex'),
  SEED_SECURITY_A_PASSWORD: randomBytes(24).toString('hex'),
  SEED_SECURITY_B_PASSWORD: randomBytes(24).toString('hex'),
};

describe('Demo seed', () => {
  it('rejects production and missing passwords before any database use', async () => {
    await expect(seedDemo(prisma, { ...credentials, NODE_ENV: 'production' })).rejects.toThrow(/development/);
    await expect(seedDemo(prisma, { NODE_ENV: 'development' })).rejects.toThrow(/SEED_/);
  });

  it('is idempotent, hashes passwords and preserves accounts on repeat', async () => {
    const sentinel = new Error('ROLLBACK_SEED');
    try {
      await prisma.$transaction(async tx => {
        const first = await seedDemo(tx, credentials);
        const account = await tx.adminUser.findUniqueOrThrow({ where: { id: first.superAdmin.id } });
        const existed = await tx.adminUser.count({ where: { id: { in: [first.superAdmin.id, first.securityA.id, first.securityB.id] } } });
        expect(existed).toBe(3);
        expect(account.passwordHash).toMatch(/^\$argon2id\$/);
        // Fixture may already be seeded locally: repeat must preserve the existing hash.
        const second = await seedDemo(tx, { ...credentials, SEED_SUPER_ADMIN_PASSWORD: randomBytes(24).toString('hex') });
        expect(second).toEqual(first);
        expect((await tx.adminUser.findUniqueOrThrow({ where: { id: account.id } })).passwordHash).toBe(account.passwordHash);
        expect(first.securityA.stationId).not.toBe(first.securityB.stationId);
        expect(first.superAdmin.stationId).toBeNull();
        expect(await verify(account.passwordHash, 'definitely-wrong-password')).toBe(false);
        throw sentinel;
      }, { timeout: 15000 });
    } catch (error) { if (error !== sentinel) throw error; }
  });
});
