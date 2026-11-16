# Progress backend — 17 November 2026

## Ingest kamera dan REST alert: Tasks 6–7

Implementasi lokal berada pada branch `backend-camera-alerts`, melanjutkan auth/stasiun. Checkpoint C penuh belum selesai karena Task 8 (SSE) masih berikutnya.

- Simulator menerima sesi dengan stasiun aktif yang dikonfirmasi, serta lima jenis event kamera. Media/field tambahan, timestamp di luar +/-5 menit, event mundur, dan event baru sesudah sesi ditutup ditolak. Production/MOBILE belum diaktifkan.
- Key simulator diverifikasi constant-time, dengan batas 60 request/menit per sumber/IP. UUID dinormalisasi sebelum fingerprint HMAC dan advisory lock. ID sama dengan payload identik tidak menambah data/counter; payload berbeda menghasilkan 409, termasuk request paralel lintas sesi/stasiun.
- Gagal inisialisasi kamera membuat alert segera; tiga kegagalan analisis berturut-turut membuat satu alert. Recovery mereset counter tanpa menyelesaikan alert; SESSION_ENDED menutup sesi tanpa menutup alert. Satu sesi tetap maksimal satu alert.
- List/detail/claim/resolve menerapkan scope stasiun dari akun terkini. Klaim bersamaan menghasilkan satu handler; penyelesaian memerlukan handler/Super Admin dan catatan. Sesi dibaca ulang dalam transaksi untuk menolak akses yang sudah dicabut atau akun yang dipindahkan.
- Nama/telepon dienkripsi AES-256-GCM dengan IV acak dan AAD per record/field; snapshot alert dienkripsi terpisah. Daftar tidak memuat PII; detail menyembunyikan PII sesudah 7 hari. TTL 7/30 hari ditulis tetapi worker penghapusan fisik belum dibuat.
- Pembuatan, klaim, dan penyelesaian alert mencatat audit tanpa snapshot PII dalam transaksi yang sama. Belum ada panggilan/SMS atau tampilan dashboard real-time.
- Verifikasi: **59 tes pada 16 file lulus**, typecheck/build lulus. Newman kamera **22 request / 64 assertion**, regresi auth/stasiun **22 request / 55 assertion**. Collection **36 request / 44 script / 2 Environment**; 33 request tersedia, 3 analytics/audit masih draft. Seluruh kredensial/key pengujian acak hanya di memori dan fixture dibersihkan.
- API specification, threat model, checklist keamanan, test plan, README dan panduan Postman diselaraskan dengan implementasi. Tidak ada perubahan schema/migration baru pada tahap ini.

API source terbaru dijalankan secara native di `http://127.0.0.1:3002`, PostgreSQL proyek di port 5434. Default konfigurasi tetap 3000. Docker image tahap ini belum dibangun/dijalankan ulang. File Collection harus diimpor ulang ke aplikasi Postman; Environment private yang sudah diisi tetap dipertahankan.

## Checkpoint B: authentication, stasiun, dan petugas

Tasks 4-5 sudah diimplementasikan pada branch `backend-auth-stations`, setelah Checkpoint A digabung ke `main`. Tidak ada 2FA/PIN/OTP.

- Endpoint login username/sandi, profil, logout, dan ganti sandi tersedia. Argon2id dipakai bersama oleh seed dan akun baru. Cookie sesi opaque berumur absolut 8 jam; hanya HMAC sesi/CSRF disimpan di database.
- Login menerapkan limit 5 kegagalan username+IP dan 30 percobaan/IP per 15 menit. Store limit masih per proses untuk demo satu instance; restart menghapus counter.
- CSRF, flag cookie, sesi kedaluwarsa/dicabut, akun/stasiun nonaktif, dan kewajiban ganti sandi pertama diuji. Ganti sandi merotasi cookie/CSRF tanpa memperpanjang masa berlaku absolut sesi.
- Super Admin dapat membuat/mengubah stasiun, membuat/mengubah/menonaktifkan petugas, serta reset sandi. Client tidak dapat mengatur role/hash/flag internal. List memakai pagination maksimal 100 baris.
- Petugas hanya membaca stasiun penugasannya dari akun terkini; pemilihan scope melalui query dan semua endpoint pengelolaan ditolak. Pemindahan akun mencabut sesi tanpa menulis ulang stasiun riwayat alert.
- Penguncian transaksi mengikuti urutan stasiun -> akun -> sesi -> audit. Uji request bersamaan memeriksa login setelah reset/rename, logout saat ganti sandi, dan penonaktifan stasiun saat reset.
- Verifikasi lokal: **41 tes pada 10 file lulus**, TypeScript dan build lulus. Lima tes request bersamaan memakai barrier password/query serta observasi lock PostgreSQL; pengujian bukan hanya status HTTP.
- Audit login/logout, ganti sandi, serta mutasi stasiun/staff disimpan tanpa password/token. Endpoint pembacaan audit dan worker retensi belum tersedia.
- Collection diperbarui menjadi **36 request / 44 script / 2 Environment**: 20 request untuk endpoint tersedia, 16 request lanjutan masih draft. `npm run postman:admin` menjalankan **22 request HTTP nyata / 55 assertion** menggunakan fixture acak dan port loopback sementara, lalu membersihkannya. File Environment contoh tetap tanpa secret; akun demo tidak diubah oleh workflow.

Docker Desktop sedang dijeda pada saat pengembangan Checkpoint B. Pengujian memakai PostgreSQL native khusus proyek pada port 5434; image Docker Checkpoint B belum dibangun ulang. Build dan pengujian Docker pada catatan Checkpoint A di bawah adalah bukti untuk versi sebelumnya.

Untuk sesi pengembangan ini, API Checkpoint B dijalankan di `http://127.0.0.1:3002`. Port 3000 masih melayani proses versi sebelumnya. Environment lokal tanpa secret disiapkan di `.local/Checkpoint-B.postman_environment.json` (diabaikan Git); Collection di repo perlu diimpor ulang untuk menampilkan request baru. Port default pada contoh konfigurasi tetap 3000; port 3002 adalah override runtime sesi ini.

## Checkpoint A: fondasi, database, dan HTTP baseline

Task 1–3 sudah diimplementasikan dan diverifikasi secara lokal. Liveness/readiness dari Task 10 dimajukan agar koneksi API–database dapat diuji melalui Postman. Backend bisnis belum tersedia.

### Fondasi dan keamanan HTTP

- Express/TypeScript, konfigurasi environment Zod, CORS allowlist, Helmet/CSP, no-store, ID request dari server, dan error JSON aman.
- Batas JSON 32 KiB umum / 16 KiB ingest; logging hanya metadata allowlist.
- Timeout server dan graceful shutdown termasuk disconnect Prisma.
- `setup:local` menghasilkan secret acak tanpa mencetak atau menimpa nilai yang sudah ada.

### PostgreSQL dan Prisma

- Instance PostgreSQL **18.4 native**, khusus repository ini, telah diverifikasi pada 9 November di `127.0.0.1:5434`, database `timetable_admin`. Pengujian terkini pada 10 November menggunakan PostgreSQL Docker.
- Data berada di `.local/postgres/data`; tidak menggunakan service atau database proyek lain.
- Schema sembilan model, lima enum, index/unique/FK, serta migration `20261109112926_initial_schema` diterapkan ke database kosong.
- Constraint PostgreSQL memaksa role/stasiun konsisten, username lowercase, kode stasiun uppercase, counter non-negatif, serta field status alert konsisten.
- Prisma Client/CLI/adapter-pg memakai 7.10.1. Client dihasilkan dari schema, bukan dikomit.
- Seed dua stasiun dan tiga akun demo berulang menghasilkan ID yang sama dan mempertahankan sandi. Password di-hash Argon2id (64 MiB, 3 iterasi, paralelisme 1); akun ditandai wajib mengganti sandi.
- Sandi demo acak disimpan di `.env.seed.local`, bukan di repository.

### Health dan bukti

- `GET /health` / `GET /health/live`: 200, tanpa query database.
- `GET /health/ready`: query PostgreSQL nyata, 200 bila terhubung atau 503 `DATABASE_UNAVAILABLE` bila gagal.
- **20 tes** environment, HTTP, database, seed, dan readiness lulus.
- Typecheck dan build lulus; migration status up to date.
- Newman: **2 request, 7 assertion lulus** (health/readiness). Collection memiliki 28 request; 26 request bisnis lainnya masih draft.
- Uji gangguan nyata: instance database proyek dihentikan; liveness tetap 200, readiness 503 tanpa detail internal. Instance dinyalakan lagi dan Newman kembali lulus.
- Audit produksi: 0 temuan; 16 temuan development tetap terbuka. Lihat [triase dependency](dependency-audit.md).

## Penyesuaian desain dan pelaksanaan

Relasi alert ke sesi dibuat nullable dengan ON DELETE SET NULL. Referensi `source_session_id` unik mempertahankan asal sesi setelah sesi 7 hari dihapus, sehingga metadata alert dapat bertahan 30 hari. Worker retensi dan penghapusan snapshot PII belum diimplementasikan; perubahan FK sendiri tidak menghapus nama/telepon pada snapshot. Schema, migration, dokumen database, source Mermaid, PNG, dan SVG telah diselaraskan.

Kendala startup Docker Desktop pada `sailor-ingest.sock` terjadi pada 9 November. Pada 10 November, engine kembali dapat dihubungi dan container Linux berhasil dijalankan. Native PostgreSQL 18 tetap menjadi alternatif lokal; Compose PostgreSQL 17.11 memakai port host 5435, terpisah dari port native 5434.

`tsconfig.json` memeriksa source, tes, konfigurasi Prisma, dan seed. `tsconfig.build.json` membangun source ke `dist`. Environment dimuat melalui fasilitas native Node. Script seed/simulator/retensi hanya ditambahkan saat implementasinya tersedia.

## Docker dan Postman terverifikasi pada 10 November

Dockerfile multi-stage kini memasang OpenSSL/CA certificates pada tahap build/migration agar Prisma CLI sesuai dengan Linux. Dua image berhasil dibangun; service database dan API Healthy, migration Exited (0). Port host tetap `3001`/`5435`. Suite 20 tes lulus terhadap PostgreSQL Docker; Newman meluluskan 2 request / 7 assertion. Pemeriksaan runtime membuktikan non-root, root filesystem read-only, Argon2id berfungsi, sembilan model dapat dibaca, serta file secret/tooling development tidak ada pada filesystem API.

Respons readiness 200 OK juga terlihat langsung di aplikasi Postman. File Environment Docker khusus disediakan dengan secret kosong; request GUI dibiarkan terbuka sebagai tab belum disimpan. Bukti dan perintah ada di [panduan Docker](docker.md). Bagian packaging dari Task 12 terverifikasi; CI, alur bisnis, seed Docker, dan release gate penuh belum selesai.

## Berikutnya

- Task 8: SSE untuk notifikasi alert sesuai stasiun, tanpa PII dan dengan revokasi koneksi saat sesi/akses dicabut.
- Task 9: analytics, pembacaan audit, dan worker retensi 7/30 hari.
- Tasks 10-12: CLI simulator/OpenAPI, acceptance penuh, CI dan release gate.

Endpoint ingest simulator dan REST alert tersedia secara lokal; integrasi aplikasi mobile belum dibuka. Repository Timetable milik dosen tidak diubah. Checkpoint A sudah digabung dan dipush ke `main` pada merge `0f8e21a`; perubahan auth dan kamera/alert berikutnya masih lokal sampai ada instruksi push.

Lihat [README](../README.md) untuk perintah setup, serta [implementation plan](superpowers/plans/2026-10-28-timetable-admin-backend-mvp.md).
