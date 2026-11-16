import express from 'express';
import cookieParser from 'cookie-parser';
import type { Env } from './config/env';
import type { Logger } from 'pino';
import { createLogger, requestContext } from './http/request-context';
import { security } from './http/security';
import { AppError } from './http/errors';
import { errorHandler } from './http/error-handler';
import type { PrismaClient } from './generated/prisma/client';
import { authRouter } from './features/auth/auth.router';
import { stationRouter } from './features/stations/station.router';
import { staffRouter } from './features/staff/staff.router';
import { ingestRouter } from './features/ingest/ingest.router';
import { alertRouter } from './features/alerts/alert.router';

export function createApp(config: Env, logger: Logger = createLogger(config), checkDatabase: () => Promise<unknown> = async () => { throw new Error('Readiness check not configured'); }, database?: PrismaClient) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.TRUST_PROXY_HOPS === 0 ? false : config.TRUST_PROXY_HOPS);
  app.use(requestContext(logger));
  app.use(security(config));
  app.use(cookieParser());
  app.get(['/health', '/health/live'], (_request, response) => {
    response.json({ success: true, data: { status: 'ok' } });
  });
  app.get('/health/ready', async (_request, response, next) => {
    try {
      await checkDatabase();
      response.json({ success: true, data: { status: 'ready', database: 'connected' } });
    } catch {
      next(new AppError(503, 'DATABASE_UNAVAILABLE', 'Database is unavailable'));
    }
  });
  if (database) {
    app.use('/api/v1/auth', authRouter(database, config));
    app.use('/api/v1/stations', stationRouter(database, config));
    app.use('/api/v1/staff', staffRouter(database, config));
    app.use('/api/v1/ingest', ingestRouter(database, config));
    app.use('/api/v1/alerts', alertRouter(database, config));
  }
  app.use((_request, _response, next) => next(new AppError(404, 'NOT_FOUND', 'Resource not found')));
  app.use(errorHandler);
  return app;
}
