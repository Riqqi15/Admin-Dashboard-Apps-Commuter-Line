import { z } from 'zod';
import { listQuery } from '../../http/validation';
import { changePasswordSchema, loginSchema } from '../auth/auth.schema';
import { createStaffSchema, resetPasswordSchema, updateStaffSchema } from '../staff/staff.schema';
import { createStationSchema, updateStationSchema } from '../stations/station.schema';
import { eventSchema, sessionSchema } from '../ingest/ingest.schema';
import { acknowledgeSchema, alertQuery, resolveSchema } from '../alerts/alert.schema';
import { summaryQuery, usageQuery } from '../analytics/analytics.schema';
import { auditQuery } from '../audit/audit.schema';

type JsonSchema = { properties?: Record<string, object>; required?: string[] } & Record<string, unknown>;
type Operation = Record<string, unknown>;

// Request contracts come from the same Zod schemas the routers parse, so docs cannot drift from validation.
const jsonSchema = (schema: z.ZodType) => {
  const { $schema: _dialect, ...rest } = z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' }) as JsonSchema;
  return rest as JsonSchema;
};
const body = (schema: z.ZodType, example?: object) => ({
  required: true,
  content: { 'application/json': { schema: jsonSchema(schema), ...(example ? { example } : {}) } },
});
const query = (schema: z.ZodType) => {
  const { properties = {}, required = [] } = jsonSchema(schema);
  return Object.entries(properties).map(([name, schema]) => ({ name, in: 'query', required: required.includes(name), schema }));
};
const idPath = [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }];
const ok = (description: string, status = '200') => ({
  [status]: { description, content: { 'application/json': { schema: { $ref: '#/components/schemas/Success' } } } },
});
const errors = (...codes: Array<'400' | '401' | '403' | '404' | '409' | '410' | '413' | '415' | '422' | '429' | '501' | '503'>) =>
  Object.fromEntries(codes.map(code => [code, { $ref: `#/components/responses/E${code}` }]));

const session = [{ sessionCookie: [] }];
const sessionWithCsrf = [{ sessionCookie: [], csrfToken: [] }];
const ingest = [{ ingestKey: [] }];
const read = (tag: string, summary: string, extra: Operation = {}): Operation => ({
  tags: [tag], summary, security: session, responses: { ...ok(summary), ...errors('400', '401', '403') }, ...extra,
});
const mutate = (tag: string, summary: string, extra: Operation = {}): Operation => ({
  tags: [tag], summary, security: sessionWithCsrf, ...extra,
});

const errorEnvelope = {
  type: 'object', required: ['success', 'error'],
  properties: {
    success: { const: false },
    error: { type: 'object', required: ['code', 'message'], properties: { code: { type: 'string' }, message: { type: 'string' } } },
  },
};
const errorResponse = (description: string, code: string) => ({
  description, content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' }, example: { success: false, error: { code, message: description } } } },
});

function build() {
  return {
    openapi: '3.1.0',
    info: {
      title: 'Timetable Admin Backend API',
      version: '1.0.0',
      description: 'Backend-only API for monitoring Camera Assist usage and handling camera failure alerts per station. Available only outside production.',
    },
    servers: [{ url: '/' }],
    tags: ['Health', 'Auth', 'Stations', 'Staff', 'Ingest', 'Alerts', 'Analytics', 'Audit', 'Docs'].map(name => ({ name })),
    paths: {
      '/health': { get: { tags: ['Health'], summary: 'Liveness (no database query)', security: [], responses: ok('Process is alive') } },
      '/health/live': { get: { tags: ['Health'], summary: 'Liveness (no database query)', security: [], responses: ok('Process is alive') } },
      '/health/ready': { get: { tags: ['Health'], summary: 'Readiness with a real PostgreSQL query', security: [], responses: { ...ok('Database connected'), ...errors('503') } } },
      '/api/v1/openapi.json': { get: { tags: ['Docs'], summary: 'This OpenAPI document (404 in production)', security: [], responses: { 200: { description: 'OpenAPI 3.1 document' } } } },

      '/api/v1/auth/login': { post: {
        tags: ['Auth'], summary: 'Login with username and password; sets the admin_session cookie and returns a CSRF token', security: [],
        requestBody: body(loginSchema, { username: 'superadmin', password: '<password>' }),
        responses: { ...ok('Logged in; data.user and data.csrfToken'), ...errors('400', '401', '415', '429') },
      } },
      '/api/v1/auth/me': { get: read('Auth', 'Current account profile') },
      '/api/v1/auth/logout': { post: mutate('Auth', 'Revoke the current session', { responses: { ...ok('Logged out'), ...errors('401', '403') } }) },
      '/api/v1/auth/change-password': { post: mutate('Auth', 'Change password, rotate cookie and CSRF token, revoke other sessions', {
        requestBody: body(changePasswordSchema), responses: { ...ok('Password changed'), ...errors('400', '401', '403', '429') },
      }) },

      '/api/v1/stations': {
        get: read('Stations', 'List stations (Station Security sees only its own station)', { parameters: query(listQuery) }),
        post: mutate('Stations', 'Create a station (Super Admin)', { requestBody: body(createStationSchema, { code: 'MRI', name: 'Manggarai' }), responses: { ...ok('Station created', '201'), ...errors('400', '401', '403', '409') } }),
      },
      '/api/v1/stations/{id}': { patch: mutate('Stations', 'Update a station (Super Admin)', {
        parameters: idPath, requestBody: body(updateStationSchema), responses: { ...ok('Station updated'), ...errors('400', '401', '403', '404', '409') },
      }) },

      '/api/v1/staff': {
        get: read('Staff', 'List station security accounts (Super Admin)', { parameters: query(listQuery) }),
        post: mutate('Staff', 'Create a station security account (Super Admin)', { requestBody: body(createStaffSchema), responses: { ...ok('Staff created', '201'), ...errors('400', '401', '403', '404', '409') } }),
      },
      '/api/v1/staff/{id}': { patch: mutate('Staff', 'Update a station security account (Super Admin)', {
        parameters: idPath, requestBody: body(updateStaffSchema), responses: { ...ok('Staff updated'), ...errors('400', '401', '403', '404', '409') },
      }) },
      '/api/v1/staff/{id}/reset-password': { post: mutate('Staff', 'Reset a staff password; forces change on next login (Super Admin)', {
        parameters: idPath, requestBody: body(resetPasswordSchema), responses: { ...ok('Password reset'), ...errors('400', '401', '403', '404') },
      }) },

      '/api/v1/ingest/sessions': { post: {
        tags: ['Ingest'], summary: 'Create a confirmed camera session (simulator only; idempotent by externalSessionId)', security: ingest,
        requestBody: body(sessionSchema, { externalSessionId: '6f1c2b0e-8f7a-4c1e-9a52-2d6f3c1b9e01', externalUserId: 'mobile-user-id', displayName: 'Nama pengguna', phone: '081234567890', stationId: '2b7e1c3a-5d4f-4e6a-8b9c-0d1e2f3a4b5c', stationConfirmed: true, startedAt: '2026-10-28T08:00:00Z', source: 'SIMULATOR' }),
        responses: { ...ok('Session created', '201'), ...ok('Identical replay'), ...errors('400', '401', '403', '404', '409', '413', '429', '501', '503') },
      } },
      '/api/v1/ingest/events': { post: {
        tags: ['Ingest'], summary: 'Record a camera event; CAMERA_INIT_FAILED or a third consecutive ANALYSIS_FAILED creates one alert', security: ingest,
        requestBody: body(eventSchema, { eventId: '9d2e4f60-1a2b-4c3d-8e9f-0a1b2c3d4e5f', externalSessionId: '6f1c2b0e-8f7a-4c1e-9a52-2d6f3c1b9e01', type: 'ANALYSIS_FAILED', errorCode: 'VISION_TIMEOUT', occurredAt: '2026-10-28T08:01:00Z' }),
        responses: { ...ok('Event recorded', '201'), ...ok('Identical replay'), ...errors('400', '401', '404', '409', '410', '413', '429', '501', '503') },
      } },

      '/api/v1/alerts': { get: read('Alerts', 'List alerts in scope (no PII)', { parameters: query(alertQuery) }) },
      '/api/v1/alerts/stream': { get: {
        tags: ['Alerts'], summary: 'Server-Sent Events: alert.created / alert.updated for stations in scope', security: session,
        description: 'Heartbeat every 15 s, session revalidated every 30 s, stream closed after 5 minutes. Max 3 streams per account. No replay: reload GET /alerts after reconnecting.',
        responses: { 200: { description: 'Event stream', content: { 'text/event-stream': { schema: { type: 'string' } } } }, ...errors('401', '403', '429') },
      } },
      '/api/v1/alerts/{id}': { get: read('Alerts', 'Alert detail (passenger snapshot hidden after 7 days)', { parameters: idPath, responses: { ...ok('Alert detail'), ...errors('400', '401', '403', '404') } }) },
      '/api/v1/alerts/{id}/acknowledge': { patch: mutate('Alerts', 'Claim a NEW alert', {
        parameters: idPath, requestBody: { required: false, content: { 'application/json': { schema: jsonSchema(acknowledgeSchema) } } },
        responses: { ...ok('Alert acknowledged'), ...errors('400', '401', '403', '404', '409') },
      }) },
      '/api/v1/alerts/{id}/resolve': { patch: mutate('Alerts', 'Resolve a claimed alert with notes (handler or Super Admin)', {
        parameters: idPath, requestBody: body(resolveSchema, { notes: 'Pengguna dibantu petugas di peron 2' }),
        responses: { ...ok('Alert resolved'), ...errors('400', '401', '403', '404', '409', '422') },
      }) },

      '/api/v1/dashboard/summary': { get: read('Analytics', "Today's totals and per-station breakdown in scope", { parameters: query(summaryQuery) }) },
      '/api/v1/analytics/usage': { get: read('Analytics', 'Daily usage statistics, at most 31 days (default last 7 days)', { parameters: query(usageQuery) }) },
      '/api/v1/audit-logs': { get: read('Audit', 'Audit log list without details (Super Admin)', { parameters: query(auditQuery) }) },
    },
    components: {
      securitySchemes: {
        sessionCookie: { type: 'apiKey', in: 'cookie', name: 'admin_session', description: 'Opaque session cookie set by POST /api/v1/auth/login' },
        csrfToken: { type: 'apiKey', in: 'header', name: 'X-CSRF-Token', description: 'Required on every cookie-authenticated mutation' },
        ingestKey: { type: 'apiKey', in: 'header', name: 'X-Ingest-Key', description: 'Development simulator key; production ingest is not configured' },
      },
      schemas: {
        Success: { type: 'object', required: ['success', 'data'], properties: { success: { const: true }, data: {} } },
        Error: errorEnvelope,
      },
      responses: {
        E400: errorResponse('Invalid input', 'VALIDATION_ERROR'),
        E401: errorResponse('Authentication required', 'UNAUTHENTICATED'),
        E403: errorResponse('Forbidden (missing CSRF, wrong role, station scope or password change required)', 'FORBIDDEN'),
        E404: errorResponse('Resource not found or outside station scope', 'NOT_FOUND'),
        E409: errorResponse('Conflict (duplicate, idempotency, claim race or invalid state)', 'CONFLICT'),
        E410: errorResponse('Camera session has expired', 'SESSION_EXPIRED'),
        E413: errorResponse('Request body too large', 'PAYLOAD_TOO_LARGE'),
        E415: errorResponse('JSON body required', 'JSON_REQUIRED'),
        E422: errorResponse('Invalid alert state transition', 'INVALID_STATE_TRANSITION'),
        E429: errorResponse('Too many requests', 'RATE_LIMITED'),
        E501: errorResponse('Not supported in this environment', 'INGEST_NOT_CONFIGURED'),
        E503: errorResponse('Dependency unavailable', 'DATABASE_UNAVAILABLE'),
      },
    },
  };
}

let cached: ReturnType<typeof build> | undefined;
export const openApiDocument = () => (cached ??= build());
