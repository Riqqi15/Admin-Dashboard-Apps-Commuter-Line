import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { adminFixture } from './admin-api';

type Fixture = Awaited<ReturnType<typeof adminFixture>>;
export function sessionPayload(f: Fixture, overrides: Record<string, unknown> = {}) {
  return { externalSessionId: randomUUID(), externalUserId: f.prefix + '.mobile', displayName: 'Fixture Passenger', phone: '081234567890', stationId: f.stationA.id, stationConfirmed: true, startedAt: new Date(Date.now() - 1000).toISOString(), source: 'SIMULATOR', ...overrides };
}
export const ingestSession = (f: Fixture, body: object) => request(f.app).post('/api/v1/ingest/sessions').set('X-Ingest-Key', f.config.SIMULATOR_INGEST_KEY!).send(body);
export const ingestEvent = (f: Fixture, externalSessionId: string, type = 'ANALYSIS_FAILED', overrides: Record<string, unknown> = {}) => request(f.app).post('/api/v1/ingest/events').set('X-Ingest-Key', f.config.SIMULATOR_INGEST_KEY!).send({ eventId: randomUUID(), externalSessionId, type, ...(type.endsWith('FAILED') ? { errorCode: 'VISION_TIMEOUT' } : {}), occurredAt: new Date().toISOString(), ...overrides });
export async function alertFixture(f: Fixture, overrides: Record<string, unknown> = {}) {
  const input = sessionPayload(f, overrides);
  const created = await ingestSession(f, input);
  if (created.status !== 201) throw new Error('Camera fixture creation failed: HTTP ' + created.status);
  const event = await ingestEvent(f, input.externalSessionId, 'CAMERA_INIT_FAILED', { errorCode: 'CAMERA_UNAVAILABLE' });
  if (event.status !== 201) throw new Error('Alert fixture creation failed: HTTP ' + event.status);
  return { input, sessionId: created.body.data.id as string, alertId: event.body.data.alertId as string };
}
