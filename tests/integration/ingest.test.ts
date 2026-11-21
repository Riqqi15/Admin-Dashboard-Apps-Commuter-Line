import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminFixture } from '../helpers/admin-api';
import { ingestEvent, ingestSession, sessionPayload } from '../helpers/camera-api';
import { expectError } from '../helpers/expect-error';

let f: Awaited<ReturnType<typeof adminFixture>>;
beforeAll(async () => { f = await adminFixture(); });
afterAll(async () => { if (f) await f.cleanup(); });

describe('Camera session/event ingest', () => {
  it('stores encrypted PII and an idempotent session without exposing PII in the response', async () => {
    const payload = sessionPayload(f);
    const created = await ingestSession(f, payload);
    expect(created.status).toBe(201);
    expect(created.text).not.toContain(payload.displayName);
    const stored = await f.db.cameraSession.findUniqueOrThrow({ where: { externalSessionId: payload.externalSessionId }, include: { trackedUser: true } });
    expect(stored.trackedUser.displayNameCiphertext).toMatch(/^v1\./);
    expect(stored.trackedUser.displayNameCiphertext).not.toContain(payload.displayName);
    expect(stored.trackedUser.phoneCiphertext).not.toContain(payload.phone);
    expect(stored.expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(7 * 86400000);
    const duplicate = await ingestSession(f, payload);
    expect(duplicate.status).toBe(200);
    expect(duplicate.body.data.id).toBe(created.body.data.id);
    expectError(await ingestSession(f, { ...payload, displayName: 'Changed Passenger' }), 409, 'IDEMPOTENCY_CONFLICT');
    expectError(await ingestSession(f, { ...payload, stationConfirmed: false }), 400, 'VALIDATION_ERROR');
    expectError(await ingestSession(f, { ...payload, externalSessionId: randomUUID(), stationId: randomUUID() }), 404, 'NOT_FOUND');
  });

  it('rejects events for an expired session (410) and for a session whose station was deactivated (400)', async () => {
    const expired = sessionPayload(f);
    expect((await ingestSession(f, expired)).status).toBe(201);
    await f.db.cameraSession.update({ where: { externalSessionId: expired.externalSessionId }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expectError(await ingestEvent(f, expired.externalSessionId), 410, 'SESSION_EXPIRED');

    const inactive = sessionPayload(f, { stationId: f.stationB.id });
    expect((await ingestSession(f, inactive)).status).toBe(201);
    await f.db.station.update({ where: { id: f.stationB.id }, data: { isActive: false } });
    try {
      expectError(await ingestEvent(f, inactive.externalSessionId), 400, 'STATION_INACTIVE');
    } finally {
      await f.db.station.update({ where: { id: f.stationB.id }, data: { isActive: true } });
    }
  });

  it('reconciles parallel identical and conflicting session IDs across stations', async () => {
    const payload = sessionPayload(f);
    const same = await Promise.all([ingestSession(f, payload), ingestSession(f, payload)]);
    expect(same.map(r => r.status).sort()).toEqual([200, 201]);
    expect(same[0]!.body.data.id).toBe(same[1]!.body.data.id);
    const externalSessionId = randomUUID();
    const conflict = await Promise.all([ingestSession(f, { ...payload, externalSessionId }), ingestSession(f, { ...payload, externalSessionId, stationId: f.stationB.id })]);
    expect(conflict.map(r => r.status).sort()).toEqual([201, 409]);
  });

  it('counts only new failures, resets on recovery and makes one alert per session', async () => {
    const payload = sessionPayload(f);
    expect((await ingestSession(f, payload)).status).toBe(201);
    for (let i = 0; i < 2; i++) {
      const event = await ingestEvent(f, payload.externalSessionId);
      expect(event.status).toBe(201);
      expect(event.body.data.alertId).toBeNull();
    }
    expect((await ingestEvent(f, payload.externalSessionId, 'ANALYSIS_RECOVERED')).body.data.consecutiveFailures).toBe(0);
    const first = await ingestEvent(f, payload.externalSessionId);
    expect(first.body.data.consecutiveFailures).toBe(1);
    const id = randomUUID();
    const occurredAt = new Date().toISOString();
    expect((await ingestEvent(f, payload.externalSessionId, 'ANALYSIS_FAILED', { eventId: id, occurredAt })).body.data.consecutiveFailures).toBe(2);
    const replay = await ingestEvent(f, payload.externalSessionId, 'ANALYSIS_FAILED', { eventId: id, occurredAt });
    expect(replay.status).toBe(200);
    expect(replay.body.data.consecutiveFailures).toBe(2);
    const third = await ingestEvent(f, payload.externalSessionId);
    expect(third.body.data.alertId).toBeTypeOf('string');
    const fourth = await ingestEvent(f, payload.externalSessionId);
    expect(fourth.body.data.alertId).toBe(third.body.data.alertId);
    const ended = await ingestEvent(f, payload.externalSessionId, 'SESSION_ENDED');
    expect(ended.status).toBe(201);
    expect((await f.db.alert.findUniqueOrThrow({ where: { id: third.body.data.alertId } })).status).toBe('NEW');
    expectError(await ingestEvent(f, payload.externalSessionId), 409, 'SESSION_CLOSED');
  });

  it('canonicalizes UUID casing and protects a global event ID across different sessions', async () => {
    const input = sessionPayload(f);
    const same = await Promise.all([ingestSession(f, input), ingestSession(f, { ...input, externalSessionId: input.externalSessionId.toUpperCase(), stationId: input.stationId.toUpperCase() })]);
    expect(same.map(result => result.status).sort()).toEqual([200, 201]);
    const eventId = randomUUID();
    const occurredAt = new Date().toISOString();
    const duplicate = await Promise.all([ingestEvent(f, input.externalSessionId, 'ANALYSIS_FAILED', { eventId, occurredAt }), ingestEvent(f, input.externalSessionId.toUpperCase(), 'ANALYSIS_FAILED', { eventId: eventId.toUpperCase(), occurredAt })]);
    expect(duplicate.map(result => result.status).sort()).toEqual([200, 201]);
    const other = sessionPayload(f, { stationId: f.stationB.id });
    expect((await ingestSession(f, other)).status).toBe(201);
    const collision = randomUUID();
    const conflict = await Promise.all([ingestEvent(f, input.externalSessionId, 'ANALYSIS_FAILED', { eventId: collision, occurredAt }), ingestEvent(f, other.externalSessionId, 'ANALYSIS_FAILED', { eventId: collision, occurredAt })]);
    expect(conflict.map(result => result.status).sort()).toEqual([201, 409]);
    expect(await f.db.cameraEvent.count({ where: { eventId: collision } })).toBe(1);
    const counters = await f.db.cameraSession.findMany({ where: { externalSessionId: { in: [input.externalSessionId, other.externalSessionId] } }, select: { consecutiveFailures: true } });
    expect(counters.reduce((sum, row) => sum + row.consecutiveFailures, 0)).toBe(2);
  });

  it('serializes parallel failures and identical events without duplicate counters or alerts', async () => {
    const payload = sessionPayload(f);
    const created = await ingestSession(f, payload);
    expect(created.status).toBe(201);
    const occurredAt = new Date().toISOString();
    const failures = await Promise.all(Array.from({ length: 4 }, () => ingestEvent(f, payload.externalSessionId, 'ANALYSIS_FAILED', { occurredAt })));
    expect(failures.every(result => result.status === 201)).toBe(true);
    expect(await f.db.alert.count({ where: { cameraSessionId: created.body.data.id } })).toBe(1);
    const eventId = randomUUID();
    const repeated = await Promise.all([ingestEvent(f, payload.externalSessionId, 'ANALYSIS_FAILED', { eventId, occurredAt }), ingestEvent(f, payload.externalSessionId, 'ANALYSIS_FAILED', { eventId, occurredAt })]);
    expect(repeated.map(result => result.status).sort()).toEqual([200, 201]);
    expect((await f.db.cameraSession.findUniqueOrThrow({ where: { id: created.body.data.id } })).consecutiveFailures).toBe(5);
    expectError(await ingestEvent(f, payload.externalSessionId, 'ANALYSIS_RECOVERED', { eventId, occurredAt }), 409, 'IDEMPOTENCY_CONFLICT');
  });
});
