import { z } from 'zod';

const fields = { code: z.string().trim().toUpperCase().regex(/^[A-Z0-9._-]{1,20}$/), name: z.string().trim().min(1).max(120), isActive: z.boolean() };
export const createStationSchema = z.strictObject({ ...fields, isActive: fields.isActive.default(true) });
export const updateStationSchema = z.strictObject(fields).partial().refine(value => Object.keys(value).length > 0);
