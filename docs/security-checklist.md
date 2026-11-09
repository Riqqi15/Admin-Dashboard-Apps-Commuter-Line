# Security Checklist

Checklist ini wajib dibuktikan melalui kode, konfigurasi, dan test. CVE adalah identitas kerentanan; CVSS adalah skor keparahan, bukan sesuatu yang dapat dijamin tidak pernah muncul.

## Desain

- [ ] Trust boundary, aset, dan abuse path sudah diperbarui pada threat model.
- [ ] Semua endpoint mempunyai definisi autentikasi, role, dan station scope.
- [ ] Tidak ada endpoint upload gambar/video.
- [ ] Data sensitif mempunyai retensi dan mekanisme anonimisasi.
- [ ] Secret development dan production dipisahkan.

## Authentication dan session

- [ ] Password di-hash dengan Argon2id dan parameter yang ditinjau.
- [ ] Username dinormalisasi dan unik.
- [ ] Login dibatasi per IP dan username+IP.
- [ ] Session token acak, disimpan sebagai hash, dan dirotasi setelah login.
- [ ] Cookie HttpOnly, SameSite, dan Secure pada production.
- [ ] Logout, reset password, serta deaktivasi akun mencabut sesi.
- [ ] Error login tidak membedakan username valid/tidak valid.

## Authorization

- [ ] Pemeriksaan role dilakukan pada backend.
- [ ] Filter 'station_id' diterapkan pada service/query, bukan hanya controller/UI.
- [ ] Petugas tidak dapat memilih station scope melalui query parameter.
- [ ] SSE difilter berdasarkan role dan stasiun.
- [ ] Test IDOR/BOLA mencakup read dan write lintas stasiun.
- [ ] Acknowledge alert atomik dan mencegah double assignment.

## Input, output, dan injection

- [ ] Semua body, params, query, dan header penting divalidasi dengan schema ketat.
- [ ] Field tak dikenal ditolak pada endpoint sensitif.
- [ ] Ukuran body, panjang string, rentang tanggal, dan pagination dibatasi.
- [ ] Tidak ada raw SQL dari input pengguna.
- [ ] Tidak ada eval, shell command, arbitrary URL fetch, atau unsafe redirect.
- [ ] Response dan SSE tidak mengirim HTML mentah.

## CSRF, CORS, dan HTTP

- [ ] Mutasi berbasis cookie memakai CSRF token dan pemeriksaan Origin.
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
- [x] Password, cookie, token, secret, dan telepon lengkap diredaksi dari log HTTP dasar melalui metadata allowlist. Bukti: `src/http/request-context.ts`, `tests/security/http-baseline.test.ts`. Audit/domain logging belum tersedia dan tetap perlu diverifikasi ketika dibuat.
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

