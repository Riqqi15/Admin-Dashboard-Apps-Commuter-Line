# Security Checklist

Checklist ini wajib dibuktikan melalui kode, konfigurasi, dan test. CVE adalah identitas kerentanan; CVSS adalah skor keparahan, bukan sesuatu yang dapat dijamin tidak pernah muncul.

## Desain

- [ ] Trust boundary, aset, dan abuse path sudah diperbarui pada threat model.
- [ ] Semua endpoint mempunyai definisi autentikasi, role, dan station scope.
- [ ] Tidak ada endpoint upload gambar/video.
- [ ] Data sensitif mempunyai retensi dan mekanisme anonimisasi.
- [ ] Secret development dan production dipisahkan.

## Authentication dan session

- [x] Password di-hash dengan Argon2id (64 MiB, 3 iterasi, paralelisme 1). Bukti: `src/lib/password.ts`, tes seed/auth/staff.
- [x] Username dinormalisasi dan unik. Bukti: schema Zod, constraint PostgreSQL, tes auth/staff.
- [x] Login dibatasi per IP dan username+IP. Bukti: `tests/security/auth-abuse.test.ts`; MemoryStore masih untuk satu proses, bukan limit terdistribusi.
- [x] Session token acak, hanya HMAC disimpan, token baru pada login dan ganti sandi. Bukti: `tests/integration/auth.test.ts`.
- [x] Cookie HttpOnly, SameSite=Strict, dan Secure pada production. Bukti: tes auth.
- [x] Logout, reset password, serta deaktivasi akun/stasiun mencabut sesi. Bukti: tes auth/staff dan `tests/security/auth-races.test.ts`.
- [x] Error login tidak membedakan username valid/tidak valid. Bukti: tes auth.

## Authorization

Bukti database: constraint `admin_users_role_station_check` mencegah akun petugas tanpa satu stasiun atau Super Admin dengan stasiun. Checkpoint B menambah pemeriksaan role, kewajiban ganti sandi sementara, scope pada query stasiun, serta penolakan endpoint pengelolaan untuk petugas (`tests/security/station-bola.test.ts`). Cakupan alert/SSE tetap terbuka sampai endpoint tersebut dibuat.

- [x] Pemeriksaan role dilakukan pada backend untuk route stasiun/staff yang sudah tersedia.
- [x] Scope akun terkini diterapkan pada query daftar stasiun melalui `stationScope`; route bisnis berikutnya tetap harus memakai scope serupa.
- [x] Petugas tidak dapat memilih station scope melalui query parameter pada endpoint stasiun.
- [ ] SSE difilter berdasarkan role dan stasiun.
- [ ] Test IDOR/BOLA mencakup read dan write lintas stasiun.
- [ ] Acknowledge alert atomik dan mencegah double assignment.

## Input, output, dan injection

- [ ] Semua body, params, query, dan header penting divalidasi dengan schema ketat.
- [x] Field tak dikenal ditolak pada schema login/ganti sandi, pembuatan/perubahan stasiun/staff dan reset sandi; pengujian mencakup mass assignment.
- [ ] Ukuran body, panjang string, rentang tanggal, dan pagination dibatasi.
- [ ] Tidak ada raw SQL dari input pengguna.
- [ ] Tidak ada eval, shell command, arbitrary URL fetch, atau unsafe redirect.
- [ ] Response dan SSE tidak mengirim HTML mentah.

## CSRF, CORS, dan HTTP

- [x] Mutasi berbasis cookie yang tersedia memakai token CSRF sesi dan pemeriksaan Origin/Sec-Fetch-Site. Bukti: `tests/security/auth-abuse.test.ts` dan `station-bola.test.ts`.
- [x] CORS memakai allowlist tanpa wildcard credentials. Bukti: `src/http/security.ts`, `tests/security/http-baseline.test.ts`.
- [ ] Helmet dan CSP disetel sesuai deployment.
- [x] Header x-powered-by dinonaktifkan. Bukti: `src/app.ts`, `tests/security/http-baseline.test.ts`.
- [ ] Production memakai HTTPS.
- [x] trust proxy tidak disetel true secara buta. Bukti: `src/config/env.ts`, `src/app.ts`, `tests/unit/env.test.ts`.
- [ ] Timeout server, body limit, dan connection handling dikonfigurasi.

## Ingest dan replay protection

- [ ] 'event_id' dan 'external_session_id' unik.
- [ ] Timestamp lama/terlalu jauh di masa depan ditolak.
- [ ] Request duplikat idempotent; payload berbeda untuk ID sama ditolak.
- [ ] Simulator key hanya tersedia pada development.
- [ ] Kredensial production tidak ditanam dalam mobile/frontend bundle.
- [ ] Rate limit dan monitoring diterapkan pada ingest.

## PII, logging, dan error

- [ ] Nama dan telepon dienkripsi pada penyimpanan.
- [x] Password, cookie, token, secret, dan telepon lengkap diredaksi dari log HTTP dasar melalui metadata allowlist. Bukti: `src/http/request-context.ts`, `tests/security/http-baseline.test.ts`. Audit auth/stasiun/staff menyimpan action dan ID saja; tes reset sandi memeriksa tidak ada plaintext. Audit fitur berikutnya tetap perlu diverifikasi.
- [ ] Error client generik; detail tersedia hanya pada log aman.
- [ ] PII dianonimkan setelah 7 hari.
- [ ] Alert dan audit log dihapus setelah 30 hari.
- [ ] Statistik agregat tidak memungkinkan identifikasi ulang pengguna.

## Dependency dan release

- [ ] Runtime Node dan Express berada pada versi maintained.
- [ ] Lockfile dikomit.
- [ ] CI menjalankan lint, typecheck, unit, integration, Newman, dan dependency scan.
- [ ] Temuan dependency ditriase berdasarkan versi, reachability, dan dampak.
- [ ] Tidak ada kerentanan runtime High/Critical relevan yang belum dimitigasi saat rilis.
- [ ] Production tidak menjalankan Node inspector atau insecure HTTP parser.
- [ ] Seed, simulator, dan Swagger tidak terbuka tanpa perlindungan di production.

