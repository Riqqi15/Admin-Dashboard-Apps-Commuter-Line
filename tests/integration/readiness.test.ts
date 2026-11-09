import { loadEnvFile } from 'node:process';
import pino from 'pino';
import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app';
import { parseEnv } from '../../src/config/env';
import { createPrisma } from '../../src/lib/prisma';

loadEnvFile('.env');
const config = parseEnv({ ...process.env, NODE_ENV: 'test', LOG_LEVEL: 'silent' });
const target = new URL(config.DATABASE_URL);
if (target.hostname !== '127.0.0.1' || target.port !== '5434' || target.pathname !== '/timetable_admin') throw new Error('Readiness test only targets local capstone database');
const prisma = createPrisma(config.DATABASE_URL);
const logger = pino({ level: 'silent' });
afterAll(() => prisma.$disconnect());

describe('Database readiness', () => {
  it('queries real PostgreSQL before returning ready', async () => {
    const app = createApp(config, logger, () => prisma.$queryRaw`SELECT 1`);
    const result = await request(app).get('/health/ready');
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ success: true, data: { status: 'ready', database: 'connected' } });
  });

  it('returns 503 without exposing database errors while liveness stays healthy', async () => {
    const app = createApp(config, logger, async () => { throw new Error('SECRET_DATABASE_PASSWORD'); });
    const result = await request(app).get('/health/ready');
    expect(result.status).toBe(503);
    expect(result.body.error.code).toBe('DATABASE_UNAVAILABLE');
    expect(result.text).not.toContain('SECRET_DATABASE_PASSWORD');
    expect((await request(app).get('/health/live')).status).toBe(200);
  });
});
