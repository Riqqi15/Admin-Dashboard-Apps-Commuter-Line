import type { Tx } from '../../../shared/infrastructure/prisma-unit-of-work';
import type { RetentionStore } from '../application/ports';

export const prismaRetentionStore = (tx: Tx): RetentionStore => ({
  async tryLock(key) {
    const [row] = await tx.$queryRaw<Array<{ locked: boolean }>>`SELECT pg_try_advisory_xact_lock(${key}::bigint) AS locked`;
    return Boolean(row?.locked);
  },

  deleteExpiredAlerts: (now, limit) => tx.$executeRaw`
    DELETE FROM alerts WHERE id IN (
      SELECT id FROM alerts WHERE expires_at <= ${now} ORDER BY expires_at LIMIT ${limit}
    )`,

  deleteExpiredAuditLogs: (now, limit) => tx.$executeRaw`
    DELETE FROM audit_logs WHERE id IN (
      SELECT id FROM audit_logs WHERE expires_at <= ${now} ORDER BY expires_at LIMIT ${limit}
    )`,

  deleteExpiredAdminSessions: (now, limit) => tx.$executeRaw`
    DELETE FROM admin_sessions WHERE id IN (
      SELECT id FROM admin_sessions WHERE expires_at <= ${now} OR revoked_at IS NOT NULL ORDER BY expires_at LIMIT ${limit}
    )`,

  // Purging also detaches the alert from the passenger record; COALESCE keeps the first purge time.
  purgeAlertPii: (now, cutoff, limit) => tx.$executeRaw`
    UPDATE alerts SET user_name_ciphertext = NULL, user_phone_ciphertext = NULL, tracked_user_id = NULL,
      pii_purged_at = COALESCE(pii_purged_at, ${now})
    WHERE id IN (
      SELECT id FROM alerts
      WHERE created_at <= ${cutoff}
        AND (user_name_ciphertext IS NOT NULL OR user_phone_ciphertext IS NOT NULL OR tracked_user_id IS NOT NULL)
      ORDER BY created_at LIMIT ${limit}
    )`,

  deleteExpiredCameraEvents: (now, limit) => tx.$executeRaw`
    DELETE FROM camera_events WHERE id IN (
      SELECT id FROM camera_events WHERE expires_at <= ${now} ORDER BY expires_at LIMIT ${limit}
    )`,

  deleteExpiredCameraSessions: (now, limit) => tx.$executeRaw`
    DELETE FROM camera_sessions WHERE id IN (
      SELECT id FROM camera_sessions WHERE expires_at <= ${now} ORDER BY expires_at LIMIT ${limit}
    )`,

  deleteExpiredTrackedUsers: (now, limit) => tx.$executeRaw`
    DELETE FROM tracked_users WHERE id IN (
      SELECT id FROM tracked_users WHERE expires_at <= ${now} ORDER BY expires_at LIMIT ${limit}
    )`,
});
