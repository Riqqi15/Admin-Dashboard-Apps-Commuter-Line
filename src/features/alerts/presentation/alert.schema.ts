import { z } from 'zod';
import { listQuery } from '../../../shared/presentation/validation';

export const alertQuery = listQuery.extend({ status: z.enum(['NEW', 'ACKNOWLEDGED', 'RESOLVED']).optional() });
export const acknowledgeSchema = z.strictObject({});
export const resolveSchema = z.strictObject({ notes: z.string().trim().min(1).max(1000) });
