import { z } from 'zod';

const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
});

export const usageQuery = z.strictObject({ from: dateOnly.optional(), to: dateOnly.optional(), stationId: z.uuid().optional() })
  .refine(query => !query.from || !query.to || query.from <= query.to, { path: ['to'] });
export const summaryQuery = z.strictObject({ stationId: z.uuid().optional() });
