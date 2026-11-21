import type { Tx } from '../../../shared/infrastructure/prisma-unit-of-work';
import type { AnalyticsReader } from '../application/analytics-reader';

const withStation = { station: { select: { code: true, name: true } } } as const;

export const prismaAnalyticsReader = (db: Tx): AnalyticsReader => ({
  statsForDay: (statDate, stationId) => db.dailyUsageStat.findMany({
    where: { statDate, ...(stationId ? { stationId } : {}) }, include: withStation, orderBy: { stationId: 'asc' },
  }),

  statsInRange: (from, toExclusive, stationId, limit) => db.dailyUsageStat.findMany({
    where: { statDate: { gte: from, lt: toExclusive }, ...(stationId ? { stationId } : {}) },
    include: withStation, orderBy: [{ statDate: 'asc' }, { stationId: 'asc' }], take: limit,
  }),

  countActiveSessions: (now, stationId) => db.cameraSession.count({ where: { ...(stationId ? { stationId } : {}), status: 'ACTIVE', expiresAt: { gt: now } } }),
  countOpenAlerts: (now, stationId) => db.alert.count({ where: { ...(stationId ? { stationId } : {}), status: { in: ['NEW', 'ACKNOWLEDGED'] }, expiresAt: { gt: now } } }),
});
