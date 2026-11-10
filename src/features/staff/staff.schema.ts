import { z } from 'zod';
import { newPassword, username } from '../auth/auth.schema';

export const createStaffSchema = z.strictObject({ username, password: newPassword, stationId: z.uuid() });
export const updateStaffSchema = z.strictObject({ username: username.optional(), stationId: z.uuid().optional(), isActive: z.boolean().optional() }).refine(value => Object.keys(value).length > 0);
export const resetPasswordSchema = z.strictObject({ newPassword });
