# Sprint 1 Minggu — Retensi Terjadwal, Hardening, dan Audit Backend

> Untuk eksekusi: plan disusun dengan Opus 5.5; ngoding dengan Sonnet 5.5 (user menjalankan `/model claude-sonnet-5-5` sebelum Hari 1). Tiap hari memakai `executing-plans`. Bug memakai `systematic-debugging`, dan sebelum klaim selesai memakai `verification-before-completion`. Semua perintah shell diawali `rtk`. **Tidak ada coding sebelum user memberi aba-aba setelah plan ini disetujui.**

## Context

Backend MVP (Task 1–12) sudah selesai di `main` (`57e4c15`), 105 tes lulus, dan CI hijau di 3 run. User meminta sprint harian sampai backend API selesai, dengan audit supaya tidak ada bug dan tidak ada API atau kode yang tidak terpanggil.

Keputusan user (21 November 2026):
- Durasi **1 minggu**, Senin 23 – Jumat 27 November 2026.
- Cakupan **backend API saja**, tanpa frontend.
- Fitur: **retensi terjadwal + hardening**.
- Retensi berjalan sebagai **service Compose terpisah**, dengan advisory lock, `--dry-run`, dan audit `RETENTION_RUN`.
- Re-identifikasi statistik: **dokumentasikan risikonya**, API tidak berubah.
- Field schema yang tidak terpakai: **pakai yang bernilai, hapus sisanya**.

Temuan audit awal (2 Explore agent, 21 November):
- Semua 23 route sudah terpanggil tes. Yang belum masuk Postman: `/health/live` dan `/api/v1/openapi.json`.
- Parameter yang belum diuji:
  - `GET /staff?stationId|page|pageSize`
  - `GET /alerts?status=<valid>`, `?page`, dan `?stationId` oleh Super Admin
  - `GET /stations?stationId` oleh Super Admin
  - `GET /audit-logs?page` dan `from>to`
  - `GET /analytics/usage` tanpa parameter
  - event `SESSION_ENDED`
- 8 cabang error tidak pernah terpicu: `PASSWORD_REUSE`, `RESOURCE_IN_USE`, `UNSUPPORTED_ENCODING`, `SESSION_CLOSED`, `SESSION_EXPIRED` (410), `INGEST_DISABLED` (503), `STATION_INACTIVE` pada staff, dan `CONFLICT` reassignment staff. Sisanya hanya dicek status HTTP-nya, bukan kode error.
- Export yang tidak perlu: `cookieOptions` di `src/features/auth/auth.router.ts:12`.
- Schema:
  - `admin_sessions.last_seen_at` tidak pernah diperbarui;
  - `audit_logs.details` tidak pernah diisi;
  - `admin_users.last_login_at` ditulis tetapi tidak dibaca;
  - purge PII tidak melepas `alerts.tracked_user_id`, padahal `database-design.md` menyatakan sebaliknya.
- Celah: retensi hanya manual; login gagal tidak diaudit; `npm run retention` memakai `tsx` (dev dependency) sehingga tidak bisa jalan di image produksi.
- Dokumen usang: api-spec (baris 100, 163, 178, 212), checklist baris 64 dan item CI, threat model (TM-003/006/007/010/011 serta path `src/routes/*`), `architecture.md` §2 (layout folder), `progress.md` (heading duplikat, angka tes yang saling bertentangan), dan `database-design.md` (`last_seen_at`).

## Aturan tetap selama sprint

- Format commit: satu baris `type: deskripsi huruf kecil` (`feat`, `fix`, `test`, `docs`, `build`, `ci`, `refactor`), tanpa body, tanpa trailer `Co-Authored-By`. Author akun user.
- Hanya branch `main`. Commit dibuat setelah gate harian lulus. Push ke `main` satu per satu, hanya setelah user menyetujui.
- Tes hanya memakai `timetable_admin_test`. Hitung baris DB demo sebelum dan sesudah tiap hari; hasilnya harus identik. Retensi sungguhan pada DB demo hanya di Hari 5, setelah dry-run dan izin user.
- **Gate harian** (wajib lulus sebelum commit): `rtk npm run typecheck`, `rtk npm test`, `rtk npm run build`, `rtk npm run postman:validate`, `rtk npm run postman:admin`, `rtk npm run postman:camera`, dan `rtk git diff --check`.

---

## Hari 1 — Senin 23 Nov: Audit cakupan API dan cabang error

**Tujuan:** setiap route, parameter, dan kode error penting benar-benar dipanggil dan diasersikan **kodenya**, bukan hanya statusnya.

1. Simpan plan ini ke `docs/superpowers/plans/2026-11-23-sprint-hardening.md`.
2. Helper tes `tests/helpers/expect-error.ts` dengan `expectError(res, status, code)`, yang memeriksa status, `success:false`, dan `error.code`. Pakai di tes yang sudah ada untuk `VALIDATION_ERROR`, `UNAUTHENTICATED`, `FORBIDDEN`, `CSRF_INVALID`, `INVALID_CREDENTIALS`, `INVALID_INGEST_KEY`, `RATE_LIMITED`, `NOT_FOUND`, `IDEMPOTENCY_CONFLICT`, `EVENT_OUT_OF_ORDER`, `TIMESTAMP_OUT_OF_RANGE`, `INGEST_SOURCE_MISMATCH`, `ALERT_ALREADY_ACKNOWLEDGED`, `INVALID_STATE_TRANSITION`, `JSON_REQUIRED`, `MOBILE_INGEST_UNSUPPORTED`, dan `INGEST_NOT_CONFIGURED`. Penggantian dilakukan bertahap per file tes yang sudah memeriksa status tersebut.
3. Tes baru untuk 8 cabang yang belum pernah terpicu:
   - `PASSWORD_REUSE`: ganti sandi ke sandi yang sama → 400 (`auth.test.ts`).
   - `RESOURCE_IN_USE`: hapus/ubah yang melanggar FK (P2003) → 409. Cari jalur nyatanya dulu; bila tidak ada jalur API yang bisa memicu, cukup uji unit `errorHandler` dengan error Prisma P2003 tiruan (`tests/security/http-baseline.test.ts`).
   - `UNSUPPORTED_ENCODING`: `Content-Encoding: gzip` → 415 (`http-baseline.test.ts`).
   - `SESSION_CLOSED`: kirim event setelah `SESSION_ENDED` → 409 (`ingest.test.ts`). Ini sekaligus menguji event `SESSION_ENDED`.
   - `SESSION_EXPIRED`: mundurkan `expiresAt` sesi lalu kirim event → 410 (`ingest.test.ts`).
   - `INGEST_DISABLED`: app tanpa `SIMULATOR_INGEST_KEY` → 503 (`ingest-abuse.test.ts`).
   - `STATION_INACTIVE` pada staff: create/update staff ke stasiun nonaktif → 400 (`staff.test.ts`).
   - `CONFLICT` reassignment: kondisi di `staff.service.ts:27` → 409 (`staff.test.ts`).
4. Tes parameter yang belum tercakup:
   - `GET /staff?stationId=&page=&pageSize=`
   - `GET /alerts?status=NEW|ACKNOWLEDGED|RESOLVED`, `?page=2`, dan `?stationId=` sebagai Super Admin
   - `GET /stations?stationId=` sebagai Super Admin
   - `GET /audit-logs?page=2` dan `from>to` (400)
   - `GET /analytics/usage` tanpa parameter (7 hari default)
5. Hapus `export` pada `cookieOptions`.
6. Pasang `@vitest/coverage-v8` (dev, versi yang cocok dengan vitest 5.0.5, diverifikasi di npm) dan script `test:coverage`. Catat baris `src/` yang belum tersentuh; tutup yang bermakna di Hari 1–3.
7. **Gate harian.**

Commit: `test: assert error codes and cover untested params and branches`, `build: add coverage report script`.

## Hari 2 — Selasa 24 Nov: Retensi terjadwal yang aman

**Tujuan:** penghapusan data berjalan otomatis setiap hari, tidak pernah jalan ganda, bisa dicek dulu tanpa menghapus, dan tercatat di audit.

1. `src/workers/retention-job.ts`:
   - `runRetention(db, now, { dryRun })` mengambil `pg_try_advisory_lock(<konstanta>)` di awal dan melepasnya di akhir. Kalau lock gagal, kembalikan `{ skipped: true }` tanpa menyentuh data.
   - Mode `dryRun`: hanya `COUNT(*)` dengan kriteria yang sama per langkah, tanpa DELETE atau UPDATE.
   - Purge PII juga mengosongkan `tracked_user_id`, sesuai `database-design.md`.
   - Selesai run (bukan dry-run), tulis audit `RETENTION_RUN` (actor null, entityType `retention`) dengan `details` berisi jumlah per langkah. Ini memakai `audit_logs.details` untuk pertama kalinya, dan isinya hanya angka, tanpa PII.
2. `src/workers/retention.ts`: baca flag `--dry-run` dan cetak hasil JSON.
3. `package.json`:
   - `retention` → `node --env-file-if-exists=.env dist/workers/retention.js`
   - tambah `retention:dry-run`
   - keduanya didahului `npm run build` lewat script `pre`.
   Hasilnya, worker bisa jalan tanpa `tsx`, sama seperti di image produksi.
4. `docker-compose.yml` mendapat service `retention`:
   - image `timetable-admin-backend:local`;
   - `command: ["sh","-c","while true; do node dist/workers/retention.js; sleep ${RETENTION_INTERVAL_SECONDS:-86400}; done"]`;
   - env DB sama seperti `api`; `depends_on` migrate selesai;
   - batas resource 256 MiB, `read_only`, `cap_drop`, rotasi log seperti service lain.
5. Tes di `tests/integration/retention.test.ts`:
   - dry-run tidak mengubah data dan mengembalikan jumlah yang benar;
   - dua `runRetention` paralel hanya satu yang jalan, satunya `skipped`;
   - audit `RETENTION_RUN` berisi angka tanpa PII;
   - `tracked_user_id` alert menjadi null setelah purge.
6. Verifikasi Docker:
   - `docker compose up -d`;
   - service `retention` sehat (log satu run, exit loop normal);
   - `docker compose exec retention node dist/workers/retention.js --dry-run` (container) berjalan.
7. **Gate harian.**

Commit: `feat: schedule retention with lock, dry run and audit record`, `build: add retention service to compose`.

## Hari 3 — Rabu 25 Nov: Hardening auth dan pembersihan schema

1. **Audit login gagal:** di `authService.login` (`src/features/auth/auth.service.ts:31-34`), sebelum melempar `invalidLogin()`, tulis audit `AUTH_LOGIN_FAILED`:
   - actor null; `entityId` = id akun bila username ada, null bila tidak; `stationId` = stasiun akun bila ada;
   - tanpa username, sandi, atau IP di `details`;
   - ditulis untuk akun dikenal maupun tidak, supaya waktu respons tetap seragam.
   Kegagalan karena akun nonaktif di dalam transaksi (baris 40) dicatat juga, di luar transaksi, mengikuti pola `guarded` di `alert.service.ts`. Rate limit login yang ada membatasi banjir baris audit.
2. **`last_login_at` dipakai:** tambahkan ke `staffSelect` (`src/features/staff/staff.service.ts`) agar Super Admin melihat login terakhir petugas. Respons OpenAPI/Postman disesuaikan.
3. **Hapus `admin_sessions.last_seen_at`:** ubah `prisma/schema.prisma:84`, lalu buat migration lewat `prisma migrate dev --create-only` pada DB test, tinjau SQL-nya (hanya `ALTER TABLE admin_sessions DROP COLUMN last_seen_at`), dan terapkan dengan `migrate deploy`. Uji migration dari database kosong (`db:test:setup` pada DB baru). Data demo tidak hilang, karena hanya kolom yang tidak pernah diperbarui yang dibuang.
4. Field yang **dipertahankan** sebagai metadata forensik dan dicatat di `database-design.md`: `tracked_users.first_seen_at`/`last_seen_at` dan `camera_events.received_at`.
5. Tes:
   - `audit.test.ts`: login gagal (username ada/tidak) tercatat tanpa secret, dan respons tetap 401 generik;
   - `staff.test.ts`: `lastLoginAt` terisi setelah login;
   - `database.test.ts`: kolom `last_seen_at` sudah tidak ada.
6. **Gate harian**, plus `rtk npm run test:docker` untuk migration di PostgreSQL 17 Docker.

Commit: `feat: audit failed logins`, `feat: expose staff last login time`, `refactor: drop unused admin session last seen column`.

## Hari 4 — Kamis 26 Nov: Sinkronisasi kontrak dan dokumen

1. **OpenAPI:** tambahkan `lastLoginAt` di deskripsi staff, aksi audit baru (`AUTH_LOGIN_FAILED`, `RETENTION_RUN`, `ALERT_ACCESS_DENIED`), serta deskripsi filter `status`/`page`. `openapi.test.ts` tetap lulus.
2. **Postman:** tambah request `Check Liveness` (`/health/live`), `Get OpenAPI Document`, `List Staff by Station` (`?stationId&page&pageSize`), `List Alerts by Status`, dan `Dashboard Summary by Station` (Super Admin), masing-masing dengan asersi. Update angka di `postman/validate.cjs`, lalu jalankan Newman.
3. **Dokumen usang diperbaiki:**
   - api-spec baris 100, 163, 178, 212 (status SSE, worker, purge, cara menjalankan retensi);
   - checklist baris 64; centang item CI dengan bukti 3 run hijau; centang retensi terjadwal;
   - threat model: TM-003 (kontrol sebenarnya), TM-006 (`alert-race.test.ts`), TM-007, TM-010 (CI ada), TM-011 (dry-run, lock, audit), path fokus ke `src/features/*`, dan analisis risiko re-identifikasi statistik (hitungan per stasiun/hari tanpa ID, hanya admin login, risiko diterima, ditinjau ulang bila ada stasiun kecil di produksi). Lalu centang item statistik di checklist sebagai "risiko diterima" beserta rujukannya;
   - `architecture.md` §2 (layout `src/features/*`);
   - `database-design.md` (`last_seen_at` dihapus, `tracked_user_id` dilepas saat purge);
   - `progress.md` (heading duplikat, satu angka tes terbaru);
   - `docs/panduan-presentasi.md` (masih untracked): analytics/audit tidak lagi draft, retensi kini otomatis, dan alur demo SSE serta audit penolakan. User memutuskan apakah file ini ikut di-commit.
4. **Gate harian.**

Commit: `docs: sync openapi, postman and docs with current backend`, `test: add postman requests for uncovered endpoints`.

## Hari 5 — Jumat 27 Nov: Audit akhir, bug bash, dan rilis

1. **Code review** skill (`code-review`, level high) pada diff sprint (`57e4c15..HEAD`). Setiap temuan dibuktikan dulu (`systematic-debugging`), diperbaiki kecil, dan diberi tes.
2. **Security review** skill pada perubahan auth, retensi, dan audit.
3. **Audit "tidak terpanggil" ulang:**
   - laporan coverage: setiap baris `src/` yang tidak tersentuh dijelaskan atau dites;
   - grep export yang tidak diimpor;
   - setiap route di `openapi.test.ts` ada di Postman, kecuali SSE long-lived yang didokumentasikan.
4. **Dry-run retensi pada DB demo** (hanya baca): `npm run retention:dry-run` terhadap `timetable_admin`. Laporkan jumlah yang akan terhapus ke user. Run sungguhan **hanya atas izin user**.
5. **Verifikasi penuh:**
   - gate harian;
   - `rtk npm run test:docker`, `rtk npm run postman:docker`, `rtk node scripts/check-docker-runtime.cjs`;
   - `rtk npm audit --omit=dev --omit=optional --audit-level=high`;
   - DB demo identik, kecuali bila run retensi disetujui.
6. Ringkasan rilis di `docs/progress.md`. Lalu `finishing-a-development-branch`: tanyakan push ke `main` satu per satu, cek CI hijau lewat API GitHub, dan buffer untuk perbaikan temuan.

Commit: `fix: …` per temuan (bila ada), `docs: record sprint release evidence`.

---

## Definition of Done (akhir sprint)

- Semua route dan parameter penting dipanggil tes dan Postman. Semua kode error yang bisa dipicu lewat API diasersikan kodenya.
- Tidak ada export, service method, atau kolom schema yang tidak terpakai tanpa alasan tertulis.
- Retensi berjalan otomatis harian di Compose, terkunci dari run ganda, bisa di-dry-run, dan tercatat di audit.
- Login gagal diaudit tanpa secret.
- Dokumen dan OpenAPI cocok dengan kode. Checklist hanya tersisa item deployment (HTTPS, Helmet/CSP per target, kredensial mobile).
- Gate harian, Docker, dan CI hijau. DB demo tidak tersentuh tanpa izin.

## Di luar sprint ini

Frontend dashboard, ingest mobile tepercaya, deployment/HTTPS, broker multi-instance, rotasi kunci, dan backup terenkripsi.
