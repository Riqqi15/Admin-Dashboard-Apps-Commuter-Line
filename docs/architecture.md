# Arsitektur Timetable Admin Backend

## 1. Komponen

- **API Server:** Express + TypeScript untuk REST, autentikasi, RBAC, SSE, validasi, dan business rules.
- **PostgreSQL:** menyimpan akun dashboard, stasiun, referensi pengguna, sesi, event, alert, statistik, dan audit.
- **Prisma:** schema, migration, serta query terparameterisasi.
- **Cleanup worker:** proses harian untuk retensi dan anonimisasi.
- **Simulator:** alat development untuk mengirim sesi serta event tanpa aplikasi mobile.
- **Postman/Newman:** pengujian black-box dan acceptance flow.
- **Future mobile integration:** client eksternal yang mengirim event sesuai kontrak API; tidak dibangun pada fase pertama.

## 2. Struktur repository yang direncanakan

~~~text
Timetable-admin-backend/
├── src/
│   ├── config/
│   ├── domain/
│   ├── middleware/
│   ├── routes/
│   ├── services/
│   └── workers/
├── prisma/
├── tests/
├── postman/
├── scripts/
├── docs/
└── docker-compose.yml
~~~

## 3. Data flow utama

~~~mermaid
flowchart LR
    C["Simulator or future mobile"] -->|HTTPS events| A["Express API"]
    D["Admin client"] -->|HTTPS REST and SSE| A
    A -->|Prisma queries| P["PostgreSQL"]
    W["Cleanup worker"] -->|Retention jobs| P
    T["Postman and Newman"] -->|HTTPS tests| A
~~~

1. Client mengirim sesi dengan pengguna dan stasiun terkonfirmasi.
2. API memvalidasi schema, autentikasi ingest, timestamp, dan idempotency key.
3. Event kegagalan disimpan dalam transaksi.
4. 'CAMERA_INIT_FAILED' membuat alert segera.
5. Tiga 'ANALYSIS_FAILED' berturut-turut tanpa 'ANALYSIS_RECOVERED' membuat satu alert.
6. Alert disimpan sebelum event SSE diterbitkan.
7. Admin client mengambil state terbaru melalui REST setelah reconnect SSE.

## 4. Autentikasi dan otorisasi

- Admin menggunakan sesi opaque pada cookie HttpOnly.
- Server menyimpan hash token sesi, bukan token mentah.
- Request perubahan state membutuhkan CSRF token dan origin yang diizinkan.
- Middleware role menentukan akses Super Admin atau Petugas Stasiun.
- Service layer selalu menambahkan filter 'station_id' bagi Petugas Stasiun.
- Acknowledge alert dilakukan secara atomik dengan kondisi 'status = NEW'.

## 5. SSE

- Event: 'alert.created' dan 'alert.updated'.
- Super Admin menerima seluruh stasiun.
- Petugas hanya menerima event stasiunnya.
- Koneksi membutuhkan sesi aktif.
- Heartbeat menjaga koneksi dan membantu deteksi disconnect.
- Reconnect tidak dianggap sumber kebenaran; client wajib mengambil ulang daftar alert melalui REST.

## 6. Deployment

### Lokal

- Docker Compose menjalankan API dan PostgreSQL.
- Seed, simulator, dan Swagger tersedia.
- Cookie Secure dapat dimatikan hanya untuk localhost melalui konfigurasi eksplisit.

### Internet demo

- HTTPS berakhir pada reverse proxy/platform.
- 'trust proxy' disetel hanya sesuai jumlah proxy yang diketahui.
- Cookie Secure wajib aktif.
- Seed dan simulator dinonaktifkan.
- Swagger dinonaktifkan atau dilindungi autentikasi.
- Origin frontend nantinya harus masuk allowlist; wildcard CORS dilarang.

## 7. Batas skalabilitas

Desain awal mengasumsikan satu instance API. Jika menjadi multi-instance, distribusi SSE dan job cleanup harus dipindahkan ke komponen bersama seperti message broker atau scheduler eksternal.

