import express from 'express';
import type { Env } from './config/env';
import type { Logger } from 'pino';
import { createLogger, requestContext } from './http/request-context';
import { security } from './http/security';
import { AppError } from './http/errors';
import { errorHandler } from './http/error-handler';

export function createApp(config: Env, logger: Logger = createLogger(config)) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.TRUST_PROXY_HOPS === 0 ? false : config.TRUST_PROXY_HOPS);
  app.use(requestContext(logger));
  app.use(security(config));
  app.get(['/health', '/health/live'], (_request, response) => {
    response.json({ success: true, data: { status: 'ok' } });
  });
  app.use((_request, _response, next) => next(new AppError(404, 'NOT_FOUND', 'Resource not found')));
  app.use(errorHandler);
  return app;
}
