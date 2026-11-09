# Docker backend lokal

## Status verifikasi

Pada **10 November 2026**, Docker Engine 29.7.2 berhasil dihubungi dan build/run container Linux telah diverifikasi. `docker compose config --quiet` lulus.

Hasil aktual:

- `npm run docker:build` berhasil membuat image API dan migration.
- Build awal memperingatkan OpenSSL belum tersedia untuk Prisma CLI. Dockerfile diperbaiki dengan memasang OpenSSL dan CA certificates sebelum instalasi dependency build/migration; build ulang berhasil tanpa peringatan tersebut.
- PostgreSQL 17.11 pada service `db` berstatus Healthy; migration `20261109112926_initial_schema` berhasil dan service `migrate` keluar dengan kode 0.
- API berstatus Healthy di `http://127.0.0.1:3001` dan tetap memakai user non-root serta root filesystem read-only.
- `npm run postman:docker`: **2 request / 7 assertion lulus** pada endpoint health/readiness.
- `npm run test:docker`: **20 tes lulus** dengan integration test menuju PostgreSQL Docker port 5435. Fixture memakai rollback dan hanya diizinkan untuk database lokal `timetable_admin`.
- `node scripts/check-docker-runtime.cjs`: sembilan model dapat dibaca; Argon2id berfungsi di Linux; filesystem API tidak memuat file secret maupun tooling dev/test; non-root dan root filesystem read-only terverifikasi.
- Request `GET http://127.0.0.1:3001/health/ready` juga dikirim langsung melalui aplikasi Postman dan menampilkan 200 OK, `status=ready`, `database=connected`.

Pemeriksaan host Windows sebelumnya juga lulus, tetapi bukti di atas berasal dari container Linux yang benar-benar berjalan. Endpoint bisnis, seed demo Docker, dan release gate penuh belum selesai.

## Yang disiapkan

- `Dockerfile`: tahap dependency/build, image migration terpisah, dan runtime API sebagai user non-root `node`.
- Runtime memakai dependency produksi saja. Prisma Client di-generate di build; CLI/test tooling tidak dipasang pada runtime API.
- `.dockerignore` memakai allowlist. `.env`, `.env.seed.local`, `.local`, data database, node_modules host, Git history, dan Postman tidak masuk context build.
- Build tidak memerlukan database aktif atau secret nyata. URL dummy hanya dipakai saat generate Prisma Client.
- Healthcheck runtime memanggil `/health/ready`; startup Compose menunggu PostgreSQL sehat dan migration selesai.
- API memakai filesystem read-only, tmpfs untuk `/tmp`, capability drop, dan no-new-privileges pada Compose.
- `NODE_ENV` image default production; Compose lokal secara eksplisit memakai development. Tidak ada seed/simulator yang dijalankan saat startup.

Dasar konfigurasi: [panduan Node.js Docker](https://docs.docker.com/guides/nodejs/) dan [Prisma 7 migrate deploy](https://www.prisma.io/docs/cli/v7/migrate/deploy).

## Menjalankan Docker lokal

Di root repository:

```powershell
npm run setup:local
npm run docker:config
npm run docker:build
npm run docker:up
```

`docker:up` membangun bila diperlukan, menyalakan database, menerapkan migration melalui service one-shot, lalu menyalakan API. `docker:build` sendiri hanya membangun image; tidak menjalankan migration atau container.

Port default berbeda dari proses native agar dapat hidup berdampingan:

| Layanan | Native | Docker di host | Di network Compose |
|---|---|---|---|
| API | `127.0.0.1:3000` | `127.0.0.1:3001` | `api:3000` |
| PostgreSQL | `127.0.0.1:5434` | `127.0.0.1:5435` | `db:5432` |

Override port melalui `DOCKER_API_PORT` / `DOCKER_DB_PORT` bila diperlukan. URL database API container selalu menunjuk hostname `db`, bukan localhost host Windows.

Uji melalui Postman: impor Collection dan `postman/Docker.postman_environment.json`, pilih **Timetable Admin — Docker Example**, lalu jalankan Health Check dan Database Readiness. Alternatif terminal:

```powershell
npm run postman:docker
npm run test:docker
node scripts/check-docker-runtime.cjs
```

Lihat status dengan `docker compose ps -a`, log dengan `npm run docker:logs`, dan hentikan dengan `npm run docker:down`. Perintah down ini tidak memakai `-v`, sehingga named volume database dipertahankan.

Database Docker dan native memiliki data berbeda. Akun demo yang sudah dibuat pada native tidak otomatis ada di Docker. Endpoint login, RBAC, ingest, dan alert masih akan diimplementasikan; pengujian Docker tahap ini menargetkan health/readiness saja. Prosedur seed Docker untuk alur bisnis ditambahkan bersama pengujian autentikasi.

`test:docker` saat ini membatasi port database ke default 5435 untuk menjaga target fixture tetap spesifik. Pengubahan port Compose memerlukan penyesuaian target pengujian yang ditinjau terlebih dahulu.

## Riwayat kendala startup Docker Desktop

Pada 9 November 2026, gejala lokal dan screenshot pengguna menunjukkan:

```text
initializing Ingest server ... sailor-ingest.sock:
The file cannot be accessed by the system.
```

Metadata read-only menunjukkan objek tersebut berukuran 0 byte dengan atribut `ReparsePoint`. Ini belum membuktikan penyebab awal kerusakannya. Kegagalan sejenis juga dilaporkan pada [issue Docker Desktop](https://github.com/docker/desktop-feedback/issues/675).

Pada 10 November, setelah pengguna membuka kembali Docker Desktop, bagian Server tersedia dan build/run berhasil. Tidak diasumsikan tindakan pemulihan spesifik yang dilakukan pengguna. Agen tidak melakukan factory reset, menghapus socket, mengubah ACL, menghentikan WSL global, atau menghapus volume. Bila kendala muncul kembali, gunakan [troubleshooting Docker Desktop](https://docs.docker.com/desktop/troubleshoot-and-support/troubleshoot/) dengan menjaga data yang sudah ada.

Audit/release gate penuh belum selesai; detail dependency development yang masih terbuka ada di [dependency-audit](dependency-audit.md). Image dan Compose ini belum dinyatakan siap deployment publik.
