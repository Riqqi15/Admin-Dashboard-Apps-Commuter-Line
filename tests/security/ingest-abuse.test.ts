import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app';
import { adminFixture } from '../helpers/admin-api';
import { ingestEvent, ingestSession, sessionPayload } from '../helpers/camera-api';

let f: Awaited<ReturnType<typeof adminFixture>>;
beforeAll(async () => { f = await adminFixture(); });
afterAll(async () => { if (f) await f.cleanup(); });

describe('Ingest trust boundary', () => {
  it('requires a key, rejects media/unknown fields, mobile source and inactive stations', async () => {
    const input = sessionPayload(f);
    expect((await request(f.app).post('/api/v1/ingest/sessions').send(input)).status).toBe(401);
    expect((await request(f.app).post('/api/v1/ingest/sessions').set('X-Ingest-Key', 'wrong-key').send(input)).status).toBe(401);
    for (const fields of [{ image: 'base64' }, { video: 'base64' }, { role: 'SUPER_ADMIN' }]) expect((await ingestSession(f, { ...input, ...fields })).status).toBe(400);
    expect((await ingestSession(f, { ...input, source: 'MOBILE' })).status).toBe(501);
    await f.db.station.update({ where: { id: f.stationB.id }, data: { isActive: false } });
    expect((await ingestSession(f, { ...input, stationId: f.stationB.id })).status).toBe(400);
    await f.db.station.update({ where: { id: f.stationB.id }, data: { isActive: true } });
    expect((await ingestSession(f, { ...input, displayName: 'x'.repeat(17 * 1024) })).status).toBe(413);
  });

  it('enforces freshness, chronological event order and error-code allowlists', async () => {
    const input = sessionPayload(f, { startedAt: new Date(Date.now() - 2000).toISOString() });
    for (const offset of [-360000, 360000]) expect((await ingestSession(f, { ...input, startedAt: new Date(Date.now() + offset).toISOString() })).status).toBe(400);
    expect((await ingestSession(f, input)).status).toBe(201);
    expect((await ingestEvent(f, input.externalSessionId, 'ANALYSIS_FAILED', { errorCode: 'PRIVATE_BACKEND_STACK' })).status).toBe(400);
    expect((await ingestEvent(f, input.externalSessionId, 'ANALYSIS_FAILED', { occurredAt: new Date(Date.now() - 10000).toISOString() })).status).toBe(409);
    const accepted = new Date(Date.now() - 500).toISOString();
    expect((await ingestEvent(f, input.externalSessionId, 'ANALYSIS_FAILED', { occurredAt: accepted })).status).toBe(201);
    expect((await ingestEvent(f, input.externalSessionId, 'ANALYSIS_RECOVERED', { occurredAt: new Date(Date.now() - 1500).toISOString() })).status).toBe(409);
    expect((await ingestEvent(f, input.externalSessionId, 'ANALYSIS_FAILED', { occurredAt: new Date(Date.now() - 360000).toISOString() })).status).toBe(400);
    expect((await ingestEvent(f, randomUUID())).status).toBe(404);
  });

  it('does not let a simulator key write a stored mobile session and fails closed in production', async () => {
    const input = sessionPayload(f);
    const created = await ingestSession(f, input);
    expect(created.status).toBe(201);
    await f.db.cameraSession.update({ where: { id: created.body.data.id }, data: { source: 'MOBILE' } });
    expect((await ingestEvent(f, input.externalSessionId)).status).toBe(403);
    expect((await ingestSession(f, input)).status).toBe(403);
    const { SIMULATOR_INGEST_KEY: _key, ...config } = f.config;
    const production = createApp({ ...config, NODE_ENV: 'production', CORS_ORIGIN: 'https://admin.example.test' }, undefined, undefined, f.db);
    expect((await request(production).post('/api/v1/ingest/sessions').send(input)).status).toBe(501);
  });

  it('limits the authenticated source plus IP to 60 requests/minute', async () => {
    const app = createApp(f.config, undefined, undefined, f.db);
    for (let i = 0; i < 60; i++) expect((await request(app).post('/api/v1/ingest/sessions').set('X-Ingest-Key', f.config.SIMULATOR_INGEST_KEY!).send({})).status).toBe(400);
    expect((await request(app).post('/api/v1/ingest/sessions').set('X-Ingest-Key', f.config.SIMULATOR_INGEST_KEY!).send({})).status).toBe(429);
  });
});
