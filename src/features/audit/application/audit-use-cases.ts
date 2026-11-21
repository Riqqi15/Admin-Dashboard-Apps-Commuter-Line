import { DAY_MS } from '../../../shared/domain/time';
import type { AuditReader } from './audit-reader';

type AuditQuery = { page: number; pageSize: number; stationId?: string | undefined; action?: string | undefined; from?: string | undefined; to?: string | undefined };

export function auditUseCases(reader: AuditReader) {
  return {
    // `to` is inclusive in the API, so the exclusive upper bound is the following midnight (UTC).
    async list(query: AuditQuery) {
      const from = query.from ? new Date(`${query.from}T00:00:00.000Z`) : undefined;
      const toExclusive = query.to ? new Date(new Date(`${query.to}T00:00:00.000Z`).getTime() + DAY_MS) : undefined;
      const { items, total } = await reader.list({ stationId: query.stationId, action: query.action, from, toExclusive }, query);
      return { items, total, page: query.page, pageSize: query.pageSize };
    },
  };
}

export type AuditUseCases = ReturnType<typeof auditUseCases>;
