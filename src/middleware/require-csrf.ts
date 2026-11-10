import { timingSafeEqual } from 'node:crypto';
import type { RequestHandler } from 'express';
import type { Env } from '../config/env';
import { tokenHash } from '../features/auth/auth.service';
import { AppError } from '../http/errors';
import { getAuth } from './require-session';

export function requireCsrf(config: Env): RequestHandler {
  return (request, _response, next) => {
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method)) { next(); return; }
    const token = request.get('X-CSRF-Token');
    const origin = request.get('Origin');
    if ((origin && origin !== config.CORS_ORIGIN) || request.get('Sec-Fetch-Site') === 'cross-site' || !token || !/^[a-f0-9]{64}$/.test(token)
      || !timingSafeEqual(Buffer.from(tokenHash(config, 'csrf', token), 'hex'), Buffer.from(getAuth(request).csrfTokenHash, 'hex'))) {
      throw new AppError(403, 'CSRF_INVALID', 'Valid CSRF token required');
    }
    next();
  };
}
