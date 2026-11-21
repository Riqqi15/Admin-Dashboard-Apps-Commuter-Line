import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminFixture } from '../helpers/admin-api';
import { alertFixture, ingestEvent, ingestSession, sessionPayload } from '../helpers/camera-api';

let f: Awaited<ReturnType<typeof adminFixture>>;
beforeAll(async () => { f = await adminFixture(); });
afterAll(async () => { if (f) await f.cleanup(); });

function todayUTC() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

async function statForStation(stationId: string) {
  return f.db.dailyUsageStat.findUnique({ where: { stationId_statDate: { stationId, statDate: todayUTC() } } });
}

describe('Daily usage statistics', () => {
  it('increments sessionCount and uniqueUserCount on session creation', async () => {
    const before = await statForStation(f.stationA.id);
    const beforeSessions = before?.sessionCount ?? 0;
    const beforeUsers = before?.uniqueUserCount ?? 0;
    const payload = sessionPayload(f);
    const result = await ingestSession(f, payload);
    expect(result.status).toBe(201);
    const after = await statForStation(f.stationA.id);
    expect(after!.sessionCount).toBe(beforeSessions + 1);
    expect(after!.uniqueUserCount).toBe(beforeUsers + 1);
  });

  it('does not double-count uniqueUser for same user same day', async () => {
    const userId = f.prefix + '.sameuser.' + randomUUID().slice(0, 6);
    const first = sessionPayload(f, { externalUserId: userId });
    expect((await ingestSession(f, first)).status).toBe(201);
    const after1 = await statForStation(f.stationA.id);
    const second = sessionPayload(f, { externalUserId: userId });
    expect((await ingestSession(f, second)).status).toBe(201);
    const after2 = await statForStation(f.stationA.id);
    expect(after2!.sessionCount).toBe(after1!.sessionCount + 1);
    expect(after2!.uniqueUserCount).toBe(after1!.uniqueUserCount);
  });

  it('increments failedSessionCount on first FAILED transition only', async () => {
    const payload = sessionPayload(f);
    await ingestSession(f, payload);
    const before = await statForStation(f.stationA.id);
    await ingestEvent(f, payload.externalSessionId, 'CAMERA_INIT_FAILED', { errorCode: 'CAMERA_UNAVAILABLE' });
    const after = await statForStation(f.stationA.id);
    expect(after!.failedSessionCount).toBe(before!.failedSessionCount + 1);
    // Further failures on the same session should not increment again
    await ingestEvent(f, payload.externalSessionId, 'ANALYSIS_FAILED');
    const after2 = await statForStation(f.stationA.id);
    expect(after2!.failedSessionCount).toBe(after!.failedSessionCount);
  });

  it('increments alertCount when an alert is created', async () => {
    const before = await statForStation(f.stationA.id);
    const beforeAlerts = before?.alertCount ?? 0;
    await alertFixture(f);
    const after = await statForStation(f.stationA.id);
    expect(after!.alertCount).toBe(beforeAlerts + 1);
  });

  it('increments resolvedAlertCount when an alert is resolved', async () => {
    const fixture = await alertFixture(f);
    const before = await statForStation(f.stationA.id);
    const admin = await f.login();
    await request(f.app).patch(`/api/v1/alerts/${fixture.alertId}/acknowledge`).set('Cookie', admin.cookie).set('X-CSRF-Token', admin.csrf).send({});
    await request(f.app).patch(`/api/v1/alerts/${fixture.alertId}/resolve`).set('Cookie', admin.cookie).set('X-CSRF-Token', admin.csrf).send({ notes: 'Test resolution' });
    const after = await statForStation(f.stationA.id);
    expect(after!.resolvedAlertCount).toBe(before!.resolvedAlertCount + 1);
  });

  it('computes averageResponseSeconds on acknowledge', async () => {
    const fixture = await alertFixture(f);
    const admin = await f.login();
    await request(f.app).patch(`/api/v1/alerts/${fixture.alertId}/acknowledge`).set('Cookie', admin.cookie).set('X-CSRF-Token', admin.csrf).send({});
    const stat = await statForStation(f.stationA.id);
    expect(stat!.averageResponseSeconds).not.toBeNull();
    expect(typeof stat!.averageResponseSeconds).toBe('number');
  });

  it('duplicate ingest events do not alter counters', async () => {
    const payload = sessionPayload(f);
    await ingestSession(f, payload);
    const eventId = randomUUID();
    const eventPayload = { eventId, externalSessionId: payload.externalSessionId, type: 'ANALYSIS_FAILED', errorCode: 'VISION_TIMEOUT', occurredAt: new Date().toISOString() };
    const first = await request(f.app).post('/api/v1/ingest/events').set('X-Ingest-Key', f.config.SIMULATOR_INGEST_KEY!).send(eventPayload);
    expect(first.status).toBe(201);
    const after1 = await statForStation(f.stationA.id);
    const second = await request(f.app).post('/api/v1/ingest/events').set('X-Ingest-Key', f.config.SIMULATOR_INGEST_KEY!).send(eventPayload);
    expect(second.status).toBe(200);
    const after2 = await statForStation(f.stationA.id);
    expect(after2!.sessionCount).toBe(after1!.sessionCount);
    expect(after2!.failedSessionCount).toBe(after1!.failedSessionCount);
    expect(after2!.alertCount).toBe(after1!.alertCount);
  });

  it('tracks statistics independently per station', async () => {
    const beforeA = await statForStation(f.stationA.id);
    const beforeB = await statForStation(f.stationB.id);
    await alertFixture(f, { stationId: f.stationB.id });
    const afterA = await statForStation(f.stationA.id);
    const afterB = await statForStation(f.stationB.id);
    expect(afterA?.alertCount ?? 0).toBe(beforeA?.alertCount ?? 0);
    expect(afterB!.alertCount).toBe((beforeB?.alertCount ?? 0) + 1);
  });
});
