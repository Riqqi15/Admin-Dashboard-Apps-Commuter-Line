import type { PrismaClient } from '../../generated/prisma/client';

const sum = (items: { sessionCount: number; uniqueUserCount: number; failedSessionCount: number; alertCount: number; resolvedAlertCount: number }[], key: 'sessionCount' | 'uniqueUserCount' | 'failedSessionCount' | 'alertCount' | 'resolvedAlertCount') => items.reduce((total, item) => total + item[key], 0);

export function analyticsService(db: PrismaClient) {
  return {
    async summary(stationId?: string) {
      const today = new Date();
      const statDate = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
      const where = { statDate, ...(stationId ? { stationId } : {}) };
      const stationFilter = stationId ? { stationId } : {};
      const [rows, activeSessions, openAlerts] = await Promise.all([
        db.dailyUsageStat.findMany({ where, include: { station: { select: { code: true, name: true } } }, orderBy: { stationId: 'asc' } }),
        db.cameraSession.count({ where: { ...stationFilter, status: 'ACTIVE', expiresAt: { gt: today } } }),
        db.alert.count({ where: { ...stationFilter, status: { in: ['NEW', 'ACKNOWLEDGED'] }, expiresAt: { gt: today } } }),
      ]);
      const fields = ['sessionCount', 'uniqueUserCount', 'failedSessionCount', 'alertCount', 'resolvedAlertCount'] as const;
      const totals = Object.fromEntries(fields.map(key => [key, sum(rows, key)]));
      return {
        date: statDate.toISOString().slice(0, 10),
        totals: { ...totals, activeSessions, openAlerts },
        byStation: rows.map(row => ({ stationId: row.stationId, code: row.station.code, name: row.station.name, sessionCount: row.sessionCount, uniqueUserCount: row.uniqueUserCount, failedSessionCount: row.failedSessionCount, alertCount: row.alertCount, resolvedAlertCount: row.resolvedAlertCount, averageResponseSeconds: row.averageResponseSeconds })),
      };
    },

    async usage(from: Date, toExclusive: Date, stationId?: string) {
      const rows = await db.dailyUsageStat.findMany({
        where: { statDate: { gte: from, lt: toExclusive }, ...(stationId ? { stationId } : {}) },
        include: { station: { select: { code: true, name: true } } },
        orderBy: [{ statDate: 'asc' }, { stationId: 'asc' }],
        take: 5000,
      });
      const items = rows.map(row => ({
        date: row.statDate.toISOString().slice(0, 10), stationId: row.stationId,
        stationCode: row.station.code, stationName: row.station.name,
        sessionCount: row.sessionCount, uniqueUserCount: row.uniqueUserCount,
        failedSessionCount: row.failedSessionCount, alertCount: row.alertCount,
        resolvedAlertCount: row.resolvedAlertCount, averageResponseSeconds: row.averageResponseSeconds,
      }));
      return { items, truncated: rows.length === 5000 };
    },
  };
}
