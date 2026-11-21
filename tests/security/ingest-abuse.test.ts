import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app';
import { adminFixture } from '../helpers/admin-api';
import { ingestEvent, ingestSession, sessionPayload } from '../helpers/camera-api';
import { expectError } from '../helpers/expect-error';

let f: Awaited<ReturnType<typeof adminFixture>>;
beforeAll(async () => { f = await adminFixture(); });
afterAll(async () => { if (f) await f.cleanup(); });

describe('Ingest trust boundary', () => {
  it('requires a key, rejects media/unknown fields, mobile source and inactive stations', async () => {
    const input = sessionPayload(f);
    expectError(await request(f.app).post('/api/v1/ingest/sessions').send(input), 401, 'INVALID_INGEST_KEY');
    expectError(await request(f.app).post('/api/v1/ingest/sessions').set('X-Ingest-Key', 'wrong-key').send(input), 401, 'INVALID_INGEST_KEY');
    for (const fields of [{ image: 'base64' }, { video: 'base64' }, { role: 'SUPER_ADMIN' }]) expectError(await ingestSession(f, { ...input, ...fields }), 400, 'VALIDATION_ERROR');
    expectError(await ingestSession(f, { ...input, source: 'MOBILE' }), 501, 'MOBILE_INGEST_UNSUPPORTED');
    await f.db.station.update({ where: { id: f.stationB.id }, data: { isActive: false } });
    expectError(await ingestSession(f, { ...input, stationId: f.stationB.id }), 400, 'STATION_INACTIVE');
    await f.db.station.update({ where: { id: f.stationB.id }, data: { isActive: true } });
    expectError(await ingestSession(f, { ...input, displayName: 'x'.repeat(17 * 1024) }), 413, 'PAYLOAD_TOO_LARGE');
  });

  it('enforces freshness, chronological event order and error-code allowlists', async () => {
    const input = sessionPayload(f, { startedAt: new Date(Date.now() - 2000).toISOString() });
    for (const offset of [-360000, 360000]) expectError(await ingestSession(f, { ...input, startedAt: new Date(Date.now() + offset).toISOString() }), 400, 'TIMESTAMP_OUT_OF_RANGE');
    expect((await ingestSession(f, input)).status).toBe(201);
    expectError(await ingestEvent(f, input.externalSessionId, 'ANALYSIS_FAILED', { errorCode: 'PRIVATE_BACKEND_STACK' }), 400, 'VALIDATION_ERROR');
    expectError(await ingestEvent(f, input.externalSessionId, 'ANALYSIS_FAILED', { occurredAt: new Date(Date.now() - 10000).toISOString() }), 409, 'EVENT_OUT_OF_ORDER');
    const accepted = new Date(Date.now() - 500).toISOString();
    expect((await ingestEvent(f, input.externalSessionId, 'ANALYSIS_FAILED', { occurredAt: accepted })).status).toBe(201);
    expectError(await ingestEvent(f, input.externalSessionId, 'ANALYSIS_RECOVERED', { occurredAt: new Date(Date.now() - 1500).toISOString() }), 409, 'EVENT_OUT_OF_ORDER');
    expectError(await ingestEvent(f, input.externalSessionId, 'ANALYSIS_FAILED', { occurredAt: new Date(Date.now() - 360000).toISOString() }), 400, 'TIMESTAMP_OUT_OF_RANGE');
    expectError(await ingestEvent(f, randomUUID()), 404, 'NOT_FOUND');
  });

  it('does not let a simulator key write a stored mobile session and fails closed in production', async () => {
    const input = sessionPayload(f);
    const created = await ingestSession(f, input);
    expect(created.status).toBe(201);
    await f.db.cameraSession.update({ where: { id: created.body.data.id }, data: { source: 'MOBILE' } });
    expectError(await ingestEvent(f, input.externalSessionId), 403, 'INGEST_SOURCE_MISMATCH');
    expectError(await ingestSession(f, input), 403, 'INGEST_SOURCE_MISMATCH');
    const { SIMULATOR_INGEST_KEY: _key, ...config } = f.config;
    const production = createApp({ ...config, NODE_ENV: 'production', CORS_ORIGIN: 'https://admin.example.test' }, undefined, undefined, f.db);
    expectError(await request(production).post('/api/v1/ingest/sessions').send(input), 501, 'INGEST_NOT_CONFIGURED');
    // Outside production, a missing simulator key disables ingest instead of leaving it open.
    const disabled = createApp({ ...config, NODE_ENV: 'test' }, undefined, undefined, f.db);
    expectError(await request(disabled).post('/api/v1/ingest/sessions').send(input), 503, 'INGEST_DISABLED');
  });

  it('limits the authenticated source plus IP to 60 requests/minute', async () => {
    const app = createApp(f.config, undefined, undefined, f.db);
    for (let i = 0; i < 60; i++) expect((await request(app).post('/api/v1/ingest/sessions').set('X-Ingest-Key', f.config.SIMULATOR_INGEST_KEY!).send({})).status).toBe(400);
    expectError(await request(app).post('/api/v1/ingest/sessions').set('X-Ingest-Key', f.config.SIMULATOR_INGEST_KEY!).send({}), 429, 'RATE_LIMITED');
  });
});
