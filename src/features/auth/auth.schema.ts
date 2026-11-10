import { z } from 'zod';

export const username = z.string().trim().toLowerCase().regex(/^[a-z0-9._-]{3,50}$/);
export const newPassword = z.string().min(12).max(128);
export const loginSchema = z.strictObject({ username, password: z.string().min(1).max(128) });
export const changePasswordSchema = z.strictObject({ currentPassword: z.string().min(1).max(128), newPassword });
