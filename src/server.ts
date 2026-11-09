import { createServer } from 'node:http';
import { createApp } from './app';
import { parseEnv } from './config/env';
import { createPrisma } from './lib/prisma';
import { createLogger } from './http/request-context';

try {
  const config = parseEnv(process.env);
  const prisma = createPrisma(config.DATABASE_URL);
  const server = createServer(createApp(config, createLogger(config), () => prisma.$queryRaw`SELECT 1`));
  server.requestTimeout = 30_000;
  server.headersTimeout = 15_000;
  server.keepAliveTimeout = 5_000;
  server.maxHeadersCount = 100;
  server.on('error', () => {
    console.error('API server failed; check bind address and port.');
    process.exitCode = 1;
  });
  server.listen(config.PORT, config.HOST, () => {
    console.info(`API listening on http://${config.HOST}:${config.PORT}`);
  });
  let shuttingDown = false;
  const shutdown = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    const timeout = setTimeout(() => {
      server.closeAllConnections();
      process.exit(1);
    }, 10_000);
    timeout.unref();
    server.close(async error => {
      try { await prisma.$disconnect(); } catch { error ||= new Error('Database shutdown failed'); }
      clearTimeout(timeout);
      process.exitCode = error ? 1 : 0;
    });
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
} catch {
  console.error('API startup failed: check environment configuration (.env).');
  process.exitCode = 1;
}
