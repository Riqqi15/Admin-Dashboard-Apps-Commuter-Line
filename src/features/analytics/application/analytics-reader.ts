export type DailyStatRow = Readonly<{
  statDate: Date; stationId: string; station: Readonly<{ code: string; name: string }>;
  sessionCount: number; uniqueUserCount: number; failedSessionCount: number; alertCount: number; resolvedAlertCount: number;
  averageResponseSeconds: number | null;
}>;

export interface AnalyticsReader {
  statsForDay(statDate: Date, stationId?: string | undefined): Promise<DailyStatRow[]>;
  statsInRange(from: Date, toExclusive: Date, stationId: string | undefined, limit: number): Promise<DailyStatRow[]>;
  countActiveSessions(now: Date, stationId?: string | undefined): Promise<number>;
  countOpenAlerts(now: Date, stationId?: string | undefined): Promise<number>;
}
