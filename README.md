# Admin Dashboard Apps Commuter Line

Backend-only capstone untuk memantau penggunaan Camera Assist per stasiun dan mengelola alert kegagalan kamera oleh petugas keamanan.

Tahap saat ini: fondasi Express/TypeScript, PostgreSQL + Prisma, migration, seed demo, keamanan HTTP dasar, serta endpoint liveness/readiness sudah tersedia. Endpoint bisnis, autentikasi, dan alert belum diimplementasikan.

Collection Postman dan Environment lokal tersedia. Folder Health Check dapat diuji ke backend lokal; request bisnis masih draft. Lihat [panduan Postman](postman/README.md) dan [catatan progres](docs/progress.md).

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

## Database lokal

PostgreSQL 18 yang sudah terpasang dapat dipakai tanpa Docker. Helper membuat cluster khusus di `.local/postgres/data`, memakai port loopback `5434`, dan tidak memakai service/database proyek lain. `POSTGRES_BIN` dapat menunjuk folder binary PostgreSQL jika lokasi instalasi berbeda.

```powershell
npm run db:start
npm run prisma:migrate
npm run setup:demo
npm run prisma:seed
npm test
```

`db:start` dapat diulang; `db:status` memeriksa instance dan `db:stop` menghentikan instance milik repository ini. Sandi database berada di `.env`; sandi tiga akun demo di `.env.seed.local`. Kedua file diabaikan Git dan tidak dicetak ke terminal. Seed mengisi `superadmin`, `security.manggarai`, dan `security.tanahabang`, dengan kewajiban mengganti sandi saat alur auth tersedia. Seed ulang tidak mereset akun yang ada.

Alternatif Docker tetap tersedia melalui `docker compose up -d db` dengan PostgreSQL 17. Gunakan hanya satu penyedia database pada port 5434. Volume Docker dan data native terpisah; jalankan migration/seed masing-masing bila berpindah penyedia. Docker Desktop lokal saat ini bermasalah pada startup, jadi bukti integration test saat ini berasal dari PostgreSQL native 18.

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
- [Implementation plan](docs/superpowers/plans/2026-10-28-timetable-admin-backend-mvp.md)

## Batas scope

- Repository aplikasi Timetable milik dosen tidak diubah.
- Tahap pertama hanya mencakup backend, database, simulator, dokumentasi API, dan pengujian.
- Web dashboard dan integrasi mobile production dikerjakan pada tahap terpisah.
- Foto atau video kamera tidak diterima maupun disimpan.

