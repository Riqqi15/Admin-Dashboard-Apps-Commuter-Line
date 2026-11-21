# Security Checklist

Checklist ini wajib dibuktikan melalui kode, konfigurasi, dan test. CVE adalah identitas kerentanan; CVSS adalah skor keparahan, bukan sesuatu yang dapat dijamin tidak pernah muncul.

## Desain

- [x] Trust boundary, aset, dan abuse path sudah diperbarui pada threat model. Bukti: `docs/timetable-admin-backend-threat-model.md` (diperbarui 21 November).
- [x] Semua endpoint mempunyai definisi autentikasi, role, dan station scope. Bukti: `src/features/docs/openapi.ts` (security scheme per operasi), `tests/integration/openapi.test.ts`, `docs/api-specification.md`.
- [x] Tidak ada endpoint upload gambar/video. Bukti: schema ingest `strictObject` menolak field media; `tests/security/ingest-abuse.test.ts`; daftar route di `openapi.test.ts`.
- [x] Data sensitif mempunyai retensi dan mekanisme anonimisasi. Bukti: `src/workers/retention-job.ts`, `tests/integration/retention.test.ts`.
- [x] Secret development dan production dipisahkan. Bukti: `src/config/env.ts` (production menolak simulator key dan origin non-HTTPS), `.gitignore` (`.env*`), `tests/unit/env.test.ts`, Dockerfile tanpa secret.

## Authentication dan session

- [x] Password di-hash dengan Argon2id (64 MiB, 3 iterasi, paralelisme 1). Bukti: `src/lib/password.ts`, tes seed/auth/staff.
- [x] Username dinormalisasi dan unik. Bukti: schema Zod, constraint PostgreSQL, tes auth/staff.
- [x] Login dibatasi per IP dan username+IP. Bukti: `tests/security/auth-abuse.test.ts`; MemoryStore masih untuk satu proses, bukan limit terdistribusi.
- [x] Session token acak, hanya HMAC disimpan, token baru pada login dan ganti sandi. Bukti: `tests/integration/auth.test.ts`.
- [x] Cookie HttpOnly, SameSite=Strict, dan Secure pada production. Bukti: tes auth.
- [x] Logout, reset password, serta deaktivasi akun/stasiun mencabut sesi. Bukti: tes auth/staff dan `tests/security/auth-races.test.ts`.
- [x] Error login tidak membedakan username valid/tidak valid. Bukti: tes auth.

## Authorization

Bukti database: constraint `admin_users_role_station_check` mencegah akun petugas tanpa satu stasiun atau Super Admin dengan stasiun. Checkpoint B menambah pemeriksaan role dan scope stasiun/staff. Implementasi 17 November menambah isolasi REST alert dan revalidasi sesi dalam transaksi (`tests/integration/alerts.test.ts`, `alert-race.test.ts`). SSE menerapkan filter stasiun dari sesi server dan revalidasi sesi berkala; isolasi stasiun, batas koneksi, dan penolakan sesi dibuktikan oleh `tests/integration/alert-stream.test.ts`.

- [x] Pemeriksaan role dilakukan pada backend untuk route stasiun/staff yang sudah tersedia.
- [x] Scope akun terkini diterapkan pada query daftar stasiun melalui `stationScope`; route bisnis berikutnya tetap harus memakai scope serupa.
- [x] Petugas tidak dapat memilih station scope melalui query parameter pada endpoint stasiun.
- [x] SSE difilter berdasarkan role dan stasiun dari sesi server, tanpa stationId client.
- [x] Test IDOR/BOLA mencakup read dan write lintas stasiun. Bukti: `tests/integration/alerts.test.ts`, `tests/security/station-bola.test.ts`, `tests/integration/audit.test.ts` (read/ack/resolve lintas stasiun → 404 identik dengan alert tidak ada, tercatat `ALERT_ACCESS_DENIED`).
- [x] Acknowledge alert atomik dan mencegah double assignment. Bukti: `tests/integration/alert-race.test.ts` (dua claimant bersamaan, satu handler).

## Input, output, dan injection

- [x] Semua body, params, query, dan header penting divalidasi dengan schema ketat. Bukti: `strictObject` pada seluruh schema fitur dan `src/http/validation.ts`; header `X-Ingest-Key` dan CSRF diperiksa di middleware (`ingest-auth.ts`, `tests/security/auth-abuse.test.ts`).
- [x] Field tak dikenal ditolak pada schema login/ganti sandi, pembuatan/perubahan stasiun/staff dan reset sandi; pengujian mencakup mass assignment.
- [x] Ukuran body, panjang string, rentang tanggal, dan pagination dibatasi. Bukti: body 32 KiB/16 KiB ingest dan respons 413 (`src/http/security.ts`, `tests/security/http-baseline.test.ts`); rentang analytics maksimal 31 hari (`analytics.test.ts`); pageSize maksimal 100 (`audit.test.ts`/`analytics.test.ts`); panjang string pada schema Zod.
- [x] Tidak ada raw SQL dari input pengguna. Bukti: seluruh query mentah memakai tagged template `$queryRaw`/`$executeRaw` terparameter (`src/lib/admin-data.ts`, `src/workers/retention-job.ts`, service alert); tanpa `$queryRawUnsafe`/`$executeRawUnsafe` pada kode sumber non-generated (grep `src/`).
- [x] Tidak ada eval, shell command, arbitrary URL fetch, atau unsafe redirect. Bukti: grep `src/` untuk `eval`, `child_process`, `exec(`, dan fetch keluar tidak menemukan apa pun; tidak ada route redirect. Script simulator (`scripts/`) hanya dev, menolak production dan host non-lokal, serta tidak ada di image.
- [x] Payload SSE berupa JSON metadata terbatas dan tidak memuat PII/HTML mentah.

## CSRF, CORS, dan HTTP

- [x] Mutasi berbasis cookie yang tersedia memakai token CSRF sesi dan pemeriksaan Origin/Sec-Fetch-Site. Bukti: `tests/security/auth-abuse.test.ts` dan `station-bola.test.ts`.
- [x] CORS memakai allowlist tanpa wildcard credentials. Bukti: `src/http/security.ts`, `tests/security/http-baseline.test.ts`.
- [ ] Helmet dan CSP disetel sesuai deployment. Helmet dan CSP API-only sudah aktif (`src/http/security.ts`, `http-baseline.test.ts`), tetapi target deployment belum ditentukan sehingga kecocokannya belum dapat dibuktikan.
- [x] Header x-powered-by dinonaktifkan. Bukti: `src/app.ts`, `tests/security/http-baseline.test.ts`.
- [ ] Production memakai HTTPS. Konfigurasi menolak CORS origin non-HTTPS pada production (`env.ts`), tetapi belum ada deployment yang membuktikan terminasi TLS.
- [x] trust proxy tidak disetel true secara buta. Bukti: `src/config/env.ts`, `src/app.ts`, `tests/unit/env.test.ts`.
- [x] Timeout server, body limit, dan connection handling dikonfigurasi. Bukti: `src/server.ts` (requestTimeout 30 s, headersTimeout 15 s, keepAliveTimeout 5 s, graceful shutdown dengan batas waktu), body limit di `src/http/security.ts`, batas koneksi SSE (3 per akun/500 per proses) di `alert-stream.test.ts`.

## Ingest dan replay protection

- [x] 'event_id' dan 'external_session_id' unik; UUID dinormalisasi dan advisory lock melindungi ID baru. Bukti: `tests/integration/ingest.test.ts`.
- [x] Timestamp di luar +/-5 menit, termasuk replay duplikat, ditolak. Event sebelum sesi/event terakhir ditolak. Bukti: `tests/security/ingest-abuse.test.ts`.
- [x] Request duplikat idempotent; payload berbeda untuk ID sama ditolak, termasuk lintas sesi/stasiun. Bukti: tes ingest.
- [x] Simulator key hanya tersedia pada development/test; production dan MOBILE belum dibuka. Perbandingan digest constant-time. Bukti: `src/features/ingest/ingest-auth.ts`, tes ingest-abuse/env.
- [ ] Kredensial production tidak ditanam dalam mobile/frontend bundle. Ingest production sengaja belum dibuka (501, `ingest-auth.ts`) dan belum ada integrasi mobile; jaminan ini baru dapat dibuktikan setelah mekanisme token tepercaya ditetapkan.
- [x] Rate limit ingest 60/menit per sumber+IP dan log metadata tersedia; belum ada monitoring/alert operasional deployment. Bukti: tes ingest-abuse dan HTTP baseline. Store masih per proses.

## PII, logging, dan error

- [x] Nama/telepon terenkripsi AES-256-GCM, IV acak, AAD per record/field; snapshot alert dienkripsi terpisah. Bukti: `tests/unit/pii.test.ts`, tes ingest/alerts. Detail menyembunyikan PII berumur 7 hari; penghapusan fisik masih terbuka di bawah.
- [x] Password, cookie, token, secret, dan telepon lengkap diredaksi dari log HTTP dasar melalui metadata allowlist. Bukti: `src/http/request-context.ts`, `tests/security/http-baseline.test.ts`. Audit auth/stasiun/staff menyimpan action dan ID saja; tes reset sandi memeriksa tidak ada plaintext. Audit fitur berikutnya tetap perlu diverifikasi.
- [x] Error client generik; detail tersedia hanya pada log aman. Bukti: `src/http/error-handler.ts` (500 `INTERNAL_ERROR` generik), asersi "tidak ada prisma/constraint/stack" di `tests/integration/staff.test.ts`, log allowlist di `src/http/request-context.ts`.
- [x] PII dianonimkan setelah 7 hari. Bukti: `tests/integration/retention.test.ts` (purge snapshot alert, idempoten, alert tidak dihapus); detail alert menyembunyikan PII sesudah 7 hari (`alerts.test.ts`).
- [x] Alert dan audit log dihapus setelah 30 hari. Bukti: `tests/integration/retention.test.ts` memanggil `runRetention` pada database test terpisah.
- [ ] Statistik agregat tidak memungkinkan identifikasi ulang pengguna. Statistik berisi hitungan per stasiun per hari tanpa ID pengguna (`daily_usage_stats`), tetapi belum ada analisis ambang jumlah minimum untuk stasiun/hari berpenduduk kecil.

## Dependency dan release

- [x] Runtime Node dan Express berada pada versi maintained. Bukti: `engines` Node >=24 <25 dan image `node:24-bookworm-slim`; Express 5.3.0 (seri 5).
- [x] Lockfile dikomit. Bukti: `package-lock.json` terlacak Git; CI dan Dockerfile memakai `npm ci`.
- [ ] CI menjalankan lint, typecheck, unit, integration, Newman, dan dependency scan. `.github/workflows/ci.yml` menjalankan typecheck, tes, Newman, dan audit; tidak ada linter terpisah (typecheck strict dipakai sebagai pemeriksaan statis, keputusan 21 November). Dicentang setelah run pertama di GitHub hijau.
- [x] Temuan dependency ditriase berdasarkan versi, reachability, dan dampak. Bukti: `docs/dependency-audit.md` (pembaruan 21 November).
- [x] Tidak ada kerentanan runtime High/Critical relevan yang belum dimitigasi saat rilis. Bukti: `npm audit --omit=dev --omit=optional` = 0 temuan (flag instalasi image produksi); `effect`/`prisma` tidak ada di image runtime.
- [x] Production tidak menjalankan Node inspector atau insecure HTTP parser. Bukti: Dockerfile `CMD ["node", "dist/server.js"]` tanpa `--inspect`, tanpa `--insecure-http-parser`.
- [x] Seed, simulator, dan Swagger tidak terbuka tanpa perlindungan di production. Bukti: OpenAPI 404/tidak disajikan pada production (`openapi.test.ts`), ingest production 501 (`ingest-auth.ts`), seed menolak production (`seed.test.ts`), image runtime tanpa `scripts/` (diperiksa 21 November).

