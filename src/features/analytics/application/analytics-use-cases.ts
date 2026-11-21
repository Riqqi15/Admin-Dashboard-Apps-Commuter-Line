import { AppError } from '../../../shared/domain/errors';
import type { AuthContext } from '../../../shared/domain/roles';
import { stationScope } from '../../../shared/domain/station-scope';
import { DAY_MS, utcDay } from '../../../shared/domain/time';
import { usageRange, MAX_USAGE_DAYS } from '../domain/date-range';
import type { AnalyticsReader, DailyStatRow } from './analytics-reader';

const USAGE_ROW_LIMIT = 5000;
const counters = ['sessionCount', 'uniqueUserCount', 'failedSessionCount', 'alertCount', 'resolvedAlertCount'] as const;
const isoDate = (value: Date) => value.toISOString().slice(0, 10);

const stationRow = (row: DailyStatRow) => ({
  stationId: row.stationId, sessionCount: row.sessionCount, uniqueUserCount: row.uniqueUserCount,
  failedSessionCount: row.failedSessionCount, alertCount: row.alertCount, resolvedAlertCount: row.resolvedAlertCount,
  averageResponseSeconds: row.averageResponseSeconds,
});

export function analyticsUseCases(reader: AnalyticsReader) {
  return {
    async summary(auth: AuthContext, requestedStationId?: string) {
      const stationId = stationScope(auth, requestedStationId);
      const today = new Date();
      const statDate = utcDay(today);
      const [rows, activeSessions, openAlerts] = await Promise.all([
        reader.statsForDay(statDate, stationId), reader.countActiveSessions(today, stationId), reader.countOpenAlerts(today, stationId),
      ]);
      const totals = Object.fromEntries(counters.map(key => [key, rows.reduce((total, row) => total + row[key], 0)]));
      return {
        date: isoDate(statDate),
        totals: { ...totals, activeSessions, openAlerts },
        byStation: rows.map(row => ({ ...stationRow(row), code: row.station.code, name: row.station.name })),
      };
    },

    async usage(auth: AuthContext, query: { from?: string | undefined; to?: string | undefined; stationId?: string | undefined }) {
      // The range is validated before the station scope, so an oversized range is reported first.
      const range = usageRange(query);
      if (!range) throw new AppError(400, 'DATE_RANGE_INVALID', `Date range must be at most ${MAX_USAGE_DAYS} days`);
      const stationId = stationScope(auth, query.stationId);
      const rows = await reader.statsInRange(range.from, range.to, stationId, USAGE_ROW_LIMIT);
      return {
        from: isoDate(range.from),
        to: isoDate(new Date(range.to.getTime() - DAY_MS)),
        items: rows.map(row => ({ date: isoDate(row.statDate), ...stationRow(row), stationCode: row.station.code, stationName: row.station.name })),
        truncated: rows.length === USAGE_ROW_LIMIT,
      };
    },
  };
}

export type AnalyticsUseCases = ReturnType<typeof analyticsUseCases>;
