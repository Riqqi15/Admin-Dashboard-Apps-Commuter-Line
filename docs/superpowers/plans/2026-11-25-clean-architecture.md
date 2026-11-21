# Clean Architecture Refactor — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Plan ditulis dengan Opus 5.5, eksekusi dengan Sonnet 5.5. Semua perintah shell diawali `rtk`. Format commit satu baris `type: deskripsi`, tanpa trailer. Coding hanya dimulai setelah user memberi aba-aba.

**Goal:** Menyusun ulang backend ke clean architecture per fitur (domain → application → infrastructure → presentation) tanpa mengubah kontrak HTTP, sehingga strukturnya bisa dijelaskan di laporan dan aturan dependensinya terbukti lewat tes.

**Architecture:** Setiap fitur di `src/features/<fitur>/` punya empat folder lapisan. Kode bersama ada di `src/shared/<lapisan>/`. Use case bergantung pada **port** (interface), sedangkan implementasi Prisma, Argon2, AES-GCM, HMAC, dan SSE ada di infrastructure. Transaksi dan lock PostgreSQL dibungkus port `UnitOfWork`; **urutan lock tetap ditulis di use case**. Composition root ada di `src/app.ts` (HTTP) dan `src/workers/retention.ts` (worker). Tidak memakai library DI.

**Tech Stack:** Express 5, TypeScript 6, Prisma 7.10, PostgreSQL 18, Zod 4, Vitest 5.

**Keputusan user (21–22 November 2026):** alasan utama syarat dosen/laporan; model pragmatis per fitur; **seluruh refactor dikerjakan dalam satu hari (Rabu 25 November)**.

## Jadwal (revisi: refactor satu hari)

| Hari | Isi |
|---|---|
| **Rabu 25** | Task 1–9: seluruh refactor clean architecture, gate per kelompok, tes arsitektur lulus |
| **Kamis 26** | Fitur Hari 3 lama di struktur baru (audit login gagal, `lastLoginAt`, hapus `last_seen_at`), `docs/architecture.md` + diagram, sinkron dokumen |
| **Jumat 27** | Audit akhir (code review, security review), dry-run retensi DB demo, Postman tambahan, rilis |

Bila refactor belum selesai Rabu malam, sisa task dilanjutkan Kamis pagi sebelum pekerjaan Kamis. Tes dan jaminan lock tidak dipotong.

---

## Aturan yang tidak boleh dilanggar

1. **Kontrak HTTP identik:** path, status, kode error, bentuk JSON, cookie, dan header. Repository mengembalikan field yang sama persis dengan query Prisma saat ini (select/`include` sama).
2. **Jaminan konkurensi identik:**
   - urutan lock stasiun → akun → sesi;
   - `FOR UPDATE` alert saat klaim;
   - advisory lock identifier ingest (`lockIdentifier`);
   - advisory lock retensi;
   - revalidasi sesi di dalam transaksi.
   Tes `alert-race`, `auth-races`, `ingest` (paralel), dan `retention` adalah penjaganya.
3. **Cek cepat per fitur:** `rtk npx tsc --noEmit` dan tes vitest yang relevan dengan fitur tersebut. **Gate per kelompok** (sebelum commit tiap kelompok): `rtk npm run typecheck`, `rtk npm test`, `rtk npm run build`, `rtk npm run postman:admin`, `rtk npm run postman:camera`. Ada tiga kelompok:
   - **A:** Task 2–5 (shared kernel, stations, staff, auth);
   - **B:** Task 6–7 (alerts, ingest);
   - **C:** Task 8–9 (analytics, audit, retention, docs, bersih-bersih).

   Gate harian penuh (ditambah `postman:validate`, `git diff --check`, dan hitung DB demo) di akhir hari.
4. Tes **tidak diubah perilakunya**, hanya path import-nya.

## Aturan dependensi (diuji `tests/unit/architecture.test.ts`)

| Lapisan | Boleh mengimpor | Dilarang |
|---|---|---|
| `domain` | `domain` (fitur sendiri, fitur lain, `shared/domain`) | semua paket npm dan `node:*`, `application`, `infrastructure`, `presentation`, `generated/prisma` |
| `application` | `domain`, `application` | semua paket npm dan `node:*`, `infrastructure`, `presentation`, `generated/prisma` |
| `infrastructure` | `domain`, `application`, `infrastructure`, paket apa pun | `presentation` |
| `presentation` | `domain`, `application`, `presentation`, paket HTTP (`express`, `zod`, `express-rate-limit`, `helmet`, `cors`, `cookie-parser`, `pino`, `pino-http`) | `infrastructure`, `generated/prisma` |
| Composition root (`src/app.ts`, `src/server.ts`, `src/workers/*.ts`, `src/config/*`) | semuanya | — |

Konsekuensinya:
- Enum Prisma (`AlertStatus`, `CameraEventType`, `AdminRole`, dan lainnya) didefinisikan ulang sebagai union string di domain. Prisma enum adalah union string yang identik, jadi baris Prisma tetap bisa di-assign langsung.
- `randomUUID`, `randomBytes`, dan `createHmac` pindah ke adapter infrastructure.

## Target struktur

```
src/
  app.ts                         composition root HTTP (merakit adapter → use case → router)
  server.ts                      entry proses API (tidak berubah, import createPrisma pindah)
  workers/retention.ts           entry + composition root worker (path tetap, Compose tidak berubah)
  config/env.ts                  tidak berubah
  shared/
    domain/errors.ts             AppError (+ notFound, forbidden) — pindahan src/http/errors.ts
    domain/roles.ts              type Role, type AuthContext
    domain/station-scope.ts      stationScope (pindahan src/middleware/station-scope.ts)
    domain/time.ts               utcDay, DAY_MS
    application/unit-of-work.ts  interface UnitOfWork<R>
    application/audit-trail.ts   interface AuditTrail
    infrastructure/prisma.ts     createPrisma (pindahan src/lib/prisma.ts)
    infrastructure/prisma-unit-of-work.ts
    infrastructure/locks.ts      lockUser, lockStationShared, lockStationForUpdate, advisoryXactLock
    infrastructure/prisma-audit-trail.ts
    infrastructure/daily-usage.ts incrementDailyUsage (pindahan src/lib/admin-data.ts)
    presentation/                request-context, security, error-handler, validation, require-session,
                                 require-role, require-csrf, express.d.ts (pindahan src/http, src/middleware, src/types)
  features/<fitur>/{domain,application,infrastructure,presentation}/
```

Yang dihapus setelah selesai: `src/http/`, `src/middleware/`, `src/lib/`, `src/types/`, dan file `*.service.ts` lama.

---

## HARI 3 — Rabu 25 Nov: seluruh refactor (Task 1–9)

Commit per kelompok:
- **A:** `refactor: add shared kernel and move stations, staff and auth to clean architecture layers`
- **B:** `refactor: move alerts and ingest to clean architecture layers`
- **C:** `refactor: move analytics, audit, retention and api docs to clean architecture layers`, lalu `test: enforce clean architecture dependency rule`

Commit per task yang disebut di bawah digabung menjadi tiga commit kelompok ini.

### Task 1: Tes arsitektur (ditulis duluan, gagal dulu)

**Files:** Create `tests/unit/architecture.test.ts`

- [ ] **Step 1: Tulis tes**

```ts
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, normalize, relative, resolve, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve('src');
const layers = ['domain', 'application', 'infrastructure', 'presentation'] as const;
type Layer = typeof layers[number];
const allowedLayers: Record<Layer, Layer[]> = {
  domain: ['domain'],
  application: ['domain', 'application'],
  infrastructure: ['domain', 'application', 'infrastructure'],
  presentation: ['domain', 'application', 'presentation'],
};
const httpPackages = ['express', 'zod', 'express-rate-limit', 'helmet', 'cors', 'cookie-parser', 'pino', 'pino-http'];

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    if (path.includes(join('src', 'generated'))) return [];
    return statSync(path).isDirectory() ? walk(path) : path.endsWith('.ts') ? [path] : [];
  });
}
const layerOf = (path: string): Layer | undefined => layers.find(layer => relative(root, path).split(sep).includes(layer));
const imports = (source: string) => [...source.matchAll(/(?:import|export)[^'"]*?from\s+'([^']+)'|import\s+'([^']+)'/g)].map(match => match[1] ?? match[2]!);

describe('clean architecture dependency rule', () => {
  const files = walk(root).filter(file => layerOf(file));

  it('puts every feature file in a layer folder', () => {
    const loose = walk(join(root, 'features')).filter(file => !layerOf(file)).map(file => relative(root, file));
    expect(loose).toEqual([]);
  });

  it('only depends inward', () => {
    const violations: string[] = [];
    for (const file of files) {
      const layer = layerOf(file)!;
      for (const specifier of imports(readFileSync(file, 'utf8'))) {
        const where = relative(root, file);
        if (specifier.startsWith('.')) {
          const target = normalize(resolve(dirname(file), specifier));
          if (target.includes(join('src', 'generated'))) { if (layer !== 'infrastructure') violations.push(`${where} -> ${specifier}`); continue; }
          const targetLayer = layerOf(target);
          if (!targetLayer || !allowedLayers[layer].includes(targetLayer)) violations.push(`${where} -> ${specifier}`);
          continue;
        }
        const bare = specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0]!;
        if (layer === 'domain' || layer === 'application') violations.push(`${where} -> ${specifier}`);
        if (layer === 'presentation' && !httpPackages.includes(bare)) violations.push(`${where} -> ${specifier}`);
      }
    }
    expect(violations).toEqual([]);
  });
});
```

- [ ] **Step 2:** `rtk npx vitest run tests/unit/architecture.test.ts`. **Expected FAIL** karena `src/features/*/*.ts` belum berada di folder lapisan. Tes ini menjadi indikator kemajuan sepanjang Hari 3–4 dan harus lulus di akhir Task 9.

### Task 2: Shared kernel

**Files:** Create file di `src/shared/**` seperti target struktur. Pindahkan isi file lama tanpa mengubah perilaku, lalu perbarui import di seluruh `src/`, `tests/`, `prisma/seed.ts`, dan `scripts/test-admin-api.cjs` (yang memakai `dist/…`).

- [ ] **Step 1: Port**

```ts
// src/shared/application/unit-of-work.ts
// One database transaction; repositories handed to `work` are bound to it, so locks and writes commit or roll back together.
export interface UnitOfWork<Repositories> {
  run<T>(work: (repositories: Repositories) => Promise<T>): Promise<T>;
}
```
```ts
// src/shared/application/audit-trail.ts
export type AuditEntry = { actorId: string | null; action: string; entityType: string; entityId: string | null; stationId: string | null; details?: Record<string, unknown> };
export interface AuditTrail { record(entry: AuditEntry): Promise<void> }
```
```ts
// src/shared/domain/roles.ts
export type Role = 'SUPER_ADMIN' | 'STATION_SECURITY';
export type AuthContext = Readonly<{
  sessionId: string; userId: string; username: string; role: Role; stationId: string | null;
  mustChangePassword: boolean; csrfTokenHash: string; expiresAt: Date;
}>;
```

- [ ] **Step 2: Adapter**

```ts
// src/shared/infrastructure/prisma-unit-of-work.ts
import type { Prisma, PrismaClient } from '../../generated/prisma/client';
import type { UnitOfWork } from '../application/unit-of-work';

export type Tx = Prisma.TransactionClient;
export function prismaUnitOfWork<R>(db: PrismaClient, bind: (tx: Tx) => R, options?: { timeout?: number; maxWait?: number }): UnitOfWork<R> {
  return { run: work => db.$transaction(tx => work(bind(tx)), options) };
}
```
```ts
// src/shared/infrastructure/prisma-audit-trail.ts
import type { AuditTrail } from '../application/audit-trail';
import type { Tx } from './prisma-unit-of-work';

export const prismaAuditTrail = (tx: Tx): AuditTrail => ({
  async record({ actorId, action, entityType, entityId, stationId, details }) {
    await tx.auditLog.create({ data: { actorAdminUserId: actorId, action, entityType, entityId, stationId, ...(details ? { details: details as never } : {}), expiresAt: new Date(Date.now() + 30 * 86400000) } });
  },
});
```
`locks.ts` berisi `lockUser`, `lockStationShared` (lama: `lockStation`, `FOR SHARE`), `lockStationForUpdate` (dari station.router), dan `advisoryXactLock(key: bigint)` (dari ingest `lockIdentifier`; hashing key tetap di adapter ingest).

- [ ] **Step 3: Pindah presentation bersama.** `src/http/*` → `src/shared/presentation/*`. `src/middleware/require-role.ts` dan `require-csrf.ts` → `src/shared/presentation/`. `src/types/express.d.ts` → `src/shared/presentation/express.d.ts` (tipe `AuthContext` dari `shared/domain/roles`). `stationScope` → `src/shared/domain/station-scope.ts`. `require-session.ts` dipindah di Task 5 bersama auth.
- [ ] **Step 4:** Gate per fitur, lalu commit `refactor: add shared kernel layers and unit of work`.

### Task 3: Stations (pola acuan, kode lengkap)

**Files:** Create `src/features/stations/{domain/station.ts, application/station-use-cases.ts, application/station-repository.ts, infrastructure/prisma-station-repository.ts, presentation/station.router.ts, presentation/station.schema.ts}`. Hapus `src/features/stations/station.router.ts` dan `station.schema.ts` lama.

```ts
// domain/station.ts
export type Station = Readonly<{ id: string; code: string; name: string; isActive: boolean; createdAt: Date; updatedAt: Date }>;
export type StationChanges = Partial<Pick<Station, 'code' | 'name' | 'isActive'>>;
```
```ts
// application/station-repository.ts
import type { Station, StationChanges } from '../domain/station';
export interface StationRepository {
  list(filter: { id?: string; activeOnly: boolean }, page: { page: number; pageSize: number }): Promise<{ items: Station[]; total: number }>;
  create(input: { code: string; name: string; isActive: boolean }): Promise<Station>;
  lockForUpdate(id: string): Promise<Station | null>;
  update(id: string, changes: StationChanges): Promise<Station>;
  revokeStaffSessions(stationId: string): Promise<void>;
}
```
```ts
// application/station-use-cases.ts
import type { AuditTrail } from '../../../shared/application/audit-trail';
import type { UnitOfWork } from '../../../shared/application/unit-of-work';
import { notFound } from '../../../shared/domain/errors';
import type { AuthContext } from '../../../shared/domain/roles';
import { stationScope } from '../../../shared/domain/station-scope';
import type { StationChanges } from '../domain/station';
import type { StationRepository } from './station-repository';

type Repos = { stations: StationRepository; audit: AuditTrail };
export function stationUseCases(read: StationRepository, uow: UnitOfWork<Repos>) {
  return {
    list(auth: AuthContext, query: { page: number; pageSize: number; stationId?: string }) {
      const id = stationScope(auth, query.stationId);
      return read.list({ id, activeOnly: auth.role === 'STATION_SECURITY' }, query);
    },
    create(actor: AuthContext, input: { code: string; name: string; isActive: boolean }) {
      return uow.run(async ({ stations, audit }) => {
        const created = await stations.create(input);
        await audit.record({ actorId: actor.userId, action: 'STATION_CREATED', entityType: 'station', entityId: created.id, stationId: created.id });
        return created;
      });
    },
    update(actor: AuthContext, id: string, changes: StationChanges) {
      return uow.run(async ({ stations, audit }) => {
        if (!await stations.lockForUpdate(id)) throw notFound();
        const updated = await stations.update(id, changes);
        if (changes.isActive === false) await stations.revokeStaffSessions(id);
        await audit.record({ actorId: actor.userId, action: 'STATION_UPDATED', entityType: 'station', entityId: id, stationId: id });
        return updated;
      });
    },
  };
}
```
```ts
// infrastructure/prisma-station-repository.ts
import type { StationRepository } from '../application/station-repository';
import { lockStationForUpdate } from '../../../shared/infrastructure/locks';
import type { Tx } from '../../../shared/infrastructure/prisma-unit-of-work';

export const prismaStationRepository = (db: Tx): StationRepository => ({
  async list({ id, activeOnly }, { page, pageSize }) {
    const where = { ...(id ? { id } : {}), ...(activeOnly ? { isActive: true } : {}) };
    const [items, total] = await Promise.all([
      db.station.findMany({ where, orderBy: { code: 'asc' }, skip: (page - 1) * pageSize, take: pageSize }),
      db.station.count({ where }),
    ]);
    return { items, total };
  },
  create: input => db.station.create({ data: input }),
  async lockForUpdate(id) { await lockStationForUpdate(db, id); return db.station.findUnique({ where: { id } }); },
  update: (id, changes) => db.station.update({ where: { id }, data: changes }),
  async revokeStaffSessions(stationId) { await db.adminSession.updateMany({ where: { adminUser: { stationId }, revokedAt: null }, data: { revokedAt: new Date() } }); },
});
```
Catatan: `list` lama memakai `db.$transaction([findMany, count])` (snapshot konsisten). Agar perilaku sama persis, router lama dipertahankan dengan membungkus `read.list` lewat `uow.run(({ stations }) => stations.list(...))`. Gunakan pola itu dan hapus `read`.

Presentation `station.router.ts` hanya: middleware → parse Zod (`station.schema.ts` dipindah apa adanya) → panggil use case → `response.json(...)`. `create` memakai `createStationSchema.parse` yang sudah mengisi default `isActive: true`.

Composition di `app.ts`:
```ts
const stationUow = prismaUnitOfWork(db, tx => ({ stations: prismaStationRepository(tx), audit: prismaAuditTrail(tx) }));
app.use('/api/v1/stations', stationRouter(stationUseCases(stationUow), sessionGuard, config));
```
(`sessionGuard` adalah middleware session dari Task 5. Sebelum Task 5, router masih menerima `db` untuk `requireSession` lama.)

- [ ] Gate per fitur. Commit `refactor: move stations to clean architecture layers`.

### Task 4: Staff

Pindahkan `staff.service.ts` → `application/staff-use-cases.ts`. Port `StaffRepository`:
- `list`
- `findStaff(id)`
- `lockStaff(id)`
- `lockStationShared(id)`
- `findStation(id)`
- `create`
- `update`
- `revokeSessions(userId)`
- `setPassword(id, hash)`

Port `PasswordHasher { hash(plain): Promise<string>; verify(hash, plain): Promise<boolean> }` di `src/features/auth/application/password-hasher.ts`; adapter `argon2-password-hasher.ts` di auth/infrastructure (pindahan `src/lib/password.ts`, parameter Argon2 sama).

Fungsi `staffAccount` dan `activeStation` menjadi fungsi privat di use case. Urutannya dipertahankan: kumpulkan stationId sumber/tujuan, sort, lock stasiun satu per satu, lock akun, baca ulang, `CONFLICT` bila stasiun berubah.

`staffSelect` (field respons) dipindah ke repository. Gate, lalu commit `refactor: move staff to clean architecture layers`.

### Task 5: Auth + session middleware

Port di `auth/application/`:
- `AuthRepository`:
  - `findByUsername`
  - `findById`
  - `lockStationShared`
  - `lockUser`
  - `findUserWithStation`
  - `recordLogin(userId)`
  - `createSession`
  - `findSessionByTokenHash`
  - `findSessionById`
  - `revokeUserSessions`
  - `updatePassword`
- `TokenService`: `newToken()` (randomBytes 32 hex) dan `hash(purpose, token)` (HMAC pepper, sama dengan `tokenHash`).
- `PasswordHasher`.

Use case di `auth/application/auth-use-cases.ts`:
- `login` (termasuk dummy hash untuk username yang tidak dikenal);
- `logout`;
- `changePassword`;
- `authenticate(token)`, dipindah dari `require-session.ts`: validasi sesi dan pencabutan sesi bila akun/stasiun nonaktif;
- `revalidate(auth)`, dipakai heartbeat SSE di alerts. Ini menghapus akses Prisma langsung dari `alert.router.ts`.

Presentation:
- `auth.router.ts` (cookie, rate limit, 415/403);
- `shared/presentation/require-session.ts`, yang kini memanggil `auth.authenticate` dan tidak lagi memegang `db`;
- `require-csrf.ts` memakai `TokenService.hash`.

Tes yang mengimpor `tokenHash` dari `features/auth/auth.service` diganti ke adapter `hmacTokenService(pepper).hash`. Gate, lalu commit `refactor: move auth and session handling to clean architecture layers`.

**Gate kelompok A**, lalu commit kelompok A. `architecture.test.ts` masih gagal hanya untuk fitur yang belum dipindah.

### Task 6: Alerts

- **domain:**
  - `alert.ts` (type `Alert`, `AlertStatus`, `FailureType`);
  - `alert-state.ts` (pindahan `failureState`, `assertAlertTransition`, memakai union string domain);
  - `CrossStationDenied` (subclass `AppError`).
- **application:**
  - port `AlertRepository`:
    - `list`
    - `findStationOf(id)`
    - `lockForUpdate(id)`
    - `findById`
    - `acknowledge`
    - `resolve`
    - `averageResponseSeconds(stationId, day)`
    - `setAverageResponse`
    - `incrementResolved`
  - port `ActorRepository`, yaitu fungsi `currentActor` lama: `lockStationShared`, `lockUser`, `findSessionWithUser`;
  - port `PiiCipher` (`decrypt(value, context)`);
  - port `AlertNotifier` (`publish(event)`);
  - use case `listAlerts`, `getAlert`, `acknowledgeAlert`, `resolveAlert` beserta helper `guarded` (audit `ALERT_ACCESS_DENIED` di unit-of-work terpisah).
- **infrastructure:**
  - `prisma-alert-repository.ts` (`FOR UPDATE` di `lockForUpdate`);
  - `aes-pii-cipher.ts`, berisi `encryptPii`/`decryptPii` dari `src/lib/pii.ts`; tes `pii.test.ts` mengimpor dari sini;
  - `in-memory-alert-stream.ts` (pindahan `alert-stream.ts`, mengimplementasikan `AlertNotifier` plus `subscribe`).
- **presentation:** `alert.router.ts` (REST + SSE; heartbeat memanggil `auth.revalidate`) dan `alert.schema.ts`.

Gate (khususnya `alert-race`, `alerts`, `audit`, `alert-stream` unit/integrasi). Commit `refactor: move alerts to clean architecture layers`.

### Task 7: Ingest

- **domain:**
  - `camera.ts` (`CameraEventType`, `IngestSource`, `CameraSessionStatus`);
  - `freshness.ts` (`fresh`: jendela ±5 menit, tanpa jam global; `now` diterima sebagai argumen).
- **application:**
  - port `IngestRepository`:
    - `lockIdentifier(kind, id)`
    - `findSessionByExternalId`
    - `findEventById`
    - `findStation`
    - `findTrackedUser`
    - `saveTrackedUser`
    - `createSession`
    - `hadSessionToday`
    - `findLatestEvent`
    - `createEvent`
    - `updateSession`
    - `createAlert`
    - `touchTrackedUser`
  - port `Fingerprint` (HMAC payload), `IdGenerator` (`randomUUID`), dan `PiiCipher` (dibagi dengan alerts, diimpor dari `features/alerts/application`);
  - use case `ingestSession`, `ingestEvent`, mengembalikan `notification` seperti sekarang;
  - statistik harian lewat port `DailyUsage` (adapter `shared/infrastructure/daily-usage.ts`).
- **infrastructure:**
  - `prisma-ingest-repository.ts` (`lockIdentifier` memakai `advisoryXactLock` dengan hashing SHA-256 yang sama persis);
  - `simulator-ingest-auth.ts` (pindahan `ingest-auth.ts`). Karena ini middleware Express, file ini masuk **presentation**, bukan infrastructure.
- **presentation:** `ingest.router.ts`, `ingest.schema.ts`, `ingest-auth.ts`.

Gate (khususnya `ingest`, `ingest-abuse`, `daily-stats`). Commit `refactor: move ingest to clean architecture layers`.

### Task 8: Analytics, audit, retention, docs

- **analytics:** port `AnalyticsReader` (`summary(stationId, day)`, `usage(from, to, stationId)`); use case memegang aturan rentang dari `usageRange` (pindah ke `analytics/domain/date-range.ts`) dan `stationScope`; adapter Prisma; router.
- **audit:** port `AuditReader.list(query)`; use case; adapter Prisma; router; schema.
- **retention:**
  - `retention/domain/policy.ts` (7 dan 30 hari, `batchSize`);
  - `retention/application/run-retention.ts` (alur dry-run/rollback, lock, audit `RETENTION_RUN`) dengan port `RetentionStore` (satu method per langkah SQL) dan `UnitOfWork`;
  - `retention/infrastructure/prisma-retention-store.ts` (SQL batch yang sama persis dan `pg_try_advisory_xact_lock`);
  - `src/workers/retention.ts` merakit semuanya dan tetap menjadi entry `dist/workers/retention.js`;
  - tes `retention.test.ts` mengimpor `runRetention` dan `retentionLockKey` dari lokasi baru.
- **docs (OpenAPI):** `features/docs/presentation/openapi.ts`, mengimpor schema dari `features/*/presentation/*.schema.ts`.

Gate. Commit `refactor: move analytics, audit, retention and api docs to clean architecture layers`.

### Task 9: Bersih-bersih dan bukti

- [ ] Hapus `src/http/`, `src/middleware/`, `src/lib/`, `src/types/`, dan file lama yang sudah kosong. Pastikan `rtk npx tsc --noEmit` bersih.
- [ ] `rtk npx vitest run tests/unit/architecture.test.ts` harus **PASS**.
- [ ] Coverage: `rtk npm run test:coverage`, minimal setara sebelum refactor (≈94% baris).
- [ ] Docker: `rtk npm run docker:build`, `docker:up`, `test:docker`, `postman:docker`, `check-docker-runtime`. Service `retention` jalan (`dist/workers/retention.js` tetap ada).
- [ ] Gate harian penuh, lalu commit kelompok C dan `test: enforce clean architecture dependency rule`.

---

## HARI 4 — Kamis 26 Nov: fitur Hari 3 lama + dokumen arsitektur

- [ ] Tulis ulang `docs/architecture.md`:
  - diagram Mermaid lingkaran lapisan;
  - tabel aturan dependensi;
  - peta per fitur;
  - sequence diagram "klaim alert" (router → use case → UnitOfWork → repository → PostgreSQL);
  - penjelasan port/adapter (Argon2, AES-GCM, HMAC, SSE);
  - alasan pragmatis (status HTTP di `AppError` tetap menjadi bagian kontrak error).
- [ ] Commit `docs: describe clean architecture layers`.
- `AUTH_LOGIN_FAILED` di use case `login`: audit lewat unit-of-work terpisah; `entityId` = id akun bila ada; tanpa username, sandi, atau IP. Tes di `audit.test.ts`.
- `lastLoginAt` di respons staff (select repository staff). Tes di `staff.test.ts`.
- Hapus `admin_sessions.last_seen_at` (schema + migration `--create-only`, tinjau SQL `DROP COLUMN`). Tes kolom hilang di `database.test.ts`; `test:docker` untuk Postgres 17.
- Sinkron dokumen padat:
  - OpenAPI (`lastLoginAt`, aksi audit baru);
  - checklist (CI hijau, retensi terjadwal, risiko statistik diterima);
  - threat model (path `src/features/*/<lapisan>`, TM-003/006/007/010/011);
  - `database-design.md`;
  - `progress.md`.
- Gate harian penuh, lalu commit per fitur (`feat: audit failed logins`, `feat: expose staff last login time`, `refactor: drop unused admin session last seen column`, `docs: sync docs with clean architecture backend`).

---

## HARI 5 — Jumat 27 Nov: audit akhir dan rilis

- Audit akhir: skill `code-review` (high) pada diff `cfc91a7..HEAD` dan skill `security-review`. Setiap temuan dibuktikan dulu dengan `systematic-debugging`.
- Dry-run retensi DB demo (`npm run retention:dry-run`), laporkan ke user; run sungguhan hanya atas izin.
- Postman tambahan (`/health/live`, `openapi.json`, filter staff/alerts) dan sisa sinkron dokumen. **Jika tidak muat, geser ke Senin 30 November.**
- Gate harian penuh, lalu `finishing-a-development-branch`: push satu per satu atas izin, cek CI.

## Risiko dan mitigasi

| Risiko | Mitigasi |
|---|---|
| Jaminan lock hilang saat dipindah ke repository | Urutan lock ditulis di use case; tes race wajib hijau per fitur; tidak ada penggabungan transaksi baru |
| Bentuk JSON berubah karena tipe domain memangkas field | Repository memakai select/include yang sama; tes yang memeriksa `toMatchObject`/`toEqual` pada respons plus Newman 119 assertion |
| Refactor besar tanpa titik aman | Satu commit per fitur setelah gate; bila gate gagal, `systematic-debugging` sebelum lanjut, jangan menumpuk fitur |
| Hari 5 terlalu padat | Postman tambahan dan sinkron dokumen non-kritis geser ke Senin 30 November |

## Self-review

- Cakupan: seluruh file `src/` lama punya tujuan di target struktur.
- Nama konsisten: `UnitOfWork`, `AuditTrail`, `prismaUnitOfWork`, `prismaAuditTrail`, `lockStationShared`, `lockStationForUpdate`, `CrossStationDenied`, `guarded`, `runRetention`, `retentionLockKey`.
- Penyimpangan dari template writing-plans: kode lengkap hanya diberikan untuk shared kernel, tes arsitektur, dan stations (pola acuan). Fitur lain berupa peta port dan perpindahan file, karena isinya adalah pemindahan kode yang ada dengan perilaku yang dijaga 123 tes yang sudah ada.
