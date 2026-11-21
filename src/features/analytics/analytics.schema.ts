import { z } from 'zod';

const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
});

export const usageQuery = z.strictObject({ from: dateOnly.optional(), to: dateOnly.optional(), stationId: z.uuid().optional() })
  .refine(query => !query.from || !query.to || query.from <= query.to, { path: ['to'] });
export const summaryQuery = z.strictObject({ stationId: z.uuid().optional() });

export function usageRange(query: z.infer<typeof usageQuery>, now = new Date()) {
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const to = query.to ? new Date(`${query.to}T00:00:00.000Z`) : today;
  const from = query.from ? new Date(`${query.from}T00:00:00.000Z`) : new Date(to.getTime() - 6 * 86400000);
  const days = (to.getTime() - from.getTime()) / 86400000 + 1;
  if (days < 1 || days > 31) return null;
  return { from, to: new Date(to.getTime() + 86400000) };
}
