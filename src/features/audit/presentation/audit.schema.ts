import { z } from 'zod';

const pageNumber = (fallback: string, max: number) => z.string().regex(/^\d+$/).default(fallback).transform(Number).pipe(z.number().int().min(1).max(max));
const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
});

export const auditQuery = z.strictObject({
  page: pageNumber('1', 1000000),
  pageSize: pageNumber('25', 100),
  stationId: z.uuid().optional(),
  action: z.string().trim().min(1).max(80).optional(),
  from: dateOnly.optional(),
  to: dateOnly.optional(),
}).refine(query => !query.from || !query.to || query.from <= query.to, { path: ['to'] });
