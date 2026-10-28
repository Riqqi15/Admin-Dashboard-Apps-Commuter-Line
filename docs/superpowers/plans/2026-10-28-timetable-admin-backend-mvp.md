# Timetable Admin Backend MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox ('- [ ]') syntax for tracking.

**Goal:** Build a secure backend-only capstone that records Camera Assist usage per station, creates critical-failure alerts, and enforces Super Admin versus Station Security access.

**Architecture:** One Express and TypeScript API uses PostgreSQL through Prisma. Opaque cookie sessions protect dashboard endpoints, service-layer station scoping enforces authorization, and SSE delivers alert updates. A simulator supplies camera events until a separate mobile integration is authorized.

**Tech Stack:** Node.js, TypeScript, Express, PostgreSQL, Prisma, Zod, Argon2id, Vitest, Supertest, Docker Compose, Swagger/OpenAPI, Postman, and Newman.

---

## Scope and execution rules

- Work only inside 'C:\Users\riyadh\Documents\ChatGPT\Admin Dashboard'.
- Do not modify 'C:\Users\riyadh\Timetable-scheduling' or its Git remote.
- Do not push to GitHub unless the user explicitly requests it.
- Apply TDD for domain and security behavior: failing test, minimal implementation, passing test, commit.
- Do not accept or store camera images or video.
- Use UUIDs for public resource identifiers.
- Keep production simulator and seed routes disabled.
- Run all shell commands through 'rtk'.

## Planned file map

~~~text
.
├── package.json
├── package-lock.json
├── tsconfig.json
├── .env.example
├── docker-compose.yml
├── prisma/
│   ├── schema.prisma
│   └── seed.ts
├── src/
│   ├── app.ts
│   ├── server.ts
│   ├── config/env.ts
│   ├── lib/prisma.ts
│   ├── http/
│   │   ├── errors.ts
│   │   ├── error-handler.ts
│   │   ├── security.ts
│   │   └── request-context.ts
│   ├── middleware/
│   │   ├── require-session.ts
│   │   ├── require-role.ts
│   │   ├── require-csrf.ts
│   │   └── station-scope.ts
│   ├── features/
│   │   ├── health/
│   │   ├── auth/
│   │   ├── stations/
│   │   ├── staff/
│   │   ├── ingest/
│   │   ├── alerts/
│   │   ├── analytics/
│   │   └── audit/
│   ├── workers/retention.ts
│   └── types/express.d.ts
├── scripts/simulate-camera-events.ts
├── tests/
│   ├── helpers/
│   ├── unit/
│   ├── integration/
│   └── security/
├── postman/
│   ├── Timetable-Admin.postman_collection.json
│   └── Local.postman_environment.example.json
└── docs/
~~~

### Task 1: Scaffold the TypeScript API

**Files:**
- Create: 'package.json'
- Create: 'tsconfig.json'
- Create: '.env.example'
- Create: 'src/config/env.ts'
- Create: 'src/app.ts'
- Create: 'src/server.ts'
- Test: 'tests/unit/env.test.ts'

- [ ] **Step 1: Initialize npm and install the minimum dependencies**

Run:

~~~powershell
rtk npm init -y
rtk npm install express helmet cors zod @prisma/client argon2 cookie-parser express-rate-limit pino pino-http
rtk npm install -D typescript tsx prisma vitest supertest @types/node @types/express @types/cookie-parser @types/supertest newman
~~~

Expected: 'package.json' and 'package-lock.json' exist and npm exits with code 0.

- [ ] **Step 2: Add scripts to package.json**

Use these scripts:

~~~json
{
  "scripts": {
    "dev": "tsx watch src/server.ts",
    "build": "tsc -p tsconfig.json",
    "start": "node dist/server.js",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest",
    "prisma:generate": "prisma generate",
    "prisma:migrate": "prisma migrate dev",
    "prisma:seed": "tsx prisma/seed.ts",
    "retention": "tsx src/workers/retention.ts",
    "simulate": "tsx scripts/simulate-camera-events.ts",
    "postman": "newman run postman/Timetable-Admin.postman_collection.json -e postman/Local.postman_environment.example.json"
  },
  "prisma": {
    "seed": "tsx prisma/seed.ts"
  }
}
~~~

- [ ] **Step 3: Configure strict TypeScript**

Create 'tsconfig.json' with 'strict', 'noUncheckedIndexedAccess', 'exactOptionalPropertyTypes', 'rootDir' set to '.', and 'outDir' set to 'dist'.

- [ ] **Step 4: Write a failing environment validation test**

~~~typescript
import { describe, expect, it } from 'vitest';
import { parseEnv } from '../../src/config/env';

describe('parseEnv', () => {
  it('rejects a missing database URL', () => {
    expect(() => parseEnv({
      NODE_ENV: 'test',
      SESSION_PEPPER: 'x'.repeat(32),
      PII_ENCRYPTION_KEY: 'a'.repeat(64),
    })).toThrow(/DATABASE_URL/);
  });
});
~~~

- [ ] **Step 5: Run the test and verify failure**

Run: 'rtk npm test -- tests/unit/env.test.ts'

Expected: FAIL because 'src/config/env.ts' does not exist.

- [ ] **Step 6: Implement strict environment parsing**

Use Zod to require 'DATABASE_URL', 'SESSION_PEPPER' of at least 32 characters, a 64-hex-character 'PII_ENCRYPTION_KEY', explicit 'CORS_ORIGIN', and 'NODE_ENV'. Production must reject localhost CORS origins and a missing proxy configuration.

- [ ] **Step 7: Add the Express entrypoints**

'app.ts' exports a configured Express app without listening. 'server.ts' loads validated environment, starts the HTTP server, sets request/header timeouts, handles server errors, and performs graceful shutdown.

- [ ] **Step 8: Run verification**

Run:

~~~powershell
rtk npm test -- tests/unit/env.test.ts
rtk npm run typecheck
rtk npm run build
~~~

Expected: all commands exit 0.

- [ ] **Step 9: Commit**

~~~powershell
rtk git add package.json package-lock.json tsconfig.json .env.example src tests/unit/env.test.ts
rtk git commit -m "chore: scaffold secure typescript api"
~~~

### Task 2: Add PostgreSQL, Prisma schema, migration, and seed

**Files:**
- Create: 'docker-compose.yml'
- Create: 'prisma/schema.prisma'
- Create: 'prisma/seed.ts'
- Create: 'src/lib/prisma.ts'
- Test: 'tests/integration/database.test.ts'

- [ ] **Step 1: Write the database connectivity test**

The test must call Prisma, execute 'SELECT 1' through Prisma's safe API, and assert that the database responds.

- [ ] **Step 2: Start PostgreSQL locally**

Create Docker Compose with PostgreSQL, a named volume, health check, and credentials sourced from environment variables.

Run:

~~~powershell
rtk docker compose up -d db
rtk docker compose ps
~~~

Expected: database service reports healthy.

- [ ] **Step 3: Define the Prisma schema**

Create the approved models and enums from 'docs/database-design.md':

- Station
- AdminUser
- AdminSession
- TrackedUser
- CameraSession
- CameraEvent
- Alert
- AuditLog
- DailyUsageStat
- AdminRole
- CameraSessionStatus
- CameraEventType
- AlertStatus
- IngestSource

Enforce the unique IDs, indexes, one-alert-per-session rule, and relation delete behavior from the design.

- [ ] **Step 4: Add database-level role/station consistency**

The migration must add a PostgreSQL check constraint:

~~~sql
CHECK (
  (role = 'SUPER_ADMIN' AND station_id IS NULL)
  OR
  (role = 'STATION_SECURITY' AND station_id IS NOT NULL)
)
~~~

- [ ] **Step 5: Generate and apply the migration**

Run:

~~~powershell
rtk npx prisma generate
rtk npx prisma migrate dev --name initial_schema
~~~

Expected: migration succeeds and Prisma Client is generated.

- [ ] **Step 6: Implement an idempotent seed**

Seed two stations, one Super Admin, and one security account per station. Hash passwords with Argon2id. Read seed passwords from environment and refuse to run when 'NODE_ENV=production'.

- [ ] **Step 7: Run verification**

Run:

~~~powershell
rtk npm run prisma:seed
rtk npm test -- tests/integration/database.test.ts
rtk npx prisma migrate status
~~~

Expected: seed can run twice without duplicate rows, the test passes, and migration status is current.

- [ ] **Step 8: Commit**

~~~powershell
rtk git add docker-compose.yml prisma src/lib tests/integration/database.test.ts
rtk git commit -m "feat: add admin database schema"
~~~

### Task 3: Establish the HTTP security baseline

**Files:**
- Create: 'src/http/errors.ts'
- Create: 'src/http/error-handler.ts'
- Create: 'src/http/security.ts'
- Create: 'src/http/request-context.ts'
- Modify: 'src/app.ts'
- Test: 'tests/security/http-baseline.test.ts'

- [ ] **Step 1: Write failing security-header and error-redaction tests**

Test that responses disable 'x-powered-by', include Helmet headers, reject JSON bodies over the configured limit, reject disallowed origins, and never return a stack trace.

- [ ] **Step 2: Run the test and verify failure**

Run: 'rtk npm test -- tests/security/http-baseline.test.ts'

Expected: FAIL before security middleware is installed.

- [ ] **Step 3: Implement the baseline**

Configure:

- Helmet with a CSP appropriate for an API and future same-origin dashboard.
- Exact CORS origin allowlist with credentials.
- A 32 KiB JSON body limit for ordinary endpoints and a 16 KiB limit for ingest endpoints.
- Pino request logging with redaction for authorization, cookies, passwords, tokens, and phone fields.
- Stable JSON error shape.
- Request IDs.
- A final not-found handler and error handler.
- No raw internal error messages in production.

- [ ] **Step 4: Verify**

Run:

~~~powershell
rtk npm test -- tests/security/http-baseline.test.ts
rtk npm run typecheck
~~~

Expected: all tests pass.

- [ ] **Step 5: Commit**

~~~powershell
rtk git add src/http src/app.ts tests/security/http-baseline.test.ts
rtk git commit -m "feat: add secure http baseline"
~~~

### Task 4: Implement username/password authentication and opaque sessions

**Files:**
- Create: 'src/features/auth/auth.schema.ts'
- Create: 'src/features/auth/auth.service.ts'
- Create: 'src/features/auth/auth.router.ts'
- Create: 'src/middleware/require-session.ts'
- Create: 'src/middleware/require-csrf.ts'
- Create: 'src/types/express.d.ts'
- Modify: 'src/app.ts'
- Test: 'tests/integration/auth.test.ts'
- Test: 'tests/security/auth-abuse.test.ts'

- [ ] **Step 1: Write failing authentication tests**

Cover:

- Successful username/password login.
- Username normalization to lowercase.
- Generic error for unknown username and wrong password.
- HttpOnly and SameSite cookie flags.
- Secure cookie in production configuration.
- Session token stored only as a SHA-256 HMAC hash.
- Logout revocation.
- Account deactivation revocation.
- CSRF rejection for state-changing requests.
- Login rate limiting: at most 5 failed attempts per normalized username plus IP and 30 attempts per IP within 15 minutes.

- [ ] **Step 2: Run the tests and verify failure**

Run: 'rtk npm test -- tests/integration/auth.test.ts tests/security/auth-abuse.test.ts'

Expected: FAIL because auth routes do not exist.

- [ ] **Step 3: Implement session creation**

Generate 32 random bytes for the opaque token. Hash it with the server session pepper before storage. Create a separate random CSRF token and store only its hash. Return the CSRF token in the login JSON response and the session token only in the 'admin_session' cookie. Sessions expire after 8 hours of absolute lifetime.

- [ ] **Step 4: Implement authentication routes**

Implement:

- 'POST /api/v1/auth/login'
- 'POST /api/v1/auth/logout'
- 'GET /api/v1/auth/me'
- 'POST /api/v1/auth/change-password'

Use strict Zod schemas. Password changes revoke all other sessions.

- [ ] **Step 5: Implement session and CSRF middleware**

'require-session' reads the cookie, verifies its hash and expiry, confirms the account is active, and attaches an immutable auth context. 'require-csrf' requires an exact 'x-csrf-token' header match for POST, PUT, PATCH, and DELETE routes.

- [ ] **Step 6: Verify**

Run:

~~~powershell
rtk npm test -- tests/integration/auth.test.ts tests/security/auth-abuse.test.ts
rtk npm run typecheck
~~~

Expected: all tests pass.

- [ ] **Step 7: Commit**

~~~powershell
rtk git add src/features/auth src/middleware src/types src/app.ts tests/integration/auth.test.ts tests/security/auth-abuse.test.ts
rtk git commit -m "feat: add secure admin authentication"
~~~

### Task 5: Implement stations, staff management, and station RBAC

**Files:**
- Create: 'src/middleware/require-role.ts'
- Create: 'src/middleware/station-scope.ts'
- Create: 'src/features/stations/station.schema.ts'
- Create: 'src/features/stations/station.router.ts'
- Create: 'src/features/staff/staff.schema.ts'
- Create: 'src/features/staff/staff.service.ts'
- Create: 'src/features/staff/staff.router.ts'
- Modify: 'src/app.ts'
- Test: 'tests/integration/staff.test.ts'
- Test: 'tests/security/station-bola.test.ts'

- [ ] **Step 1: Write failing role and BOLA tests**

Test that:

- Super Admin can create, update, and deactivate staff.
- Station Security cannot access staff-management routes.
- Station Security cannot set or override station scope.
- A staff account has exactly one station.
- Moving staff changes future scope without rewriting historical alerts.
- Requests for another station return 403 or scoped 404 consistently.

- [ ] **Step 2: Implement role middleware and station context**

Derive station ID only from the authenticated account. Never trust query, path, or body station scope for Station Security.

- [ ] **Step 3: Implement station and staff routes**

Implement:

- 'GET /api/v1/stations'
- 'POST /api/v1/stations'
- 'PATCH /api/v1/stations/:id'
- 'GET /api/v1/staff'
- 'POST /api/v1/staff'
- 'PATCH /api/v1/staff/:id'
- 'POST /api/v1/staff/:id/reset-password'

A password reset sets 'mustChangePassword=true' and revokes all active sessions.

- [ ] **Step 4: Verify**

Run:

~~~powershell
rtk npm test -- tests/integration/staff.test.ts tests/security/station-bola.test.ts
rtk npm run typecheck
~~~

Expected: all tests pass.

- [ ] **Step 5: Commit**

~~~powershell
rtk git add src/features/stations src/features/staff src/middleware src/app.ts tests/integration/staff.test.ts tests/security/station-bola.test.ts
rtk git commit -m "feat: enforce station scoped staff access"
~~~

### Task 6: Implement camera session and event ingest

**Files:**
- Create: 'src/features/ingest/ingest.schema.ts'
- Create: 'src/features/ingest/ingest-auth.ts'
- Create: 'src/features/ingest/ingest.service.ts'
- Create: 'src/features/ingest/ingest.router.ts'
- Modify: 'src/app.ts'
- Test: 'tests/integration/ingest.test.ts'
- Test: 'tests/security/ingest-abuse.test.ts'

- [ ] **Step 1: Write failing ingest tests**

Cover:

- Session creation requires 'stationConfirmed=true'.
- Unknown stations are rejected.
- Repeating the same external ID and same payload is idempotent.
- Reusing an ID with a different payload returns 409.
- Timestamps more than 5 minutes old or 5 minutes in the future are rejected.
- Unknown fields and media fields are rejected.
- Ingest bodies are limited to 16 KiB and each source plus IP is limited to 60 requests per minute.
- Simulator authentication is rejected in production mode.

- [ ] **Step 2: Implement development ingest authentication**

Use a development-only ingest key from environment for the simulator. Fail application startup if this key is configured in production. Keep production mobile authentication behind an explicit unsupported error until a trusted token contract is approved.

- [ ] **Step 3: Implement session ingest**

Implement 'POST /api/v1/ingest/sessions'. Encrypt name and phone with AES-256-GCM using the configured key and a random 12-byte IV. Store a versioned Base64 envelope containing IV, ciphertext, and authentication tag inside each ciphertext column. Store a separate payload fingerprint to detect conflicting idempotency reuse.

- [ ] **Step 4: Implement event ingest**

Implement 'POST /api/v1/ingest/events' for:

- SESSION_STARTED
- CAMERA_INIT_FAILED
- ANALYSIS_FAILED
- ANALYSIS_RECOVERED
- SESSION_ENDED

Use unique 'eventId', database transactions, and this error-code allowlist: 'CAMERA_UNAVAILABLE', 'CAMERA_INITIALIZATION_FAILED', 'FRAME_ENCODING_FAILED', 'VISION_TIMEOUT', 'VISION_PROVIDER_UNAVAILABLE', and 'NETWORK_TIMEOUT'.

- [ ] **Step 5: Verify**

Run:

~~~powershell
rtk npm test -- tests/integration/ingest.test.ts tests/security/ingest-abuse.test.ts
rtk npm run typecheck
~~~

Expected: all tests pass.

- [ ] **Step 6: Commit**

~~~powershell
rtk git add src/features/ingest src/app.ts tests/integration/ingest.test.ts tests/security/ingest-abuse.test.ts
rtk git commit -m "feat: add idempotent camera event ingest"
~~~

### Task 7: Implement alert creation and lifecycle

**Files:**
- Create: 'src/features/alerts/alert-state.ts'
- Create: 'src/features/alerts/alert.service.ts'
- Create: 'src/features/alerts/alert.schema.ts'
- Create: 'src/features/alerts/alert.router.ts'
- Modify: 'src/features/ingest/ingest.service.ts'
- Modify: 'src/app.ts'
- Test: 'tests/unit/alert-state.test.ts'
- Test: 'tests/integration/alerts.test.ts'
- Test: 'tests/integration/alert-race.test.ts'

- [ ] **Step 1: Write failing domain tests**

Test:

- CAMERA_INIT_FAILED creates an alert immediately.
- Two ANALYSIS_FAILED events do not create an alert.
- ANALYSIS_RECOVERED resets the failure sequence.
- The third consecutive failure creates one alert.
- Later failures in the same session do not create another alert.
- Invalid status transitions are rejected.

- [ ] **Step 2: Implement alert creation in the ingest transaction**

Event persistence, failure-sequence evaluation, and alert creation must commit atomically. Enforce one alert per session with a unique constraint and handle duplicate delivery without a 500 response.

- [ ] **Step 3: Write failing lifecycle and race tests**

Test:

- NEW can become ACKNOWLEDGED.
- Only the assigned handler or Super Admin can resolve.
- Resolution note is required and limited.
- Two parallel acknowledge requests yield one success and one 409.
- Station B cannot read or mutate Station A alerts.

- [ ] **Step 4: Implement alert routes**

Implement:

- 'GET /api/v1/alerts'
- 'GET /api/v1/alerts/:id'
- 'PATCH /api/v1/alerts/:id/acknowledge'
- 'PATCH /api/v1/alerts/:id/resolve'

Use conditional update on 'status=NEW' for acknowledge.

- [ ] **Step 5: Verify**

Run:

~~~powershell
rtk npm test -- tests/unit/alert-state.test.ts tests/integration/alerts.test.ts tests/integration/alert-race.test.ts
rtk npm run typecheck
~~~

Expected: all tests pass.

- [ ] **Step 6: Commit**

~~~powershell
rtk git add src/features/alerts src/features/ingest src/app.ts tests/unit/alert-state.test.ts tests/integration/alerts.test.ts tests/integration/alert-race.test.ts
rtk git commit -m "feat: add camera failure alert workflow"
~~~

### Task 8: Add station-filtered SSE

**Files:**
- Create: 'src/features/alerts/alert-events.ts'
- Create: 'src/features/alerts/alert-stream.router.ts'
- Modify: 'src/features/alerts/alert.service.ts'
- Modify: 'src/app.ts'
- Test: 'tests/integration/alert-stream.test.ts'
- Test: 'tests/security/sse-scope.test.ts'

- [ ] **Step 1: Write failing SSE tests**

Test that:

- An authenticated Super Admin receives all alert events.
- Station Security receives only events for its station.
- Client-provided station parameters are ignored.
- The initial SSE payload excludes phone and decrypted PII.
- Revoked sessions cannot open new streams.
- Each admin session is limited to 2 SSE connections, each IP to 20 connections, and the server sends a heartbeat every 20 seconds.

- [ ] **Step 2: Implement an in-process alert event bus**

Publish only after database commit. Event payload contains alert ID, station ID, status, and timestamps. The database remains the source of truth.

- [ ] **Step 3: Implement 'GET /api/v1/alerts/stream'**

Authenticate before opening the stream, derive station scope from the session, send heartbeat comments, remove listeners on disconnect, and cap connections per session/IP.

- [ ] **Step 4: Verify**

Run:

~~~powershell
rtk npm test -- tests/integration/alert-stream.test.ts tests/security/sse-scope.test.ts
rtk npm run typecheck
~~~

Expected: all tests pass.

- [ ] **Step 5: Commit**

~~~powershell
rtk git add src/features/alerts src/app.ts tests/integration/alert-stream.test.ts tests/security/sse-scope.test.ts
rtk git commit -m "feat: stream station scoped alerts"
~~~

### Task 9: Add audit logging, analytics, and retention

**Files:**
- Create: 'src/features/audit/audit.service.ts'
- Create: 'src/features/audit/audit.router.ts'
- Create: 'src/features/analytics/analytics.schema.ts'
- Create: 'src/features/analytics/analytics.service.ts'
- Create: 'src/features/analytics/analytics.router.ts'
- Create: 'src/workers/retention.ts'
- Modify: relevant mutation services
- Modify: 'src/app.ts'
- Test: 'tests/integration/audit.test.ts'
- Test: 'tests/integration/analytics.test.ts'
- Test: 'tests/integration/retention.test.ts'

- [ ] **Step 1: Write failing audit tests**

Verify that login, staff changes, acknowledge, resolve, and denied cross-station actions produce allowlisted audit records without password, token, cookie, or full phone data.

- [ ] **Step 2: Implement audit logging**

Use a structured action enum and allowlisted detail builders. Never serialize request bodies directly into audit JSON.

- [ ] **Step 3: Write failing analytics tests**

Cover date-range caps, Super Admin station filters, forced Station Security scope, unique-user aggregation, failed-session counts, alert counts, and average response seconds.

- [ ] **Step 4: Implement analytics routes**

Implement:

- 'GET /api/v1/dashboard/summary'
- 'GET /api/v1/analytics/usage'
- 'GET /api/v1/audit-logs'

Limit analytics ranges to 31 days, list pages to 100 records, and default pages to 25 records.

- [ ] **Step 5: Write failing retention tests with a controlled clock**

Verify:

- PII, sessions, and events are removed/anonymized after 7 days.
- PII snapshots on alerts are cleared after 7 days.
- Alerts and audit logs are deleted after 30 days.
- Admin accounts, stations, and aggregate stats remain.
- The worker cannot delete outside its allowlisted tables.

- [ ] **Step 6: Implement the retention worker**

Run retention steps in bounded transactions, log row counts, and exit non-zero on partial failure. Production scheduling belongs to the deployment platform; local execution uses 'npm run retention'.

- [ ] **Step 7: Verify**

Run:

~~~powershell
rtk npm test -- tests/integration/audit.test.ts tests/integration/analytics.test.ts tests/integration/retention.test.ts
rtk npm run typecheck
~~~

Expected: all tests pass.

- [ ] **Step 8: Commit**

~~~powershell
rtk git add src/features/audit src/features/analytics src/workers src/app.ts tests/integration
rtk git commit -m "feat: add analytics audit and retention"
~~~

### Task 10: Add health checks, OpenAPI, and simulator

**Files:**
- Create: 'src/features/health/health.router.ts'
- Create: 'src/features/docs/openapi.ts'
- Create: 'scripts/simulate-camera-events.ts'
- Modify: 'src/app.ts'
- Test: 'tests/integration/health.test.ts'
- Test: 'tests/integration/openapi.test.ts'

- [ ] **Step 1: Write failing health and OpenAPI tests**

Test liveness without database access, readiness with a database query, OpenAPI path coverage, and production protection for Swagger UI.

- [ ] **Step 2: Implement health endpoints**

Implement:

- 'GET /health/live'
- 'GET /health/ready'

Readiness returns a non-200 response when PostgreSQL is unavailable.

- [ ] **Step 3: Implement OpenAPI generation**

Document every route, authentication mechanism, CSRF header, stable error response, rate-limit response, and example payload from 'docs/api-specification.md'. Validate the generated document during tests.

- [ ] **Step 4: Implement the simulator**

The script logs in as an ingest simulator only in development, creates a confirmed session, sends a selected scenario, and prints created IDs without printing secrets or PII.

Supported scenarios:

- healthy-session
- camera-init-failed
- two-failures-then-recovered
- three-consecutive-failures
- duplicate-event

- [ ] **Step 5: Verify**

Run:

~~~powershell
rtk npm test -- tests/integration/health.test.ts tests/integration/openapi.test.ts
rtk npm run simulate -- three-consecutive-failures
~~~

Expected: tests pass and the simulator creates one alert.

- [ ] **Step 6: Commit**

~~~powershell
rtk git add src/features/health src/features/docs scripts src/app.ts tests/integration/health.test.ts tests/integration/openapi.test.ts
rtk git commit -m "feat: add health docs and event simulator"
~~~

### Task 11: Build the Postman and Newman acceptance suite

**Files:**
- Create: 'postman/Timetable-Admin.postman_collection.json'
- Create: 'postman/Local.postman_environment.example.json'
- Modify: 'docs/test-plan.md'

- [ ] **Step 1: Create collection folders**

Use the exact folder order from 'docs/test-plan.md':

1. Health Check
2. Authentication
3. Stations
4. Staff Management
5. Camera Session Ingest
6. Camera Failure Events
7. Alerts
8. Analytics
9. Audit Logs
10. Security and Negative Tests

- [ ] **Step 2: Add collection-level helpers**

Store generated UUIDs, CSRF token, station IDs, session ID, and alert ID as collection variables. Do not store actual passwords, cookies, or production tokens in committed environments.

- [ ] **Step 3: Add assertions**

Every request checks status, JSON content type, stable response shape, and relevant state. Add explicit assertions for 401, 403/scoped 404, 409, 413, 422, and 429 cases.

- [ ] **Step 4: Run Newman**

Run:

~~~powershell
rtk npm run postman
~~~

Expected: zero failed assertions.

- [ ] **Step 5: Commit**

~~~powershell
rtk git add postman docs/test-plan.md
rtk git commit -m "test: add postman acceptance suite"
~~~

### Task 12: Complete security and release verification

**Files:**
- Create: '.github/workflows/ci.yml'
- Create: 'Dockerfile'
- Modify: 'docs/security-checklist.md'
- Modify: 'README.md'
- Test: all tests and build

- [ ] **Step 1: Add CI**

CI must install from the lockfile, start PostgreSQL, apply migrations, run typecheck, unit/integration/security tests, build, run Newman, and run a production dependency audit.

- [ ] **Step 2: Add a production Dockerfile**

Use a supported Node image, multi-stage build, non-root runtime user, production dependencies only, no inspector, no seed/simulator command, and an explicit health check.

- [ ] **Step 3: Run the full local release gate**

Run:

~~~powershell
rtk npm ci
rtk docker compose up -d db
rtk npx prisma migrate deploy
rtk npm run typecheck
rtk npm test
rtk npm run build
rtk npm run postman
rtk npm audit --omit=dev --audit-level=high
rtk docker build -t timetable-admin-backend:local .
~~~

Expected: every command exits 0. Audit findings must be triaged for reachability and production relevance; do not silently ignore High/Critical runtime issues.

- [ ] **Step 4: Review the security checklist**

For each checked item in 'docs/security-checklist.md', add a short evidence reference to a test, source file, or deployment configuration. Leave any unproven item unchecked.

- [ ] **Step 5: Confirm repository boundaries**

Run:

~~~powershell
rtk git status --short
rtk git remote -v
~~~

Expected: only the Admin Dashboard repository is active, and no command targets the professor's Timetable repository.

- [ ] **Step 6: Commit**

~~~powershell
rtk git add .github Dockerfile README.md docs/security-checklist.md
rtk git commit -m "ci: enforce backend release security gate"
~~~

## Requirement coverage self-review

| Requirement group | Implemented by |
|---|---|
| Backend foundation and PostgreSQL | Tasks 1–3 |
| Username/password and secure sessions | Task 4 |
| Super Admin and one-station security role | Task 5 |
| Camera session/event ingest | Task 6 |
| Critical failure threshold and alert lifecycle | Task 7 |
| Real-time station-filtered alert | Task 8 |
| Analytics, audit, and 7/30-day retention | Task 9 |
| Swagger and simulator | Task 10 |
| Postman/Newman acceptance testing | Task 11 |
| Dependency, CI, and deployment security | Task 12 |

## Execution checkpoints

- Checkpoint A after Task 3: foundation, database, and HTTP baseline review.
- Checkpoint B after Task 5: authentication and station isolation review.
- Checkpoint C after Task 8: ingest, alert lifecycle, and SSE review.
- Checkpoint D after Task 12: full Postman/security/release evidence review.

