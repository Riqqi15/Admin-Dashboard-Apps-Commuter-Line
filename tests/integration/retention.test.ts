import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runRetention } from '../../src/workers/retention-job';
import { adminFixture } from '../helpers/admin-api';
import { alertFixture } from '../helpers/camera-api';

let f: Awaited<ReturnType<typeof adminFixture>>;
beforeAll(async () => { f = await adminFixture(); });
afterAll(async () => { if (f) await f.cleanup(); });

const daysAgo = (days: number) => new Date(Date.now() - days * 86400000);
const daysAhead = (days: number) => new Date(Date.now() + days * 86400000);

describe('Retention worker (runRetention against the isolated test database)', () => {
  it('deletes expired alerts and audit logs while keeping unexpired ones', async () => {
    const expired = await alertFixture(f);
    const fresh = await alertFixture(f);
    await f.db.alert.update({ where: { id: expired.alertId }, data: { expiresAt: daysAgo(1) } });
    const expiredAudit = await f.db.auditLog.create({ data: { action: 'TEST_RETENTION', entityType: 'test', entityId: randomUUID(), stationId: f.stationA.id, expiresAt: daysAgo(1) } });
    const freshAudit = await f.db.auditLog.create({ data: { action: 'TEST_RETENTION', entityType: 'test', entityId: randomUUID(), stationId: f.stationA.id, expiresAt: daysAhead(30) } });

    const result = await runRetention(f.db);

    expect(result.deleted['expired alerts']).toBeGreaterThanOrEqual(1);
    expect(await f.db.alert.findUnique({ where: { id: expired.alertId } })).toBeNull();
    expect(await f.db.alert.findUnique({ where: { id: fresh.alertId } })).not.toBeNull();
    expect(await f.db.auditLog.findUnique({ where: { id: expiredAudit.id } })).toBeNull();
    expect(await f.db.auditLog.findUnique({ where: { id: freshAudit.id } })).not.toBeNull();
  });

  it('deletes expired and revoked admin sessions but keeps active ones', async () => {
    const expiredLogin = await f.login(f.securityB.username);
    const revokedLogin = await f.login(f.securityB.username);
    const activeLogin = await f.login(f.securityB.username);
    const sessions = await f.db.adminSession.findMany({ where: { adminUserId: f.securityB.id }, orderBy: { createdAt: 'asc' } });
    expect(sessions.length).toBeGreaterThanOrEqual(3);
    const [expired, revoked, active] = sessions.slice(-3);
    await f.db.adminSession.update({ where: { id: expired!.id }, data: { expiresAt: daysAgo(1) } });
    await f.db.adminSession.update({ where: { id: revoked!.id }, data: { revokedAt: new Date() } });

    await runRetention(f.db);

    expect(await f.db.adminSession.findUnique({ where: { id: expired!.id } })).toBeNull();
    expect(await f.db.adminSession.findUnique({ where: { id: revoked!.id } })).toBeNull();
    expect(await f.db.adminSession.findUnique({ where: { id: active!.id } })).not.toBeNull();
    expect((await request(f.app).get('/api/v1/auth/me').set('Cookie', activeLogin.cookie)).status).toBe(200);
    expect((await request(f.app).get('/api/v1/auth/me').set('Cookie', expiredLogin.cookie)).status).toBe(401);
    expect((await request(f.app).get('/api/v1/auth/me').set('Cookie', revokedLogin.cookie)).status).toBe(401);
  });

  it('purges alert PII after 7 days without deleting the alert, and is idempotent', async () => {
    const old = await alertFixture(f);
    const recent = await alertFixture(f);
    await f.db.alert.update({ where: { id: old.alertId }, data: { createdAt: daysAgo(8) } });

    await runRetention(f.db);
    const purged = await f.db.alert.findUniqueOrThrow({ where: { id: old.alertId } });
    expect(purged.userNameCiphertext).toBeNull();
    expect(purged.userPhoneCiphertext).toBeNull();
    expect(purged.piiPurgedAt).not.toBeNull();
    expect(purged.status).toBe('NEW');
    const kept = await f.db.alert.findUniqueOrThrow({ where: { id: recent.alertId } });
    expect(kept.userNameCiphertext).not.toBeNull();
    expect(kept.piiPurgedAt).toBeNull();

    await runRetention(f.db);
    const again = await f.db.alert.findUniqueOrThrow({ where: { id: old.alertId } });
    expect(again.piiPurgedAt!.getTime()).toBe(purged.piiPurgedAt!.getTime());
  });

  it('removes expired camera events, sessions and tracked users in FK order and detaches the alert', async () => {
    const externalUserId = f.prefix + '.ret.' + randomUUID().slice(0, 6);
    const fixture = await alertFixture(f, { externalUserId });
    const session = await f.db.cameraSession.findUniqueOrThrow({ where: { id: fixture.sessionId } });
    expect(await f.db.cameraEvent.count({ where: { cameraSessionId: session.id } })).toBeGreaterThan(0);
    await f.db.cameraEvent.updateMany({ where: { cameraSessionId: session.id }, data: { expiresAt: daysAgo(1) } });
    await f.db.cameraSession.update({ where: { id: session.id }, data: { expiresAt: daysAgo(1) } });
    await f.db.trackedUser.update({ where: { id: session.trackedUserId }, data: { expiresAt: daysAgo(1) } });

    await expect(runRetention(f.db)).resolves.toBeDefined();

    expect(await f.db.cameraEvent.count({ where: { cameraSessionId: session.id } })).toBe(0);
    expect(await f.db.cameraSession.findUnique({ where: { id: session.id } })).toBeNull();
    expect(await f.db.trackedUser.findUnique({ where: { id: session.trackedUserId } })).toBeNull();
    const alert = await f.db.alert.findUniqueOrThrow({ where: { id: fixture.alertId } });
    expect(alert.cameraSessionId).toBeNull();
  });

  it('never deletes stations, admin accounts or daily usage statistics', async () => {
    await alertFixture(f);
    const stationIds = [f.stationA.id, f.stationB.id];
    const userIds = [f.admin.id, f.securityA.id, f.securityB.id];
    const statsBefore = await f.db.dailyUsageStat.findMany({ where: { stationId: { in: stationIds } }, orderBy: { id: 'asc' } });
    expect(statsBefore.length).toBeGreaterThan(0);

    await runRetention(f.db);

    expect(await f.db.station.count({ where: { id: { in: stationIds } } })).toBe(2);
    expect(await f.db.adminUser.count({ where: { id: { in: userIds } } })).toBe(3);
    const statsAfter = await f.db.dailyUsageStat.findMany({ where: { stationId: { in: stationIds } }, orderBy: { id: 'asc' } });
    expect(statsAfter).toEqual(statsBefore);
  });
});
