import { DAY_MS } from '../../../shared/domain/time';

export const MAX_USAGE_DAYS = 31;

// Defaults to the last seven days ending today (UTC). Returns null when the range exceeds the 31-day cap.
export function usageRange(query: { from?: string | undefined; to?: string | undefined }, now = new Date()) {
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const to = query.to ? new Date(`${query.to}T00:00:00.000Z`) : today;
  const from = query.from ? new Date(`${query.from}T00:00:00.000Z`) : new Date(to.getTime() - 6 * DAY_MS);
  const days = (to.getTime() - from.getTime()) / DAY_MS + 1;
  if (days < 1 || days > MAX_USAGE_DAYS) return null;
  return { from, to: new Date(to.getTime() + DAY_MS) };
}
