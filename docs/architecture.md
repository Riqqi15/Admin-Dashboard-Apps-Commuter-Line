# Arsitektur Timetable Admin Backend

Backend memakai **Clean Architecture yang dibuat pragmatis, per fitur**. Aturan ketergantungannya dijaga oleh tes otomatis, bukan hanya konvensi.

## 1. Komponen

- **API Server:** Express + TypeScript untuk REST, autentikasi, RBAC, SSE, validasi, dan business rules.
- **PostgreSQL:** menyimpan akun dashboard, stasiun, referensi pengguna, sesi, event, alert, statistik, dan audit.
- **Prisma:** schema, migration, serta query terparameterisasi.
- **Retention worker:** service Compose terpisah (`src/workers/retention.ts`) yang menjalankan retensi dan anonimisasi tiap hari, dengan advisory lock, mode `--dry-run`, dan audit `RETENTION_RUN`.
- **Simulator:** alat development untuk mengirim sesi serta event tanpa aplikasi mobile.
- **Postman/Newman:** pengujian black-box dan acceptance flow.
- **Future mobile integration:** client eksternal yang mengirim event sesuai kontrak API; tidak dibangun pada fase pertama.

## 2. Struktur repository

~~~text
src/
├── app.ts                  composition root: merangkai adapter -> use case -> router
├── server.ts               entry point API
├── config/                 parsing dan validasi environment
├── workers/                retention.ts (entry), retention-job.ts (composition root worker)
├── shared/                 kode lintas fitur
│   ├── domain/             AppError, Role, session, station-scope, waktu, jenis event kamera
│   ├── application/        port: UnitOfWork, AuditTrail, TokenService, PasswordHasher, PiiCipher, ...
│   ├── infrastructure/     adapter: Prisma, locks, AES-GCM, Argon2id, HMAC, audit, daily usage
│   └── presentation/       error handler, security headers, validasi, guard session/CSRF/role
└── features/
    └── <fitur>/            stations, staff, auth, alerts, ingest, analytics, audit, retention, docs
        ├── domain/         entitas dan aturan murni
        ├── application/    use case dan port milik fitur
        ├── infrastructure/ adapter Prisma / in-memory untuk port fitur
        └── presentation/   router Express dan DTO Zod
prisma/  tests/  postman/  scripts/  docs/  docker-compose.yml
~~~

## 3. Lapisan dan aturan ketergantungan

~~~mermaid
flowchart LR
    P["presentation<br/>router, DTO Zod"] --> A["application<br/>use case + port"]
    A --> D["domain<br/>entitas, aturan murni"]
    I["infrastructure<br/>Prisma, crypto, lock"] -.->|implementasi port| A
    I --> D
    R["composition root<br/>src/app.ts, workers/retention-job.ts"] --> P
    R --> I
    R --> A
~~~

Arah panah = "boleh mengimpor". Aturan ini diverifikasi oleh `tests/unit/architecture.test.ts`; pelanggaran membuat tes gagal.

| Lapisan | Boleh mengimpor | Tidak boleh |
|---|---|---|
| `domain` | hanya `domain` | paket npm, `node:*`, Express, Prisma |
| `application` | `domain`, `application` | paket npm atau modul Node apa pun, Prisma, Express |
| `infrastructure` | `domain`, `application`, `infrastructure`, Prisma client hasil generate, `config` | `presentation` |
| `presentation` | `domain`, `application`, `presentation`, paket HTTP (express, zod, helmet, cors, cookie-parser, pino, express-rate-limit), `node:*`, `config` | `infrastructure`, Prisma |
| composition root | semua lapisan | dipakai hanya oleh `src/app.ts` dan `src/workers/retention-job.ts` |

Penyimpangan yang disengaja dari bentuk "murni":

- `error-handler` di `presentation` menerima fungsi `translatePrismaError` lewat parameter (factory), sehingga presentation tidak mengimpor Prisma.
- `node:*` diizinkan di `presentation` (mis. stream, crypto untuk request id); `application` tetap bebas dari Node.
- `src/config` hanya boleh diimpor oleh `infrastructure` dan `presentation`.

## 4. Peta fitur

| Fitur | Use case | Port utama | Adapter |
|---|---|---|---|
| `auth` | login (audit `AUTH_LOGIN_FAILED`), logout, change password, authenticate, stillCurrent | `AuthRepository` | `prisma-auth-repository` |
| `stations` | list, create, update (termasuk aktif/nonaktif) | `StationRepository` | `prisma-station-repository` |
| `staff` | list, create, update, resetPassword | `StaffRepository` | `prisma-staff-repository` |
| `alerts` | list, detail, acknowledge, resolve (+ audit penolakan lintas stasiun) | `AlertRepository`, `ActorRepository`, `AlertNotifier`/`AlertStream` | `prisma-alert-repository`, `in-memory-alert-stream` |
| `ingest` | proses event kamera idempoten, buat alert | `IngestRepository`, `PayloadFingerprint`, `IdGenerator` | `prisma-ingest-repository`, `hmac-payload-fingerprint` |
| `analytics` | summary dan usage harian | `AnalyticsReader` | `prisma-analytics-reader` |
| `audit` | daftar audit log | `AuditReader` | `prisma-audit-reader` |
| `retention` | run retensi (dry-run atau sungguhan) | `RetentionStore` | `prisma-retention-store` |
| `docs` | dokumen OpenAPI dari skema Zod | tidak ada | tidak ada |

Port lintas fitur ada di `src/shared/application`: `UnitOfWork`, `AuditTrail`, `TokenService`, `PasswordHasher`, `PiiCipher`, `DailyUsage`, `IdGenerator`.

## 5. Contoh alur: petugas mengklaim alert

~~~mermaid
sequenceDiagram
    participant C as Client
    participant R as alert.router (presentation)
    participant U as alertUseCases.acknowledge (application)
    participant W as UnitOfWork (port)
    participant P as Prisma adapter (infrastructure)
    participant S as AlertStream (port)
    C->>R: PATCH /alerts/:id/acknowledge + cookie + CSRF
    R->>R: guard session, CSRF, role, validasi param
    R->>U: acknowledge(auth, id)
    U->>W: run(transaksi)
    W->>P: kunci stasiun -> user -> sesi -> alert (FOR UPDATE)
    P-->>U: alert milik stasiun yang sama?
    alt stasiun berbeda
        U->>W: transaksi terpisah: audit ALERT_ACCESS_DENIED
        U-->>R: 404 NOT_FOUND (identik dengan alert tidak ada)
    else status NEW
        U->>P: set ACKNOWLEDGED, audit, hitung ulang rata-rata respons
        U->>S: publish alert.updated (setelah commit)
        U-->>R: alert terbaru
    end
    R-->>C: 200 / 404 / 409 ALERT_ALREADY_ACKNOWLEDGED
~~~

Use case tidak tahu Express atau Prisma: ia hanya memanggil port. Mengganti PostgreSQL atau broker SSE cukup dengan adapter baru di `infrastructure`, tanpa mengubah use case.

## 6. Data flow utama

~~~mermaid
flowchart LR
    C["Simulator or future mobile"] -->|HTTPS events| A["Express API"]
    D["Admin client"] -->|HTTPS REST and SSE| A
    A -->|Prisma queries| P["PostgreSQL"]
    W["Retention worker"] -->|Retention jobs| P
    T["Postman and Newman"] -->|HTTPS tests| A
~~~

1. Client mengirim sesi dengan pengguna dan stasiun terkonfirmasi.
2. API memvalidasi schema, autentikasi ingest, timestamp, dan idempotency key.
3. Event kegagalan disimpan dalam transaksi.
4. `CAMERA_INIT_FAILED` membuat alert segera.
5. Tiga `ANALYSIS_FAILED` berturut-turut tanpa `ANALYSIS_RECOVERED` membuat satu alert.
6. Alert disimpan sebelum event SSE diterbitkan.
7. Admin client mengambil state terbaru melalui REST setelah reconnect SSE.

## 7. Autentikasi dan otorisasi

- Admin menggunakan sesi opaque pada cookie HttpOnly.
- Server menyimpan hash token sesi (HMAC), bukan token mentah.
- Request perubahan state membutuhkan CSRF token dan origin yang diizinkan.
- Guard role di `presentation` menentukan akses Super Admin atau Petugas Stasiun.
- Use case selalu menerapkan filter `station_id` bagi Petugas Stasiun.
- Acknowledge alert dilakukan atomik: transaksi mengunci baris alert dan memeriksa `status = NEW`.
- Urutan kunci baris tetap: stasiun -> user -> sesi -> audit, untuk mencegah deadlock.
- Login gagal (username dikenal maupun tidak) dicatat sebagai `AUTH_LOGIN_FAILED` tanpa username, sandi, atau IP.

## 8. SSE

- Event: `alert.created` dan `alert.updated`.
- Super Admin menerima seluruh stasiun; petugas hanya stasiunnya.
- Koneksi membutuhkan sesi aktif; sesi divalidasi ulang tiap 30 detik, maksimal hidup 5 menit.
- Batas 3 koneksi per akun dan 500 global; heartbeat 15 detik.
- Reconnect tidak dianggap sumber kebenaran; client wajib mengambil ulang daftar alert melalui REST.

## 9. Retensi

- Berjalan sebagai service `retention` di Docker Compose (interval `RETENTION_INTERVAL_SECONDS`, default 86400).
- Satu transaksi dengan `pg_try_advisory_xact_lock`; run kedua yang bersamaan dilewati.
- `--dry-run` menjalankan statement sungguhan lalu rollback, sehingga angka yang dilaporkan sama persis dengan run nyata.
- Hasil run nyata dicatat sebagai audit `RETENTION_RUN` berisi jumlah saja.
- Log worker hanya satu baris JSON akhir; log per langkah tidak ada lagi sejak refactor.

## 10. Deployment

### Lokal

- Docker Compose menjalankan `db`, `migrate`, `api`, dan `retention`.
- Seed, simulator, dan OpenAPI tersedia.
- Cookie Secure dapat dimatikan hanya untuk localhost melalui konfigurasi eksplisit.

### Internet demo

- HTTPS berakhir pada reverse proxy/platform.
- `trust proxy` disetel hanya sesuai jumlah proxy yang diketahui.
- Cookie Secure wajib aktif.
- Seed dan simulator dinonaktifkan; `/api/v1/openapi.json` tidak dipasang saat `NODE_ENV=production`.
- Origin frontend nantinya harus masuk allowlist; wildcard CORS dilarang.

## 11. Batas skalabilitas

Desain mengasumsikan satu instance API. Jika menjadi multi-instance, distribusi SSE (kini `in-memory-alert-stream`) harus diganti adapter berbasis message broker, dan penjadwal retensi dipindahkan ke scheduler eksternal. Karena SSE berada di balik port `AlertStream`, perubahan itu tidak menyentuh use case.
