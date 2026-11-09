import { Writable } from 'node:stream';
import express from 'express';
import pino from 'pino';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../src/app';
import { parseEnv } from '../../src/config/env';
import { errorHandler } from '../../src/http/error-handler';

const config = parseEnv({
  NODE_ENV: 'test', DATABASE_URL: 'postgresql://dummy:dummy@localhost:5434/demo',
  SESSION_PEPPER: 'x'.repeat(64), PII_ENCRYPTION_KEY: 'a'.repeat(64),
  CORS_ORIGIN: 'http://localhost:5173', LOG_LEVEL: 'silent',
});
const app = () => createApp(config);

describe('HTTP security baseline', () => {
  it('serves liveness independently of database, with security headers and server-generated IDs', async () => {
    for (const path of ['/health', '/health/live']) {
      const result = await request(app()).get(path).set('X-Request-Id', 'untrusted');
      expect(result.status).toBe(200);
      expect(result.body).toEqual({ success: true, data: { status: 'ok' } });
      expect(result.headers['x-powered-by']).toBeUndefined();
      expect(result.headers['x-content-type-options']).toBe('nosniff');
      expect(result.headers['content-security-policy']).toContain("default-src 'none'");
      expect(result.headers['x-request-id']).toMatch(/^[a-f0-9-]{36}$/);
      expect(result.headers['cache-control']).toBe('no-store');
    }
  });

  it('allows only the exact configured origin and supports credentialed preflight', async () => {
    const client = request(app());
    const allowed = await client.get('/health').set('Origin', config.CORS_ORIGIN);
    expect(allowed.headers['access-control-allow-origin']).toBe(config.CORS_ORIGIN);
    expect(allowed.headers['access-control-allow-credentials']).toBe('true');
    const preflight = await client.options('/api/v1/auth/login')
      .set('Origin', config.CORS_ORIGIN).set('Access-Control-Request-Method', 'POST');
    expect(preflight.status).toBe(204);
    for (const origin of ['https://evil.example', 'http://localhost:5173.evil.example', 'null']) {
      const result = await client.post('/api/v1/unknown').set('Origin', origin).send({});
      expect(result.status).toBe(403);
      expect(result.body.error.code).toBe('ORIGIN_NOT_ALLOWED');
      expect(result.headers['access-control-allow-origin']).toBeUndefined();
    }
  });

  it('enforces 32 KiB generic and 16 KiB ingest limits without parser bypass', async () => {
    const client = request(app());
    const body = { text: 'x'.repeat(20 * 1024) };
    expect((await client.post('/api/v1/unknown').send(body)).status).toBe(404);
    const ingest = await client.post('/api/v1/ingest/events').send(body);
    expect(ingest.status).toBe(413);
    expect(ingest.body.error.code).toBe('PAYLOAD_TOO_LARGE');
    expect((await client.post('/api/v1/unknown').send({ text: 'x'.repeat(33 * 1024) })).status).toBe(413);
  });

  it('returns stable JSON for malformed JSON and missing routes, without input reflection', async () => {
    const malformed = await request(app()).post('/api/v1/unknown')
      .set('Content-Type', 'application/json').send('{"password":"SECRET_BAD_JSON"');
    expect(malformed.status).toBe(400);
    expect(malformed.body.error.code).toBe('INVALID_JSON');
    expect(malformed.text).not.toContain('SECRET_BAD_JSON');
    const missing = await request(app()).get('/does-not-exist');
    expect(missing.status).toBe(404);
    expect(missing.body).toEqual({ success: false, error: { code: 'NOT_FOUND', message: 'Resource not found' } });
  });

  it('redacts unexpected errors even when runtime mode is development', async () => {
    const errorApp = express();
    errorApp.get('/boom', () => { throw new Error('db-password-must-stay-private'); });
    errorApp.use(errorHandler);
    const result = await request(errorApp).get('/boom');
    expect(result.status).toBe(500);
    expect(result.body).toEqual({ success: false, error: { code: 'INTERNAL_ERROR', message: 'An internal error occurred' } });
    expect(result.text).not.toMatch(/stack|db-password|Error:/);
  });

  it('does not log headers, body, URL queries, passwords, tokens or phone data', async () => {
    let output = '';
    const sink = new Writable({ write(chunk, _encoding, done) { output += chunk.toString(); done(); } });
    const logger = pino({ level: 'info' }, sink);
    const logged = createApp({ ...config, LOG_LEVEL: 'info' }, logger);
    await request(logged).post('/api/v1/unknown?token=SECRET_QUERY')
      .set('Authorization', 'Bearer SECRET_AUTH').set('Cookie', 'admin_session=SECRET_COOKIE')
      .send({ password: 'SECRET_PASSWORD', phone: 'SECRET_PHONE', token: 'SECRET_TOKEN' });
    expect(output).toContain('request completed');
    expect(output).not.toContain('SECRET_');
  });
});
