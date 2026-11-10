# Admin Dashboard Apps Commuter Line

Backend-only capstone untuk memantau penggunaan Camera Assist per stasiun dan mengelola alert kegagalan kamera oleh petugas keamanan.

Tahap saat ini: fondasi Express/TypeScript, PostgreSQL + Prisma, migration, seed demo, keamanan HTTP, liveness/readiness, login username/sandi, sesi cookie, serta pengelolaan stasiun dan petugas sudah tersedia. Petugas hanya dapat membaca stasiun penugasannya. Ingest kamera, alert, SSE, analytics, dan endpoint audit masih menunggu implementasi.

Collection Postman dan Environment lokal tersedia: 20 request untuk endpoint yang sudah tersedia dan 16 request lanjutan yang masih draft. Workflow otomatis Checkpoint B menjalankan 22 request nyata menggunakan fixture terisolasi. Lihat [panduan Postman](postman/README.md) dan [catatan progres](docs/progress.md).

## Menjalankan lokal

Gunakan Node.js 24. Dari folder repository:

```powershell
npm ci
npm run setup:local
npm run prisma:generate
npm run dev
```

`setup:local` menghasilkan `.env` berisi secret acak dan tidak menimpa file yang sudah ada. API default hanya mendengarkan `127.0.0.1:3000`. Database belum diperlukan untuk liveness.

Di terminal lain, jalankan `npm run postman:health`, atau impor file JSON lalu kirim `GET http://127.0.0.1:3000/health` melalui Postman. Respons:

```json
{"success":true,"data":{"status":"ok"}}
```

`/health/live` menyediakan respons yang sama. `/health/ready` menguji koneksi PostgreSQL: HTTP 200 dengan `data.status=ready` bila terhubung, atau HTTP 503 tanpa detail internal bila database tidak tersedia.

Untuk pemeriksaan kode: `npm test`, `npm run typecheck`, dan `npm run build`. Untuk menjalankan hasil build: `npm start`.

Setelah database dan migration siap, jalankan `npm run postman:admin` untuk menguji login, ganti sandi, pengelolaan stasiun/petugas, reset sandi, akses stasiun sendiri, penolakan perubahan scope, dan logout. Perintah ini membangun source terbaru, membuka server loopback pada port sementara, memakai kredensial acak hanya di memori, lalu membersihkan akun/stasiun/sesi fixture. Akun demo tidak diubah. Docker tidak diperlukan untuk workflow ini bila PostgreSQL native sudah aktif.

## Database lokal

PostgreSQL 18 yang sudah terpasang dapat dipakai tanpa Docker. Helper membuat cluster khusus di `.local/postgres/data`, memakai port loopback `5434`, dan tidak memakai service/database proyek lain. `POSTGRES_BIN` dapat menunjuk folder binary PostgreSQL jika lokasi instalasi berbeda.

```powershell
npm run db:start
npm run prisma:migrate
npm run setup:demo
npm run prisma:seed
npm test
```

`db:start` dapat diulang; `db:status` memeriksa instance dan `db:stop` menghentikan instance milik repository ini. Sandi database berada di `.env`; sandi awal tiga akun demo di `.env.seed.local`. Kedua file diabaikan Git dan tidak dicetak ke terminal. Seed mengisi `superadmin`, `security.manggarai`, dan `security.tanahabang`. Setelah login pertama, akun wajib memakai endpoint ganti sandi sebelum membuka endpoint bisnis; profil dan logout tetap tersedia. Seed ulang tidak mereset akun yang ada. Sandi yang sudah diganti tidak otomatis disalin kembali ke file seed.

Alternatif Docker menyediakan API + migration + PostgreSQL 17. Port host default Docker adalah API `3001` dan database `5435`, sehingga berbeda dari native `3000`/`5434`. Volume Docker dan data native terpisah. Pada 10 November 2026, build image, migration, API health/readiness, serta 20 tes terhadap database Docker sudah lulus. Lihat [panduan Docker](docs/docker.md).

Jalankan `npm run docker:build` lalu `npm run docker:up`. Uji Docker API di `http://127.0.0.1:3001/health/ready`, atau jalankan `npm run postman:docker`. `npm run test:docker` menjalankan suite tes terhadap database Docker, sedangkan `node scripts/check-docker-runtime.cjs` memeriksa runtime Linux dan pemisahan tooling/secret.

## Dokumentasi

- [PRD](docs/prd.md)
- [Arsitektur](docs/architecture.md)
- [Database design](docs/database-design.md)
- [ERD visual](docs/database-design-visual.md)
- [API specification](docs/api-specification.md)
- [Threat model](docs/timetable-admin-backend-threat-model.md)
- [Security checklist](docs/security-checklist.md)
- [Test plan](docs/test-plan.md)
- [Collection dan panduan Postman](postman/README.md)
- [Docker build dan deployment lokal](docs/docker.md)
- [Implementation plan](docs/superpowers/plans/2026-10-28-timetable-admin-backend-mvp.md)

## Batas scope

- Repository aplikasi Timetable milik dosen tidak diubah.
- Tahap pertama hanya mencakup backend, database, simulator, dokumentasi API, dan pengujian.
- Web dashboard dan integrasi mobile production dikerjakan pada tahap terpisah.
- Foto atau video kamera tidak diterima maupun disimpan.

