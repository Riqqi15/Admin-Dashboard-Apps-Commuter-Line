import type { RequestHandler } from 'express';
import { AppError } from '../domain/errors';
import { getAuth } from './get-auth';

export const requireSuperAdmin: RequestHandler = (request, _response, next) => {
  if (getAuth(request).role !== 'SUPER_ADMIN') throw new AppError(403, 'FORBIDDEN', 'Super Admin access required');
  next();
};

export const requirePasswordChanged: RequestHandler = (request, _response, next) => {
  if (getAuth(request).mustChangePassword) throw new AppError(403, 'PASSWORD_CHANGE_REQUIRED', 'Change your temporary password first');
  next();
};
