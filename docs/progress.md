# Progress backend — 9 November 2026

## Tersedia dan sudah diverifikasi

- Fondasi Express + TypeScript; `createApp` terpisah dari listener agar dapat diuji.
- Environment divalidasi dengan Zod; konfigurasi production menolak origin localhost/non-HTTPS, proxy yang belum ditentukan, dan key simulator.
- `.env` lokal dihasilkan oleh `npm run setup:local` dengan secret acak, tidak dicetak ke log, dan tidak ditimpa saat perintah diulang.
- `GET /health` dan `GET /health/live`: HTTP 200, JSON `{ "success": true, "data": { "status": "ok" } }`. Keduanya liveness tanpa query database.
- Header Helmet/CSP untuk API, no-store, ID request dari server, origin allowlist dengan credentials, dan error JSON aman.
- Parser JSON memilih batas 32 KiB umum atau 16 KiB ingest; kompresi request tidak diterima.
- Log HTTP hanya memuat metadata allowlist; URL, query, body, headers, dan teks error internal tidak dicatat.
- Timeout request/header, penanganan kegagalan listener, dan shutdown bertenggat tersedia pada server.
- 12 tes environment dan HTTP lulus; typecheck dan build lulus.
- Newman mengirim request `/health` ke server lokal: 1 request dan 4 assertion lulus. Ini bukan hasil untuk 26 request bisnis lainnya.
- Compose database terpisah berhasil melewati `docker compose config --quiet`.
- Prisma CLI/Client sudah selaras pada 7.10.1. Audit produksi melaporkan 0 vulnerability; 16 temuan development masih terbuka. Lihat [triase dependency](dependency-audit.md).

## Kendala database

Docker Desktop berjalan sebagai proses, tetapi engine Linux tidak tersedia. `docker version` gagal mengakses pipe `dockerDesktopLinuxEngine`. Log backend Docker menunjukkan kegagalan startup:

```text
starting services: initializing Ingest server ... sailor-ingest.sock:
The file cannot be accessed by the system.
```

Compose hanya tervalidasi secara konfigurasi; PostgreSQL belum dinyalakan. Tidak dilakukan factory reset, penghapusan socket/volume, atau perubahan terhadap proyek lain. Docker Desktop perlu dipulihkan sebelum migration dan integration test PostgreSQL dapat dilanjutkan.

## Belum dikerjakan

- Schema/migration/seed Prisma dan koneksi PostgreSQL (Task 2).
- Login username/sandi, cookie session, CSRF dan rate limit login (Task 4).
- RBAC dan isolasi stasiun (Task 5).
- Ingest kamera, lifecycle alert, SSE, analytics, audit, retensi dan OpenAPI (Tasks 6–10).
- Acceptance suite Postman lengkap dan release gate (Tasks 11–12).

Task 1 dan baseline HTTP Task 3 dikerjakan terlebih dahulu karena tidak memerlukan database. Checkpoint A belum lengkap sampai Task 2 terverifikasi. Keamanan HTTP dasar tidak menggantikan autentikasi/otorisasi yang masih akan dibuat.

Penyesuaian teknis dari contoh rencana: `tsconfig.json` memeriksa source dan tes dengan root `.`; `tsconfig.build.json` hanya membangun source ke `dist` agar entrypoint tetap `dist/server.js`. Script untuk seed/simulator/retensi belum ditambahkan sampai implementasinya tersedia. `.env` dimuat memakai flag native Node, sehingga dependency dotenv tidak diperlukan.

## Cara melanjutkan

1. Pulihkan Docker Desktop hingga `docker version` menampilkan bagian Server.
2. Jalankan `docker compose up -d db` pada repository ini; verifikasi database sehat pada port lokal 5434.
3. Pastikan Prisma CLI dan Client memakai versi kompatibel; lanjut schema, constraint role/stasiun, migration, seed, dan tes koneksi sesuai rencana.
4. Lanjut autentikasi dan batas akses stasiun sebelum membuka endpoint data pengguna.

Petunjuk menjalankan API lokal ada di [README](../README.md). Rencana lengkap ada di [implementation plan](superpowers/plans/2026-10-28-timetable-admin-backend-mvp.md).
