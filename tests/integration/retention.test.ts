import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminFixture } from '../helpers/admin-api';
import { alertFixture, ingestEvent, ingestSession, sessionPayload } from '../helpers/camera-api';

let f: Awaited<ReturnType<typeof adminFixture>>;
beforeAll(async () => { f = await adminFixture(); });
afterAll(async () => { if (f) await f.cleanup(); });

const pastDate = (days: number) => new Date(Date.now() - days * 86400000);

describe('Retention worker logic', () => {
  it('deletes expired alerts (30-day TTL)', async () => {
    const fixture = await alertFixture(f);
    await f.db.alert.update({ where: { id: fixture.alertId }, data: { expiresAt: pastDate(1) } });
    const before = await f.db.alert.findUnique({ where: { id: fixture.alertId } });
    expect(before).not.toBeNull();
    const now = new Date();
    const deleted = await f.db.$executeRaw`
      DELETE FROM alerts WHERE id IN (
        SELECT id FROM alerts WHERE expires_at <= ${now} AND id = ${fixture.alertId}::uuid LIMIT 500
      )`;
    expect(deleted).toBe(1);
    expect(await f.db.alert.findUnique({ where: { id: fixture.alertId } })).toBeNull();
  });

  it('deletes expired audit logs', async () => {
    const id = randomUUID();
    await f.db.auditLog.create({ data: { id, action: 'TEST_ACTION', entityType: 'test', entityId: randomUUID(), expiresAt: pastDate(1) } });
    const now = new Date();
    const deleted = await f.db.$executeRaw`
      DELETE FROM audit_logs WHERE id IN (
        SELECT id FROM audit_logs WHERE expires_at <= ${now} AND id = ${id}::uuid LIMIT 500
      )`;
    expect(deleted).toBe(1);
  });

  it('deletes expired/revoked admin sessions', async () => {
    const login = await f.login();
    const session = await f.db.adminSession.findFirst({ where: { adminUserId: f.admin.id, revokedAt: null }, orderBy: { createdAt: 'desc' } });
    expect(session).not.toBeNull();
    await f.db.adminSession.update({ where: { id: session!.id }, data: { expiresAt: pastDate(1) } });
    const now = new Date();
    const deleted = await f.db.$executeRaw`
      DELETE FROM admin_sessions WHERE id IN (
        SELECT id FROM admin_sessions WHERE (expires_at <= ${now} OR revoked_at IS NOT NULL) AND id = ${session!.id}::uuid LIMIT 500
      )`;
    expect(deleted).toBe(1);
  });

  it('purges PII from alerts older than 7 days without deleting the alert', async () => {
    const fixture = await alertFixture(f);
    const alert = await f.db.alert.findUnique({ where: { id: fixture.alertId } });
    expect(alert!.userNameCiphertext).not.toBeNull();
    await f.db.alert.update({ where: { id: fixture.alertId }, data: { createdAt: pastDate(8) } });
    const now = new Date();
    const updated = await f.db.$executeRaw`
      UPDATE alerts SET user_name_ciphertext = NULL, user_phone_ciphertext = NULL, pii_purged_at = ${now}
      WHERE id IN (
        SELECT id FROM alerts
        WHERE created_at <= ${new Date(now.getTime() - 7 * 86400000)}
          AND pii_purged_at IS NULL
          AND (user_name_ciphertext IS NOT NULL OR user_phone_ciphertext IS NOT NULL)
          AND id = ${fixture.alertId}::uuid
        LIMIT 500
      )`;
    expect(updated).toBe(1);
    const purged = await f.db.alert.findUnique({ where: { id: fixture.alertId } });
    expect(purged).not.toBeNull();
    expect(purged!.userNameCiphertext).toBeNull();
    expect(purged!.userPhoneCiphertext).toBeNull();
    expect(purged!.piiPurgedAt).not.toBeNull();
    expect(purged!.status).toBe('NEW');
  });

  it('PII purge is idempotent — already purged rows are not updated again', async () => {
    const fixture = await alertFixture(f);
    await f.db.alert.update({ where: { id: fixture.alertId }, data: { createdAt: pastDate(8), userNameCiphertext: null, userPhoneCiphertext: null, piiPurgedAt: pastDate(1) } });
    const now = new Date();
    const updated = await f.db.$executeRaw`
      UPDATE alerts SET user_name_ciphertext = NULL, user_phone_ciphertext = NULL, pii_purged_at = ${now}
      WHERE id IN (
        SELECT id FROM alerts
        WHERE created_at <= ${new Date(now.getTime() - 7 * 86400000)}
          AND pii_purged_at IS NULL
          AND (user_name_ciphertext IS NOT NULL OR user_phone_ciphertext IS NOT NULL)
          AND id = ${fixture.alertId}::uuid
        LIMIT 500
      )`;
    expect(updated).toBe(0);
  });

  it('respects FK order: events deleted before sessions, sessions before tracked users', async () => {
    const payload = sessionPayload(f);
    const session = await ingestSession(f, payload);
    expect(session.status).toBe(201);
    await ingestEvent(f, payload.externalSessionId, 'ANALYSIS_FAILED');
    const sessionId = session.body.data.id;
    const cameraSession = await f.db.cameraSession.findUnique({ where: { id: sessionId } });
    expect(cameraSession).not.toBeNull();
    await f.db.cameraEvent.updateMany({ where: { cameraSessionId: sessionId }, data: { expiresAt: pastDate(1) } });
    await f.db.cameraSession.update({ where: { id: sessionId }, data: { expiresAt: pastDate(1) } });
    const now = new Date();
    // Try deleting session before events — should fail due to FK Restrict
    let sessionDeleteFailed = false;
    try {
      await f.db.$executeRaw`DELETE FROM camera_sessions WHERE id = ${sessionId}::uuid`;
    } catch {
      sessionDeleteFailed = true;
    }
    expect(sessionDeleteFailed).toBe(true);
    // Delete events first, then session — correct order
    await f.db.$executeRaw`DELETE FROM camera_events WHERE camera_session_id = ${sessionId}::uuid`;
    // Now alerts referencing this session should be SET NULL
    const alertsBefore = await f.db.alert.findMany({ where: { cameraSessionId: sessionId } });
    await f.db.$executeRaw`DELETE FROM camera_sessions WHERE id = ${sessionId}::uuid`;
    // Verify alerts still exist but with null cameraSessionId
    for (const alert of alertsBefore) {
      const afterDelete = await f.db.alert.findUnique({ where: { id: alert.id } });
      if (afterDelete) {
        expect(afterDelete.cameraSessionId).toBeNull();
      }
    }
  });

  it('preserves stations, admin accounts, and daily stats', async () => {
    await alertFixture(f);
    const statsBefore = await f.db.dailyUsageStat.findMany({ where: { stationId: f.stationA.id } });
    // Run the retention-style deletes for expired data only
    const now = new Date();
    await f.db.$executeRaw`
      DELETE FROM alerts WHERE id IN (
        SELECT id FROM alerts WHERE expires_at <= ${now} AND station_id = ${f.stationA.id}::uuid LIMIT 500
      )`;
    // Stations should still exist
    expect(await f.db.station.findUnique({ where: { id: f.stationA.id } })).not.toBeNull();
    expect(await f.db.station.findUnique({ where: { id: f.stationB.id } })).not.toBeNull();
    // Admin users should still exist
    expect(await f.db.adminUser.findUnique({ where: { id: f.admin.id } })).not.toBeNull();
    expect(await f.db.adminUser.findUnique({ where: { id: f.securityA.id } })).not.toBeNull();
    // Daily stats should not be touched by retention
    const statsAfter = await f.db.dailyUsageStat.findMany({ where: { stationId: f.stationA.id } });
    expect(statsAfter.length).toBe(statsBefore.length);
  });

  it('deletes expired tracked users after their sessions are removed', async () => {
    const userId = f.prefix + '.ret.' + randomUUID().slice(0, 6);
    const payload = sessionPayload(f, { externalUserId: userId });
    await ingestSession(f, payload);
    const user = await f.db.trackedUser.findUnique({ where: { externalUserId: userId } });
    expect(user).not.toBeNull();
    // Expire everything
    const session = await f.db.cameraSession.findUnique({ where: { externalSessionId: payload.externalSessionId } });
    await f.db.cameraEvent.deleteMany({ where: { cameraSessionId: session!.id } });
    await f.db.alert.deleteMany({ where: { cameraSessionId: session!.id } });
    await f.db.cameraSession.delete({ where: { id: session!.id } });
    await f.db.trackedUser.update({ where: { id: user!.id }, data: { expiresAt: pastDate(1) } });
    const now = new Date();
    const deleted = await f.db.$executeRaw`
      DELETE FROM tracked_users WHERE id IN (
        SELECT id FROM tracked_users WHERE expires_at <= ${now} AND id = ${user!.id}::uuid LIMIT 500
      )`;
    expect(deleted).toBe(1);
    expect(await f.db.trackedUser.findUnique({ where: { id: user!.id } })).toBeNull();
  });
});
