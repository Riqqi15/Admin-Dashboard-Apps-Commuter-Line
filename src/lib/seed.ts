import { argon2id, hash } from 'argon2';
import { z } from 'zod';
import type { PrismaClient } from '../generated/prisma/client';

type SeedClient = Pick<PrismaClient, 'station' | 'adminUser'>;
const password = z.string().min(12).max(128);
const secretsSchema = z.object({ SEED_SUPER_ADMIN_PASSWORD: password, SEED_SECURITY_A_PASSWORD: password, SEED_SECURITY_B_PASSWORD: password });

export async function seedDemo(client: SeedClient, input: Record<string, string | undefined>) {
  if (input.NODE_ENV !== 'development') throw new Error('Demo seed requires development mode');
  const parsed = secretsSchema.safeParse(input);
  if (!parsed.success) throw new Error('Missing or invalid seed variables: ' + parsed.error.issues.map(issue => issue.path.join('.')).join(', '));
  const secrets = parsed.data;
  const stationA = await client.station.upsert({ where: { code: 'MGG-DEMO' }, update: {}, create: { code: 'MGG-DEMO', name: 'Manggarai (demo)' } });
  const stationB = await client.station.upsert({ where: { code: 'THB-DEMO' }, update: {}, create: { code: 'THB-DEMO', name: 'Tanah Abang (demo)' } });

  async function account(username: string, role: 'SUPER_ADMIN' | 'STATION_SECURITY', stationId: string | null, plaintext: string) {
    const existing = await client.adminUser.findUnique({ where: { username } });
    if (existing && (existing.role !== role || existing.stationId !== stationId)) throw new Error('Seed account conflicts with existing station or role');
    if (!existing) {
      await client.adminUser.create({ data: {
        username, role, stationId, mustChangePassword: true,
        passwordHash: await hash(plaintext, { type: argon2id, memoryCost: 65536, timeCost: 3, parallelism: 1 }),
      } });
    }
    return client.adminUser.findUniqueOrThrow({ where: { username }, select: { id: true, username: true, role: true, stationId: true } });
  }
  return {
    stationA: { id: stationA.id, code: stationA.code },
    stationB: { id: stationB.id, code: stationB.code },
    superAdmin: await account('superadmin', 'SUPER_ADMIN', null, secrets.SEED_SUPER_ADMIN_PASSWORD),
    securityA: await account('security.manggarai', 'STATION_SECURITY', stationA.id, secrets.SEED_SECURITY_A_PASSWORD),
    securityB: await account('security.tanahabang', 'STATION_SECURITY', stationB.id, secrets.SEED_SECURITY_B_PASSWORD),
  };
}
