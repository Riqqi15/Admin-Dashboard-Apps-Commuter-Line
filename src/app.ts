import express from 'express';
import cookieParser from 'cookie-parser';
import type { Logger } from 'pino';
import type { Env } from './config/env';
import type { PrismaClient } from './generated/prisma/client';
import { alertUseCases } from './features/alerts/application/alert-use-cases';
import { createAlertStream } from './features/alerts/infrastructure/in-memory-alert-stream';
import { prismaActorRepository, prismaAlertRepository } from './features/alerts/infrastructure/prisma-alert-repository';
import { alertRouter } from './features/alerts/presentation/alert.router';
import { analyticsUseCases } from './features/analytics/application/analytics-use-cases';
import { prismaAnalyticsReader } from './features/analytics/infrastructure/prisma-analytics-reader';
import { analyticsRouter } from './features/analytics/presentation/analytics.router';
import { auditUseCases } from './features/audit/application/audit-use-cases';
import { prismaAuditReader } from './features/audit/infrastructure/prisma-audit-reader';
import { auditRouter } from './features/audit/presentation/audit.router';
import { authUseCases } from './features/auth/application/auth-use-cases';
import { prismaAuthRepository } from './features/auth/infrastructure/prisma-auth-repository';
import { authRouter } from './features/auth/presentation/auth.router';
import { requireSession } from './features/auth/presentation/require-session';
import { openApiDocument } from './features/docs/presentation/openapi';
import { ingestUseCases } from './features/ingest/application/ingest-use-cases';
import { hmacPayloadFingerprint } from './features/ingest/infrastructure/hmac-payload-fingerprint';
import { prismaIngestRepository } from './features/ingest/infrastructure/prisma-ingest-repository';
import { ingestRouter } from './features/ingest/presentation/ingest.router';
import { staffUseCases } from './features/staff/application/staff-use-cases';
import { prismaStaffRepository } from './features/staff/infrastructure/prisma-staff-repository';
import { staffRouter } from './features/staff/presentation/staff.router';
import { stationUseCases } from './features/stations/application/station-use-cases';
import { prismaStationRepository } from './features/stations/infrastructure/prisma-station-repository';
import { stationRouter } from './features/stations/presentation/station.router';
import { AppError } from './shared/domain/errors';
import { aesPiiCipher } from './shared/infrastructure/aes-pii-cipher';
import { argon2PasswordHasher } from './shared/infrastructure/argon2-password-hasher';
import { hmacTokenService } from './shared/infrastructure/hmac-token-service';
import { prismaAuditTrail } from './shared/infrastructure/prisma-audit-trail';
import { prismaDailyUsage } from './shared/infrastructure/prisma-daily-usage';
import { translatePrismaError } from './shared/infrastructure/prisma-errors';
import { prismaUnitOfWork, type Tx } from './shared/infrastructure/prisma-unit-of-work';
import { uuidIdGenerator } from './shared/infrastructure/uuid-id-generator';
import { createErrorHandler } from './shared/presentation/error-handler';
import type { Guards } from './shared/presentation/guards';
import { createLogger, requestContext } from './shared/presentation/request-context';
import { requireCsrf } from './shared/presentation/require-csrf';
import { security } from './shared/presentation/security';

// Composition root: the only place that knows which adapter implements which port.
function mountApi(app: express.Express, database: PrismaClient, config: Env) {
  const tokens = hmacTokenService(config.SESSION_PEPPER);
  const cipher = aesPiiCipher(config.PII_ENCRYPTION_KEY);
  const alertStream = createAlertStream();
  const unitOfWork = <Repositories>(bind: (tx: Tx) => Repositories) => prismaUnitOfWork(database, bind);

  const auth = authUseCases(
    prismaAuthRepository(database),
    unitOfWork(tx => ({ auth: prismaAuthRepository(tx), audit: prismaAuditTrail(tx) })),
    argon2PasswordHasher, tokens,
  );
  const guards: Guards = { session: requireSession(auth), csrf: requireCsrf(config, tokens) };
  const stations = stationUseCases(unitOfWork(tx => ({ stations: prismaStationRepository(tx), audit: prismaAuditTrail(tx) })));
  const staff = staffUseCases(unitOfWork(tx => ({ staff: prismaStaffRepository(tx), audit: prismaAuditTrail(tx) })), argon2PasswordHasher);
  const alerts = alertUseCases(
    unitOfWork(tx => ({ alerts: prismaAlertRepository(tx), actors: prismaActorRepository(tx), audit: prismaAuditTrail(tx), usage: prismaDailyUsage(tx) })),
    cipher, alertStream,
  );
  const ingest = ingestUseCases(
    unitOfWork(tx => ({ ingest: prismaIngestRepository(tx), audit: prismaAuditTrail(tx), usage: prismaDailyUsage(tx) })),
    cipher, hmacPayloadFingerprint(config.SESSION_PEPPER), uuidIdGenerator, alertStream,
  );
  const analytics = analyticsUseCases(prismaAnalyticsReader(database));
  const audit = auditUseCases(prismaAuditReader(database));

  app.use('/api/v1/auth', authRouter(auth, guards, tokens, config));
  app.use('/api/v1/stations', stationRouter(stations, guards));
  app.use('/api/v1/staff', staffRouter(staff, guards));
  app.use('/api/v1/ingest', ingestRouter(ingest, config));
  app.use('/api/v1/alerts', alertRouter(alerts, alertStream, guards, actor => auth.stillCurrent(actor)));
  app.use('/api/v1', analyticsRouter(analytics, guards));
  app.use('/api/v1/audit-logs', auditRouter(audit, guards));
}

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
  if (config.NODE_ENV !== 'production') {
    app.get('/api/v1/openapi.json', (_request, response) => { response.json(openApiDocument()); });
  }
  if (database) mountApi(app, database, config);
  app.use((_request, _response, next) => next(new AppError(404, 'NOT_FOUND', 'Resource not found')));
  app.use(createErrorHandler(translatePrismaError));
  return app;
}
