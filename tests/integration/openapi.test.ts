import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app';
import { adminFixture } from '../helpers/admin-api';

let f: Awaited<ReturnType<typeof adminFixture>>;
beforeAll(async () => { f = await adminFixture(); });
afterAll(async () => { if (f) await f.cleanup(); });

// Every route mounted in src/app.ts. Update both places together; this test fails when they diverge.
const mountedRoutes = [
  'get /health', 'get /health/live', 'get /health/ready', 'get /api/v1/openapi.json',
  'post /api/v1/auth/login', 'get /api/v1/auth/me', 'post /api/v1/auth/logout', 'post /api/v1/auth/change-password',
  'get /api/v1/stations', 'post /api/v1/stations', 'patch /api/v1/stations/{id}',
  'get /api/v1/staff', 'post /api/v1/staff', 'patch /api/v1/staff/{id}', 'post /api/v1/staff/{id}/reset-password',
  'post /api/v1/ingest/sessions', 'post /api/v1/ingest/events',
  'get /api/v1/alerts', 'get /api/v1/alerts/stream', 'get /api/v1/alerts/{id}', 'patch /api/v1/alerts/{id}/acknowledge', 'patch /api/v1/alerts/{id}/resolve',
  'get /api/v1/dashboard/summary', 'get /api/v1/analytics/usage', 'get /api/v1/audit-logs',
].sort();

const methods = ['get', 'post', 'patch', 'put', 'delete'];

describe('OpenAPI document', () => {
  it('is served as JSON outside production', async () => {
    const result = await request(f.app).get('/api/v1/openapi.json');
    expect(result.status).toBe(200);
    expect(result.headers['content-type']).toMatch(/application\/json/);
    expect(result.body.openapi).toBe('3.1.0');
  });

  it('is not served in production', async () => {
    const production = createApp({ ...f.config, NODE_ENV: 'production' }, undefined, async () => 1, f.db);
    const result = await request(production).get('/api/v1/openapi.json');
    // Unauthenticated /api/v1/* requests hit the auth-protected analytics router first (401); either way no document is served.
    expect([401, 404]).toContain(result.status);
    expect(result.body.openapi).toBeUndefined();
    expect(result.body.paths).toBeUndefined();
  });

  it('documents exactly the mounted routes', async () => {
    const { body } = await request(f.app).get('/api/v1/openapi.json');
    const documented = Object.entries(body.paths as Record<string, Record<string, unknown>>)
      .flatMap(([path, item]) => Object.keys(item).filter(method => methods.includes(method)).map(method => `${method} ${path}`))
      .sort();
    expect(documented).toEqual(mountedRoutes);
  });

  it('describes every operation with responses, and every $ref resolves', async () => {
    const { body } = await request(f.app).get('/api/v1/openapi.json');
    const refs = [...JSON.stringify(body).matchAll(/"\$ref":"#\/([^"]+)"/g)].map(match => match[1]!.split('/'));
    expect(refs.length).toBeGreaterThan(0);
    for (const ref of refs) {
      const target = ref.reduce<unknown>((node, key) => (node as Record<string, unknown> | undefined)?.[key], body);
      expect(target, `unresolved $ref #/${ref.join('/')}`).toBeDefined();
    }
    for (const [path, item] of Object.entries(body.paths as Record<string, Record<string, { responses?: object; tags?: string[] }>>)) {
      for (const method of Object.keys(item).filter(key => methods.includes(key))) {
        const operation = item[method]!;
        expect(Object.keys(operation.responses ?? {}).length, `${method} ${path} responses`).toBeGreaterThan(0);
        expect(operation.tags?.length, `${method} ${path} tags`).toBeGreaterThan(0);
      }
    }
  });

  it('declares the session cookie, CSRF header and ingest key, and requires CSRF on every mutation', async () => {
    const { body } = await request(f.app).get('/api/v1/openapi.json');
    expect(body.components.securitySchemes.sessionCookie).toMatchObject({ in: 'cookie', name: 'admin_session' });
    expect(body.components.securitySchemes.csrfToken).toMatchObject({ in: 'header', name: 'X-CSRF-Token' });
    expect(body.components.securitySchemes.ingestKey).toMatchObject({ in: 'header', name: 'X-Ingest-Key' });
    for (const [path, item] of Object.entries(body.paths as Record<string, Record<string, { security?: Array<Record<string, unknown>> }>>)) {
      for (const method of ['post', 'patch']) {
        const operation = item[method];
        if (!operation || path === '/api/v1/auth/login' || path.startsWith('/api/v1/ingest/')) continue;
        expect(operation.security?.[0], `${method} ${path} security`).toHaveProperty('csrfToken');
      }
    }
  });

  it('derives request bodies from the validation schemas and leaks no secrets', async () => {
    const { body } = await request(f.app).get('/api/v1/openapi.json');
    const login = body.paths['/api/v1/auth/login'].post.requestBody.content['application/json'].schema;
    expect(login.additionalProperties).toBe(false);
    expect(login.required).toEqual(['username', 'password']);
    const event = body.paths['/api/v1/ingest/events'].post.requestBody.content['application/json'].schema;
    expect(event.properties.type.enum).toEqual(['SESSION_STARTED', 'CAMERA_INIT_FAILED', 'ANALYSIS_FAILED', 'ANALYSIS_RECOVERED', 'SESSION_ENDED']);
    const text = JSON.stringify(body);
    expect(text).not.toContain(f.config.SIMULATOR_INGEST_KEY!);
    expect(text).not.toContain(f.config.SESSION_PEPPER);
  });
});
