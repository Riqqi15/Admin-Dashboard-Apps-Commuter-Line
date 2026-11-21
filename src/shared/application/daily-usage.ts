export type DailyUsageDelta = {
  sessionCount?: number;
  uniqueUserCount?: number;
  failedSessionCount?: number;
  alertCount?: number;
  resolvedAlertCount?: number;
};

export interface DailyUsage {
  increment(stationId: string, at: Date, delta: DailyUsageDelta): Promise<void>;
  setAverageResponseSeconds(stationId: string, day: Date, seconds: number | null): Promise<void>;
}
