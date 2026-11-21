import type { DailyUsage } from '../application/daily-usage';
import { utcDay } from '../domain/time';
import type { Tx } from './prisma-unit-of-work';

export const prismaDailyUsage = (tx: Tx): DailyUsage => ({
  async increment(stationId, at, delta) {
    const statDate = utcDay(at);
    await tx.dailyUsageStat.upsert({
      where: { stationId_statDate: { stationId, statDate } },
      create: { stationId, statDate, ...delta },
      update: {
        ...(delta.sessionCount ? { sessionCount: { increment: delta.sessionCount } } : {}),
        ...(delta.uniqueUserCount ? { uniqueUserCount: { increment: delta.uniqueUserCount } } : {}),
        ...(delta.failedSessionCount ? { failedSessionCount: { increment: delta.failedSessionCount } } : {}),
        ...(delta.alertCount ? { alertCount: { increment: delta.alertCount } } : {}),
        ...(delta.resolvedAlertCount ? { resolvedAlertCount: { increment: delta.resolvedAlertCount } } : {}),
      },
    });
  },
  async setAverageResponseSeconds(stationId, day, seconds) {
    await tx.dailyUsageStat.upsert({
      where: { stationId_statDate: { stationId, statDate: day } },
      create: { stationId, statDate: day, averageResponseSeconds: seconds },
      update: { averageResponseSeconds: seconds },
    });
  },
});
