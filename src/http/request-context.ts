import { randomUUID } from 'node:crypto';
import pino from 'pino';
import type { Logger } from 'pino';
import pinoHttp from 'pino-http';
import type { Env } from '../config/env';

export const createLogger = (config: Env) => pino({
  level: config.LOG_LEVEL,
  base: { service: 'timetable-admin-api' },
  redact: { paths: ['password', 'phone', 'token', 'csrfToken', 'req.headers', 'req.body', 'res.headers'], remove: true },
});

export function requestContext(logger: Logger) {
  return pinoHttp({
    logger,
    genReqId: (_request, response) => {
      const id = randomUUID();
      response.setHeader('X-Request-Id', id);
      return id;
    },
    // Allowlist metadata only: URLs, headers, request bodies and error text may carry secrets.
    serializers: {
      req: request => ({ id: request.id, method: request.method }),
      res: response => ({ statusCode: response.statusCode }),
      err: () => ({ type: 'InternalError' }),
    },
  });
}
