// Each method removes at most `limit` rows and returns how many it touched; callers loop until a short batch.
// Order matters: camera events reference sessions (RESTRICT) and sessions reference tracked users.
export interface RetentionStore {
  tryLock(key: number): Promise<boolean>;
  deleteExpiredAlerts(now: Date, limit: number): Promise<number>;
  deleteExpiredAuditLogs(now: Date, limit: number): Promise<number>;
  deleteExpiredAdminSessions(now: Date, limit: number): Promise<number>;
  purgeAlertPii(now: Date, cutoff: Date, limit: number): Promise<number>;
  deleteExpiredCameraEvents(now: Date, limit: number): Promise<number>;
  deleteExpiredCameraSessions(now: Date, limit: number): Promise<number>;
  deleteExpiredTrackedUsers(now: Date, limit: number): Promise<number>;
}
