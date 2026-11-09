import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import type { Env } from '../config/env';
import { AppError } from './errors';

export function security(config: Env) {
  const router = express.Router();
  router.use(helmet({
    strictTransportSecurity: false,
    contentSecurityPolicy: { useDefaults: false, directives: {
      defaultSrc: ["'none'"], scriptSrc: ["'none'"], frameAncestors: ["'none'"], baseUri: ["'none'"], formAction: ["'none'"],
    } },
  }));
  router.use((_request, response, next) => { response.set('Cache-Control', 'no-store'); next(); });
  router.use(cors({
    origin: (origin, callback) => {
      // Non-browser tools may omit Origin. Authentication/CSRF still gate mutations in later tasks.
      if (origin === undefined || origin === config.CORS_ORIGIN) callback(null, true);
      else callback(new AppError(403, 'ORIGIN_NOT_ALLOWED', 'Origin is not allowed'));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'X-CSRF-Token', 'X-Ingest-Key'],
    exposedHeaders: ['X-Request-Id'],
  }));
  // Choose exactly one parser. A global 32 KiB parser must not bypass the stricter ingest limit.
  const general = express.json({ limit: '32kb', strict: true, inflate: false });
  const ingest = express.json({ limit: '16kb', strict: true, inflate: false });
  router.use((request, response, next) => {
    const parser = /^\/api\/v1\/ingest(?:\/|$)/i.test(request.path) ? ingest : general;
    parser(request, response, next);
  });
  return router;
}
