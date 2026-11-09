import { describe, expect, it } from 'vitest';
import { parseEnv } from '../../src/config/env';

const valid = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://demo:dummy@127.0.0.1:5434/timetable_admin',
  SESSION_PEPPER: 'x'.repeat(64),
  PII_ENCRYPTION_KEY: 'a'.repeat(64),
  CORS_ORIGIN: 'http://localhost:5173',
};

describe('parseEnv', () => {
  it('rejects missing database URL without printing other values', () => {
    const { DATABASE_URL: _, ...withoutDatabase } = valid;
    expect(() => parseEnv(withoutDatabase)).toThrow(/DATABASE_URL/);
    try { parseEnv(withoutDatabase); } catch (error) {
      expect(String(error)).not.toContain(valid.SESSION_PEPPER);
    }
  });

  it('defaults to loopback and rejects empty or invalid ports', () => {
    expect(parseEnv(valid)).toMatchObject({ HOST: '127.0.0.1', PORT: 3000, TRUST_PROXY_HOPS: 0 });
    for (const PORT of ['', '0', '65536', '1.5', 'abc']) {
      expect(() => parseEnv({ ...valid, PORT })).toThrow(/PORT/);
    }
  });

  it('requires explicit mode, origin, PostgreSQL URL and valid secret formats', () => {
    for (const change of [
      { NODE_ENV: undefined }, { CORS_ORIGIN: undefined },
      { CORS_ORIGIN: '*' }, { CORS_ORIGIN: 'http://localhost:5173/path' },
      { DATABASE_URL: 'file:db.sqlite' }, { SESSION_PEPPER: 'short' },
      { PII_ENCRYPTION_KEY: 'z'.repeat(64) },
    ]) expect(() => parseEnv({ ...valid, ...change })).toThrow();
  });

  it('requires HTTPS remote origin and explicit proxy topology in production', () => {
    const production = { ...valid, NODE_ENV: 'production' };
    expect(() => parseEnv(production)).toThrow();
    for (const CORS_ORIGIN of ['http://admin.example.com', 'https://localhost', 'https://127.0.0.1', 'https://[::1]']) {
      expect(() => parseEnv({ ...production, CORS_ORIGIN, TRUST_PROXY_HOPS: '0' })).toThrow(/CORS_ORIGIN/);
    }
    expect(parseEnv({ ...production, CORS_ORIGIN: 'https://admin.example.com', TRUST_PROXY_HOPS: '1' }).TRUST_PROXY_HOPS).toBe(1);
  });

  it('refuses simulator credentials in production', () => {
    expect(() => parseEnv({ ...valid, NODE_ENV: 'production', CORS_ORIGIN: 'https://admin.example.com', TRUST_PROXY_HOPS: '0', SIMULATOR_INGEST_KEY: 'x'.repeat(64) })).toThrow(/SIMULATOR_INGEST_KEY/);
  });

  it('reports malformed URLs as field names without reflecting their values', () => {
    for (const field of ['DATABASE_URL', 'CORS_ORIGIN']) {
      expect(() => parseEnv({ ...valid, [field]: 'not-a-url-SECRET_VALUE' })).toThrow(field);
      try { parseEnv({ ...valid, [field]: 'not-a-url-SECRET_VALUE' }); } catch (error) {
        expect(String(error)).not.toContain('SECRET_VALUE');
      }
    }
  });
});
