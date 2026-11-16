import { createHash, timingSafeEqual } from 'node:crypto';
import type { RequestHandler } from 'express';
import { ipKeyGenerator, rateLimit } from 'express-rate-limit';
import type { Env } from '../../config/env';
import { AppError } from '../../http/errors';

export function ingestAuth(config: Env): RequestHandler[] {
  const authenticate: RequestHandler = (request, _response, next) => {
    if (config.NODE_ENV === 'production') throw new AppError(501, 'INGEST_NOT_CONFIGURED', 'Production ingest authentication is not configured');
    if (!config.SIMULATOR_INGEST_KEY) throw new AppError(503, 'INGEST_DISABLED', 'Simulator ingest is disabled');
    const key = request.get('X-Ingest-Key');
    const digest = (value: string) => createHash('sha256').update(value).digest();
    if (!key || key.length > 256 || !timingSafeEqual(digest(key), digest(config.SIMULATOR_INGEST_KEY))) throw new AppError(401, 'INVALID_INGEST_KEY', 'Valid simulator credentials required');
    next();
  };
  const limiter = rateLimit({ windowMs: 60000, limit: 60, standardHeaders: 'draft-8', legacyHeaders: false,
    keyGenerator: request => 'SIMULATOR:' + ipKeyGenerator(request.ip || request.socket.remoteAddress || '127.0.0.1'),
    validate: { xForwardedForHeader: false }, message: { success: false, error: { code: 'RATE_LIMITED', message: 'Too many ingest requests; try again later' } },
  });
  return [authenticate, limiter];
}
