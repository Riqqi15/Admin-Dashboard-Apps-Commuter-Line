# Admin Dashboard Apps Commuter Line

Backend-only capstone untuk memantau penggunaan Camera Assist per stasiun dan mengelola alert kegagalan kamera oleh petugas keamanan.

Tahap saat ini: fondasi Express/TypeScript, validasi environment, keamanan HTTP dasar, dan endpoint liveness sudah tersedia. Endpoint bisnis, koneksi database, autentikasi, dan alert belum diimplementasikan.

Collection Postman dan Environment lokal tersedia. Folder Health Check dapat diuji ke backend lokal; request bisnis masih draft. Lihat [panduan Postman](postman/README.md) dan [catatan progres](docs/progress.md).

## Menjalankan lokal

Gunakan Node.js 24. Dari folder repository:

```powershell
npm ci
npm run setup:local
npm run dev
```

`setup:local` menghasilkan `.env` berisi secret acak dan tidak menimpa file yang sudah ada. API default hanya mendengarkan `127.0.0.1:3000`. Database belum diperlukan untuk liveness.

Di terminal lain, jalankan `npm run postman:health`, atau impor file JSON lalu kirim `GET http://127.0.0.1:3000/health` melalui Postman. Respons:

```json
{"success":true,"data":{"status":"ok"}}
```

`/health/live` menyediakan respons yang sama. Ini membuktikan proses API hidup; bukan kesiapan database. Readiness database akan ditambahkan setelah integrasi Prisma.

Untuk pemeriksaan kode: `npm test`, `npm run typecheck`, dan `npm run build`. Untuk menjalankan hasil build: `npm start`.

## Database lokal

Compose disiapkan terpisah sebagai project `timetable-admin-capstone`, port loopback `5434`, dan volume `admin_db_data`. Setelah Docker engine aktif, jalankan `docker compose up -d db`. Migration dan seed belum tersedia; jangan memakai database aplikasi Timetable untuk backend ini.

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

