# Docker backend lokal

## Status verifikasi

Dockerfile, context allowlist, dan Compose API + migration + PostgreSQL sudah disiapkan. `docker compose config --quiet` lulus.

**Build image belum berhasil dijalankan.** Docker Desktop gagal startup pada `sailor-ingest.sock`; `docker compose build api migrate` berhenti karena pipe engine `dockerDesktopLinuxEngine` tidak tersedia. Ini terjadi sebelum proses build image dapat berjalan.

Pemeriksaan tambahan pada host Windows: install bersih dengan `npm ci --omit=dev --omit=optional` memasang dependency produksi tanpa Prisma CLI, TypeScript, tsx, Newman, Vitest, atau Supertest. Hasil build aplikasi dapat menjalankan readiness terhadap PostgreSQL menggunakan dependency tersebut, tanpa fallback ke dependency development proyek. Ini bukan pengganti build/run container Linux; kompatibilitas image tetap perlu dibuktikan setelah engine pulih.

## Yang disiapkan

- `Dockerfile`: tahap dependency/build, image migration terpisah, dan runtime API sebagai user non-root `node`.
- Runtime memakai dependency produksi saja. Prisma Client di-generate di build; CLI/test tooling tidak dipasang pada runtime API.
- `.dockerignore` memakai allowlist. `.env`, `.env.seed.local`, `.local`, data database, node_modules host, Git history, dan Postman tidak masuk context build.
- Build tidak memerlukan database aktif atau secret nyata. URL dummy hanya dipakai saat generate Prisma Client.
- Healthcheck runtime memanggil `/health/ready`; startup Compose menunggu PostgreSQL sehat dan migration selesai.
- API memakai filesystem read-only, tmpfs untuk `/tmp`, capability drop, dan no-new-privileges pada Compose.
- `NODE_ENV` image default production; Compose lokal secara eksplisit memakai development. Tidak ada seed/simulator yang dijalankan saat startup.

Dasar konfigurasi: [panduan Node.js Docker](https://docs.docker.com/guides/nodejs/) dan [Prisma 7 migrate deploy](https://www.prisma.io/docs/cli/v7/migrate/deploy).

## Menjalankan setelah Docker engine pulih

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

Uji melalui Postman: isi `baseUrl` dengan `http://127.0.0.1:3001`, lalu jalankan Health Check dan Database Readiness. Alternatif terminal:

```powershell
$env:API_BASE_URL = 'http://127.0.0.1:3001'
npm run postman:health
Remove-Item Env:API_BASE_URL
```

Lihat status dengan `docker compose ps -a`, log dengan `npm run docker:logs`, dan hentikan dengan `npm run docker:down`. Perintah down ini tidak memakai `-v`, sehingga named volume database dipertahankan.

Database Docker dan native memiliki data berbeda. Akun demo yang sudah dibuat pada native tidak otomatis ada di Docker. Endpoint login, RBAC, ingest, dan alert masih akan diimplementasikan; pengujian Docker tahap ini menargetkan health/readiness saja. Prosedur seed Docker untuk alur bisnis ditambahkan bersama pengujian autentikasi.

## Docker Desktop gagal startup

Gejala lokal dan screenshot pengguna:

```text
initializing Ingest server ... sailor-ingest.sock:
The file cannot be accessed by the system.
```

Metadata read-only menunjukkan objek tersebut berukuran 0 byte dengan atribut `ReparsePoint`. Ini belum membuktikan penyebab awal kerusakannya. Kegagalan sejenis juga dilaporkan pada [issue Docker Desktop](https://github.com/docker/desktop-feedback/issues/675).

Tidak dilakukan factory reset, penghapusan socket, perubahan ACL, penghentian WSL global, atau penghapusan volume. Setelah menyimpan pekerjaan, pengguna dapat mencoba Quit lalu restart Windows dan membuka kembali Docker Desktop. Restart Windows belum dilakukan dan tidak dijamin memperbaiki error. Cek `docker version`: bagian Server harus tersedia sebelum build diulang. Jika tetap gagal, lanjutkan diagnosis/pemulihan Docker dengan menjaga data yang sudah ada; panduan resmi ada di [troubleshooting Docker Desktop](https://docs.docker.com/desktop/troubleshoot-and-support/troubleshoot/).

Audit/release gate penuh belum selesai; detail dependency development yang masih terbuka ada di [dependency-audit](dependency-audit.md). Image dan Compose ini belum dinyatakan siap deployment publik.
