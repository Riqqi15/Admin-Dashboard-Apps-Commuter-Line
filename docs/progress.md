# Progress backend — 10 November 2026

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

- Task 4: login username/sandi, sesi cookie, CSRF, rate limit, ganti sandi, dan revokasi sesi.
- Task 5: manajemen stasiun/staff dan pengujian isolasi stasiun (Checkpoint B).
- Tasks 6–12: ingest, alert, SSE, analytics/audit/retensi, simulator/OpenAPI, acceptance penuh, CI dan release gate.

Tidak ada endpoint data pengguna yang dibuka pada tahap ini. Repository Timetable milik dosen tidak diubah. Progres sampai commit `3db0258` sudah dipush ke branch `codex/backend-foundation`; perubahan Docker sesudahnya masih lokal.

Lihat [README](../README.md) untuk perintah setup, serta [implementation plan](superpowers/plans/2026-10-28-timetable-admin-backend-mvp.md).
