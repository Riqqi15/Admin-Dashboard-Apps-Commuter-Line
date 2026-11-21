import { z } from 'zod';

const positiveInteger = (fallback: string, max: number) => z.string().regex(/^\d+$/).default(fallback).transform(Number).pipe(z.number().int().min(1).max(max));
export const listQuery = z.strictObject({ page: positiveInteger('1', 1000000), pageSize: positiveInteger('20', 100), stationId: z.uuid().optional() });
export const idParams = z.strictObject({ id: z.uuid() });
