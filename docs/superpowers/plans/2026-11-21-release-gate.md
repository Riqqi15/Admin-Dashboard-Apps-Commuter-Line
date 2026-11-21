# Release Gate MVP Backend — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Setiap perintah shell memakai prefix `rtk`.

**Goal:** Menutup sisa plan MVP: (1) audit penolakan alert lintas stasiun beserta tes audit per aksi, (2) CI GitHub Actions, (3) rebuild dan verifikasi Docker, (4) checklist keamanan, threat model, dan audit dependency yang didukung bukti.

**Architecture:** Penolakan lintas stasiun ditandai dengan subclass `AppError` (respons tetap 404). Audit-nya ditulis oleh helper `guarded` dalam transaksi terpisah, setelah transaksi utama di-rollback. CI menjalankan perintah npm yang sudah ada terhadap service PostgreSQL 18. Docker memakai `docker compose` dan script yang sudah ada. Dokumen hanya mencentang item yang punya bukti.

**Tech Stack:** Express 5.3, TypeScript, Prisma 7.10 + PostgreSQL 18, Vitest + Supertest, Newman, GitHub Actions (`actions/checkout@v7`, `actions/setup-node@v7`, diverifikasi dari halaman rilis resmi), Docker 29.7 / Compose.

## Context

`main` = `backend-camera-alerts` = `c456d8e`, dengan 101 tes lulus. Masalah dan keputusannya:
- Penolakan alert lintas stasiun tidak tercatat di audit, karena `accessibleAlert` melempar error di dalam transaksi sehingga audit ikut di-rollback.
- Belum ada `.github/`.
- Image Docker berasal dari 10 November. Docker 29.7.2 sudah aktif, dan stack `timetable-admin-capstone` sedang berjalan dengan image lama.
- Security checklist punya 26 item tanpa centang.
- Keputusan user: catat penolakan lintas stasiun; CI memakai typecheck tanpa ESLint; Docker sudah dinyalakan.
- `gh` CLI tidak terpasang di mesin ini, jadi status run CI dicek lewat halaman Actions (web-fetch) atau ditanyakan ke user.

## Aturan commit (instruksi user, 21 Nov 2026)

- Commit memakai akun user (`Riqqi15`). **Jangan tambahkan trailer `Co-Authored-By: Claude …`** di pesan commit mana pun. Instruksi user ini mengalahkan default attribution.
- Langkah pertama setelah keluar dari plan mode: simpan preferensi ini sebagai feedback memory (`feedback_no_claude_coauthor.md`) dan tambahkan pointer di `MEMORY.md`.

## File map

| File | Aksi | Tanggung jawab |
|---|---|---|
| `src/features/alerts/alert.service.ts` | Modify | `CrossStationDenied`, `guarded`, dan pembungkus `detail`/`acknowledge`/`resolve` |
| `tests/integration/audit.test.ts` | Create | Tes audit per aksi, penolakan, dan tanpa secret |
| `.github/workflows/ci.yml` | Create | Release gate otomatis |
| `docs/docker.md` | Modify | Bukti Docker terbaru |
| `docs/security-checklist.md` | Modify | Centang item yang punya bukti |
| `docs/timetable-admin-backend-threat-model.md` | Modify | Status SSE, OpenAPI, dan audit penolakan |
| `docs/dependency-audit.md` | Modify | Hasil `npm audit` terbaru |
| `docs/progress.md`, `docs/test-plan.md` | Modify | Angka dan bukti terbaru |
| `docs/superpowers/plans/2026-11-21-release-gate.md` | Create | Salinan plan ini di repo |

---

### Task A: Hapus Claude dari contributor (disetujui user: tulis ulang + force push)

Hanya `05b236f` dan `c456d8e` yang membawa trailer `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Author semua commit sudah `Riqqi15`. Commit lama (`76884c7` ke bawah) bersih.

- [ ] **Step 1: Simpan preferensi ke memory** — buat `feedback_no_claude_coauthor.md` (type feedback: jangan pakai trailer Co-Authored-By Claude; **Why:** user ingin hanya akunnya yang tercatat sebagai contributor GitHub; **How to apply:** setiap commit/PR di semua proyek), lalu tambahkan pointer di `MEMORY.md`.
- [ ] **Step 2: Pastikan working tree aman** — `rtk git status --short`. Yang boleh ada hanya 2 dokumen untracked; keduanya tidak tersentuh oleh rebase.
- [ ] **Step 3: Backup lokal** — `rtk git branch backup/pre-trailer-rewrite c456d8e`
- [ ] **Step 4: Tulis ulang pesan 2 commit, non-interaktif** (di branch `backend-camera-alerts`):

```bash
git rebase 76884c7 --exec "git log -1 --format=%B | grep -v '^Co-Authored-By: Claude' | git commit --amend --no-verify -F -"
```
Catatan: `--no-verify` di sini hanya melewati hook pada amend pesan. Isi kode tidak berubah; bila repo punya hook commit, jalankan tanpa flag itu.
- [ ] **Step 5: Verifikasi sebelum push**
  - `rtk git diff backup/pre-trailer-rewrite HEAD --stat` → kosong (isi identik)
  - `git log --format='%h %an %(trailers:key=Co-Authored-By,valueonly)' 76884c7..HEAD` → 2 commit, author `Riqqi15`, tanpa trailer
  - `git log --oneline -4` → urutan dan judul sama, hash baru untuk 2 commit teratas
- [ ] **Step 6: Force push dengan lease** (hanya menimpa bila remote masih di `c456d8e`):

```bash
git push --force-with-lease=main:c456d8e origin HEAD:main
git push --force-with-lease=backend-camera-alerts:c456d8e origin HEAD:backend-camera-alerts
```
- [ ] **Step 7: Cek** — `rtk git fetch origin` lalu `git log --oneline -2 origin/main` harus sama dengan HEAD. Daftar Contributors GitHub di-cache, jadi hilangnya Claude bisa tertunda; laporkan ini ke user. Backup branch lokal dihapus hanya atas izin user.
- Rollback bila perlu: `git push --force-with-lease origin backup/pre-trailer-rewrite:main`.

### Task 0: Simpan plan di repo

- [ ] **Step 1:** Salin isi file plan ini ke `docs/superpowers/plans/2026-11-21-release-gate.md`. Ikut di-commit bersama Task 1.

### Task 1: Audit penolakan alert lintas stasiun

**Files:** Modify `src/features/alerts/alert.service.ts`; Create `tests/integration/audit.test.ts`

- [ ] **Step 1: Tulis tes yang gagal** — buat `tests/integration/audit.test.ts`:

```ts
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminFixture, cookieOf, fixturePassword } from '../helpers/admin-api';
import { alertFixture } from '../helpers/camera-api';

let f: Awaited<ReturnType<typeof adminFixture>>;
beforeAll(async () => { f = await adminFixture(); });
afterAll(async () => { if (f) await f.cleanup(); });

const one = async (action: string, entityId: string) => {
  const rows = await f.db.auditLog.findMany({ where: { action, entityId } });
  expect(rows, `${action} for ${entityId}`).toHaveLength(1);
  return rows[0]!;
};

describe('Audit trail', () => {
  it('records auth, station and staff actions with actor, entity and station', async () => {
    const admin = await f.login();
    const station = await request(f.app).post('/api/v1/stations').set('Cookie', admin.cookie).set('X-CSRF-Token', admin.csrf)
      .send({ code: (f.prefix + '-AU').toUpperCase(), name: 'Audit fixture' });
    expect(station.status).toBe(201);
    const stationId = station.body.data.id as string;
    expect((await request(f.app).patch('/api/v1/stations/' + stationId).set('Cookie', admin.cookie).set('X-CSRF-Token', admin.csrf).send({ name: 'Audit fixture 2' })).status).toBe(200);
    const staff = await request(f.app).post('/api/v1/staff').set('Cookie', admin.cookie).set('X-CSRF-Token', admin.csrf)
      .send({ username: f.prefix + '.audit', password: fixturePassword, stationId: f.stationA.id });
    expect(staff.status).toBe(201);
    const staffId = staff.body.data.id as string;
    expect((await request(f.app).patch('/api/v1/staff/' + staffId).set('Cookie', admin.cookie).set('X-CSRF-Token', admin.csrf).send({ stationId: f.stationB.id })).status).toBe(200);
    const resetPassword = 'Audit-reset-passphrase-2026!';
    expect((await request(f.app).post('/api/v1/staff/' + staffId + '/reset-password').set('Cookie', admin.cookie).set('X-CSRF-Token', admin.csrf).send({ newPassword: resetPassword })).status).toBe(200);
    const staffLogin = await f.login(f.prefix + '.audit', resetPassword);
    const changed = await request(f.app).post('/api/v1/auth/change-password').set('Cookie', staffLogin.cookie).set('X-CSRF-Token', staffLogin.csrf)
      .send({ currentPassword: resetPassword, newPassword: 'Audit-changed-passphrase-2026!' });
    expect(changed.status).toBe(200);
    expect((await request(f.app).post('/api/v1/auth/logout').set('Cookie', cookieOf(changed)).set('X-CSRF-Token', changed.body.data.csrfToken).send({})).status).toBe(200);

    expect(await one('STATION_CREATED', stationId)).toMatchObject({ actorAdminUserId: f.admin.id, entityType: 'station', stationId });
    expect(await one('STATION_UPDATED', stationId)).toMatchObject({ actorAdminUserId: f.admin.id, stationId });
    expect(await one('STAFF_CREATED', staffId)).toMatchObject({ actorAdminUserId: f.admin.id, entityType: 'admin_user', stationId: f.stationA.id });
    expect(await one('STAFF_UPDATED', staffId)).toMatchObject({ actorAdminUserId: f.admin.id, stationId: f.stationB.id });
    expect(await one('STAFF_PASSWORD_RESET', staffId)).toMatchObject({ actorAdminUserId: f.admin.id });
    expect(await one('AUTH_PASSWORD_CHANGED', staffId)).toMatchObject({ actorAdminUserId: staffId, stationId: f.stationB.id });
    expect(await one('AUTH_LOGOUT', staffId)).toMatchObject({ actorAdminUserId: staffId });
    expect(await f.db.auditLog.count({ where: { action: 'AUTH_LOGIN', entityId: f.admin.id, actorAdminUserId: f.admin.id } })).toBeGreaterThan(0);
  });

  it('records alert creation, claim and resolution with the right actor and station', async () => {
    const fixture = await alertFixture(f);
    const handler = await f.login(f.securityA.username);
    const base = '/api/v1/alerts/' + fixture.alertId;
    expect((await request(f.app).patch(base + '/acknowledge').set('Cookie', handler.cookie).set('X-CSRF-Token', handler.csrf).send({})).status).toBe(200);
    expect((await request(f.app).patch(base + '/resolve').set('Cookie', handler.cookie).set('X-CSRF-Token', handler.csrf).send({ notes: 'Audit resolution' })).status).toBe(200);
    expect(await one('ALERT_CREATED', fixture.alertId)).toMatchObject({ actorAdminUserId: null, entityType: 'alert', stationId: f.stationA.id });
    expect(await one('ALERT_ACKNOWLEDGED', fixture.alertId)).toMatchObject({ actorAdminUserId: f.securityA.id, stationId: f.stationA.id });
    expect(await one('ALERT_RESOLVED', fixture.alertId)).toMatchObject({ actorAdminUserId: f.securityA.id, stationId: f.stationA.id });
  });

  it('records denied cross-station alert access without changing the alert or leaking its existence', async () => {
    const fixture = await alertFixture(f);
    const intruder = await f.login(f.securityB.username);
    const base = '/api/v1/alerts/' + fixture.alertId;
    const responses = [
      await request(f.app).get(base).set('Cookie', intruder.cookie),
      await request(f.app).patch(base + '/acknowledge').set('Cookie', intruder.cookie).set('X-CSRF-Token', intruder.csrf).send({}),
      await request(f.app).patch(base + '/resolve').set('Cookie', intruder.cookie).set('X-CSRF-Token', intruder.csrf).send({ notes: 'Not mine' }),
    ];
    const missing = await request(f.app).get('/api/v1/alerts/' + randomUUID()).set('Cookie', intruder.cookie);
    for (const response of responses) {
      expect(response.status).toBe(404);
      expect(response.body).toEqual(missing.body.error ? { ...response.body, error: missing.body.error } : response.body);
      expect(response.body.error.code).toBe('NOT_FOUND');
    }
    expect(await f.db.alert.findUniqueOrThrow({ where: { id: fixture.alertId } })).toMatchObject({ status: 'NEW', assignedToId: null });
    const denied = await f.db.auditLog.findMany({ where: { action: 'ALERT_ACCESS_DENIED', entityId: fixture.alertId } });
    expect(denied).toHaveLength(3);
    for (const row of denied) expect(row).toMatchObject({ actorAdminUserId: f.securityB.id, entityType: 'alert', stationId: f.stationA.id });
    expect(await f.db.auditLog.count({ where: { action: 'ALERT_ACCESS_DENIED', actorAdminUserId: f.securityB.id, NOT: { entityId: fixture.alertId } } })).toBe(0);

    const admin = await f.login();
    const listed = await request(f.app).get('/api/v1/audit-logs?action=ALERT_ACCESS_DENIED&stationId=' + f.stationA.id).set('Cookie', admin.cookie);
    expect(listed.status).toBe(200);
    expect(listed.body.data.items.filter((row: { entityId: string }) => row.entityId === fixture.alertId)).toHaveLength(3);
  });

  it('never stores passwords, tokens, keys or passenger data in audit rows', async () => {
    const rows = await f.db.auditLog.findMany({ where: { OR: [{ actorAdminUserId: { in: [f.admin.id, f.securityA.id, f.securityB.id] } }, { stationId: { in: [f.stationA.id, f.stationB.id] } }] } });
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(row.details).toBeNull();
    const text = JSON.stringify(rows);
    for (const secret of [fixturePassword, 'Audit-reset-passphrase-2026!', 'Audit-changed-passphrase-2026!', f.config.SIMULATOR_INGEST_KEY!, f.config.SESSION_PEPPER, 'Fixture Passenger', '081234567890']) {
      expect(text).not.toContain(secret);
    }
  });
});
```

Catatan: asersi "body sama" di tes ketiga cukup memastikan `error.code === 'NOT_FOUND'`. Baris `toEqual(...)` yang membandingkan dengan `missing` disederhanakan menjadi `expect(response.body.error).toEqual(missing.body.error)` bila kedua pesan memang sama (`'Resource not found'`).

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `rtk npx vitest run tests/integration/audit.test.ts`
Expected: tes 1, 2, dan 4 PASS (aksi sudah diaudit). Tes 3 FAIL dengan `expected [] to have length 3`.
Bila tes 1/2/4 gagal, itu temuan baru: pakai `systematic-debugging` sebelum mengubah apa pun.

- [ ] **Step 3: Implementasi minimal** — di `src/features/alerts/alert.service.ts`:

Setelah `const notFound = ...` (baris 12):
```ts
// Same response as notFound so existence never leaks; carries the alert's station for the audit trail.
class CrossStationDenied extends AppError {
  constructor(readonly alertStationId: string) { super(404, 'NOT_FOUND', 'Resource not found'); }
}
```

Ganti baris 42 di `accessibleAlert`:
```ts
  if (!alert || alert.expiresAt <= new Date()) throw notFound();
  if (actor.role === 'STATION_SECURITY' && actor.stationId !== alert.stationId) throw new CrossStationDenied(alert.stationId);
```

Di awal `alertService`, sebelum `return {`:
```ts
  // The failed transaction rolls back, so the denial is recorded on its own afterwards.
  async function guarded<T>(auth: AuthContext, id: string, run: () => Promise<T>) {
    try {
      return await run();
    } catch (error) {
      if (error instanceof CrossStationDenied) {
        await db.$transaction(tx => recordAudit(tx, auth.userId, 'ALERT_ACCESS_DENIED', 'alert', id, error.alertStationId));
      }
      throw error;
    }
  }
```

Bungkus tiga method:
```ts
    async detail(auth: AuthContext, id: string) {
      return guarded(auth, id, () => db.$transaction(async tx => { /* isi lama, tidak berubah */ }));
    },
```
Pola yang sama untuk `acknowledge(auth, id)` dan `resolve(auth, id, notes)`: `return db.$transaction(...)` diganti `return guarded(auth, id, () => db.$transaction(...))`, lalu tutup `}))`. `recordAudit` sudah di-import dari `src/lib/admin-data.ts`.

- [ ] **Step 4: Jalankan, pastikan lulus**

Run: `rtk npx tsc --noEmit` → tanpa output.
Run: `rtk npx vitest run tests/integration/audit.test.ts tests/integration/alerts.test.ts tests/integration/alert-race.test.ts tests/security`
Expected: semua PASS. Respons 404 lintas stasiun di `alerts.test.ts` tidak berubah.

- [ ] **Step 5: Commit** (dengan izin user)

```powershell
rtk git add src/features/alerts/alert.service.ts tests/integration/audit.test.ts docs/superpowers/plans/2026-11-21-release-gate.md
rtk git commit -m "Audit denied cross-station alert access and cover audit trail with tests"
```

### Task 2: CI GitHub Actions

**Files:** Create `.github/workflows/ci.yml`

- [ ] **Step 1: Tulis workflow**

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

permissions:
  contents: read

jobs:
  release-gate:
    runs-on: ubuntu-latest
    timeout-minutes: 25
    services:
      postgres:
        image: postgres:18
        env:
          POSTGRES_USER: admin_backend
          POSTGRES_PASSWORD: ci-throwaway-password
          POSTGRES_DB: timetable_admin
        ports:
          - 5434:5432
        options: >-
          --health-cmd "pg_isready -U admin_backend -d timetable_admin"
          --health-interval 5s --health-timeout 3s --health-retries 20
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with:
          node-version: 24
          cache: npm
      - run: npm ci
      - name: Write CI environment (throwaway values, never printed)
        run: |
          {
            echo "NODE_ENV=development"
            echo "HOST=127.0.0.1"
            echo "PORT=3000"
            echo "CORS_ORIGIN=http://localhost:5173"
            echo "DATABASE_URL=postgresql://admin_backend:ci-throwaway-password@127.0.0.1:5434/timetable_admin"
            echo "SESSION_PEPPER=$(openssl rand -hex 32)"
            echo "PII_ENCRYPTION_KEY=$(openssl rand -hex 32)"
          } > .env
      - run: npm run prisma:generate
      - run: npm run prisma:migrate
      - run: npm run typecheck
      - run: npm test
      - run: npm run build
      - run: npm run postman:validate
      - run: npm run postman:admin
      - run: npm run postman:camera
      - run: npm audit --omit=dev --audit-level=high
      - run: docker build --target runtime -t timetable-admin-backend:ci .
```

Alasan desain: port `5434`, user `admin_backend`, dan DB `timetable_admin` mengikuti guard tes di `tests/helpers/test-db.ts` dan `scripts/setup-test-db.cjs`. `npm test` membuat `timetable_admin_test` lewat `pretest`. Password service hanya hidup di runner sementara.

- [ ] **Step 2: Verifikasi lokal yang bisa dilakukan**

Run: `rtk node -e "require('fs').readFileSync('.github/workflows/ci.yml','utf8')"`. Lalu parse YAML dengan paket yang sudah terpasang bila ada (`rtk node -e "require('yaml')"`); kalau tidak ada, lewati, tanpa menambah dependency.
Jalankan juga urutan perintah yang sama secara lokal (Task 5), sehingga yang belum terbukti hanya lingkungan runner.

- [ ] **Step 3: Commit** (dengan izin user)

```powershell
rtk git add .github/workflows/ci.yml
rtk git commit -m "Add CI release gate: migrate, typecheck, tests, Newman, audit, image build"
```

- [ ] **Step 4: Bukti run pertama** — hanya setelah user mengizinkan push ke `main`. Cek `https://github.com/Riqqi15/Admin-Dashboard-Apps-Commuter-Line/actions` lewat agent web-fetch (repo publik) atau minta user memeriksanya. Bila gagal, pakai `systematic-debugging` pada log step yang gagal.

### Task 3: Rebuild dan verifikasi Docker

**Files:** Modify `docs/docker.md`

- [ ] **Step 1:** `rtk npm run docker:build` → image `timetable-admin-backend:local` dan `timetable-admin-migrate:local` sukses.
- [ ] **Step 2:** `rtk npm run docker:up` → `migrate` Exited (0), `api` dan `db` healthy (`rtk docker compose ps`). Volume `admin_db_data` dipertahankan, tanpa `down -v`.
- [ ] **Step 3:** `rtk npm run postman:docker` → health/readiness lulus di `127.0.0.1:3001`.
- [ ] **Step 4:** `rtk npm run test:docker` → semua tes lulus terhadap `127.0.0.1:5435/timetable_admin_test`; pretest membuat dan memigrasi DB itu di container.
- [ ] **Step 5:** `rtk node scripts/check-docker-runtime.cjs` → non-root, root filesystem read-only, tanpa tooling dev atau secret file.
- [ ] **Step 6:** Pemeriksaan tambahan:
  - `rtk docker run --rm --entrypoint sh timetable-admin-backend:local -c "ls /app; ls /app/node_modules/.bin | grep -c prisma || true"` → hanya `dist`, `node_modules`, `package.json`, tanpa `scripts/` dan tanpa Prisma CLI.
  - `curl -s -o NUL -w "%{http_code}" http://127.0.0.1:3001/api/v1/openapi.json` → 200, karena compose default development. Perilaku production sudah dibuktikan oleh `openapi.test.ts`.
- [ ] **Step 7:** Perbarui `docs/docker.md` dengan tanggal, versi Docker, dan hasil langkah 1–6. Bila ada langkah gagal, berhenti dan pakai `systematic-debugging`.

### Task 4: Dokumen keamanan berbasis bukti

**Files:** Modify `docs/security-checklist.md`, `docs/timetable-admin-backend-threat-model.md`, `docs/dependency-audit.md`, `docs/progress.md`, `docs/test-plan.md`

- [ ] **Step 1: Audit dependency** — `rtk npm audit --omit=dev` dan `rtk npm audit`, lalu perbarui angka, tanggal, dan triase di `docs/dependency-audit.md`. Jangan jalankan `audit fix --force`.
- [ ] **Step 2: Checklist** — centang hanya baris berikut beserta bukti singkatnya:

| Baris | Bukti |
|---|---|
| Threat model diperbarui | Step 3 |
| Endpoint punya auth/role/scope | `src/features/docs/openapi.ts`, `tests/integration/openapi.test.ts`, `docs/api-specification.md` |
| Tanpa upload gambar/video | `strictObject` di `ingest.schema.ts`; `tests/security/ingest-abuse.test.ts` |
| Retensi/anonimisasi | `src/workers/retention-job.ts`, `tests/integration/retention.test.ts` |
| Secret dev/prod terpisah | `src/config/env.ts` (production menolak simulator key dan origin non-HTTPS), `.gitignore` `.env*`, `tests/unit/env.test.ts` |
| IDOR read/write | `alerts.test.ts`, `audit.test.ts`, `tests/security/station-bola.test.ts` |
| Acknowledge atomik | `tests/integration/alert-race.test.ts` |
| Schema ketat | `strictObject` + `idParams` di semua router; header CSRF/ingest key divalidasi |
| Batas ukuran/rentang/pagination | body 32/16 KiB (`http-baseline.test.ts`), rentang 31 hari (`analytics.test.ts`), pageSize ≤100 |
| Tanpa raw SQL dari input | hanya tagged `$queryRaw`/`$executeRaw` yang terparameter; tanpa `*Unsafe` di `src/` selain kode generated |
| Tanpa eval/shell/fetch arbitrer | grep `src/` bersih; simulator hanya script dev yang dibatasi ke host lokal |
| Timeout/body limit | `src/server.ts` (requestTimeout 30 s, headersTimeout 15 s, keepAlive 5 s) |
| Kredensial production tidak di mobile | ingest production 501 (`ingest-auth.ts`); belum ada integrasi mobile |
| Error generik | `src/http/error-handler.ts`; asersi "Safe error" di Newman |
| PII 7 hari / hapus 30 hari | `retention.test.ts` |
| Node/Express maintained | Node 24 LTS (`engines`), Express 5.3.0 |
| Lockfile dikomit | `git ls-files package-lock.json` |
| CI | `.github/workflows/ci.yml`; lint = typecheck strict (keputusan). **Dicentang hanya setelah run pertama hijau** |
| Triase dependency / tanpa High-Critical runtime | `docs/dependency-audit.md`, `npm audit --omit=dev` = 0 |
| Tanpa inspector | Dockerfile `CMD ["node","dist/server.js"]` |
| Seed/simulator/Swagger terlindungi di production | `openapi.test.ts`, `seed.test.ts`, guard di `simulate-camera-events.ts`, image tanpa `scripts/` |

Tetap tanpa centang, dengan alasan tertulis: **Helmet/CSP sesuai deployment** (target deployment belum ditentukan), **HTTPS production** (belum ada deployment), dan **re-identifikasi statistik** (belum ada analisis jumlah minimum per stasiun/hari).

- [ ] **Step 3: Threat model** — perbarui ringkasan baris 5 (SSE, retensi, dan analytics sudah diuji runtime di DB test). TM-002: kontrol "log denied cross-station attempts" sekarang ada (`ALERT_ACCESS_DENIED`). TM-005: runtime SSE terverifikasi (`alert-stream.test.ts`). Tambah catatan bahwa OpenAPI hanya ada di non-production.
- [ ] **Step 4:** Perbarui `docs/progress.md` dan `docs/test-plan.md` dengan jumlah tes baru, bukti Docker, dan CI.
- [ ] **Step 5: Commit** (dengan izin user)

```powershell
rtk git add docs/docker.md docs/security-checklist.md docs/timetable-admin-backend-threat-model.md docs/dependency-audit.md docs/progress.md docs/test-plan.md
rtk git commit -m "Record release-gate evidence: Docker, security checklist, threat model, dependency audit"
```

### Task 5: Verifikasi akhir (`verification-before-completion`)

- [ ] Hitung baris DB demo `timetable_admin` sebelum dan sesudah, dengan script hitung `pg` sementara yang langsung dihapus. Hasilnya harus identik.
- [ ] `rtk npm run typecheck` → exit 0
- [ ] `rtk npm test` → semua lulus (≥ 105 tes, 22 file)
- [ ] `rtk npm run build`, `rtk npm run postman:validate`, `rtk npm run postman:admin`, `rtk npm run postman:camera` → 0 assertion gagal
- [ ] `rtk npm audit --omit=dev --audit-level=high` → exit 0
- [ ] `rtk git diff --check` → bersih
- [ ] Lanjut ke `finishing-a-development-branch`: laporkan hasil, lalu tanyakan push ke `main`. Push dilakukan satu per satu, fast-forward, sesuai preferensi user sebelumnya.

## Self-review

- Cakupan spesifikasi: contributor (TA), audit (T1), CI (T2), Docker (T3), checklist/threat model/dependency (T4), verifikasi (T5). Lengkap. Pesan commit di T1, T2, dan T4 tanpa trailer Claude.
- Tidak ada placeholder. Kode lengkap untuk semua langkah yang mengubah kode; dokumen berupa daftar bukti eksplisit.
- Nama konsisten: `CrossStationDenied`, `guarded`, `ALERT_ACCESS_DENIED`, dan `alertStationId` sama di T1 dan T4.

## Di luar scope

Ingest mobile dengan token tepercaya, frontend, deployment/HTTPS produksi, ESLint, dan repo Timetable dosen.
