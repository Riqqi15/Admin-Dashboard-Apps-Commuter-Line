# Pengujian API dengan Postman

Status: **Health Check dan Database Readiness tersedia; endpoint bisnis masih draft**. Server lokal memiliki `/health`, `/health/live`, dan `/health/ready`. Newman menjalankan dua request ke backend nyata; 26 request bisnis menunggu implementasi auth/alert. Database, migration dan seed demo sudah tersedia. File ini mengikuti [API specification](../docs/api-specification.md).

## File

- `Timetable-Admin.postman_collection.json`: 28 request dalam 11 folder (termasuk readiness).
- `Local.postman_environment.json`: contoh Environment tanpa kredensial.
- `Docker.postman_environment.json`: contoh Environment tanpa kredensial untuk API Docker pada port 3001.
- `validate.cjs`: pemeriksaan struktur, variabel, dan sintaks script secara offline.

## Impor dan percobaan pertama

1. Buka Postman desktop, klik **Import**, lalu pilih kedua file JSON di folder ini.
2. Pilih Environment **Timetable Admin — Local Example**.
3. Ikuti setup di README utama: generate Prisma Client, jalankan database/migration, lalu `npm run dev`. Isi `baseUrl` dengan `http://127.0.0.1:3000` (tanpa slash terakhir).
4. Buka folder **01 Health Check**, pilih **01 Backend hidup**, lalu klik **Send**.
5. Target: HTTP `200`, JSON `{"success":true,"data":{"status":"ok"}}`, dan empat assertion lulus pada **Test Results**. Jika koneksi ditolak, pastikan backend sudah aktif dan port benar.

Untuk container Docker, impor `Docker.postman_environment.json` dan pilih **Timetable Admin — Docker Example**. `baseUrl` sudah menunjuk `http://127.0.0.1:3001`. Jalankan dua folder health/readiness; padanan otomatisnya `npm run postman:docker`. Request bisnis masih draft.

Alternatif otomatis: jalankan `npm run postman:health` di terminal lain. Perintah ini menjalankan Health Check dan Database Readiness: 2 request, 7 assertion. Readiness memerlukan PostgreSQL aktif; liveness tidak. Hindari Run seluruh Collection sampai endpoint bisnis tersedia.

Cara impor: [dokumentasi resmi Postman](https://learning.postman.com/docs/getting-started/importing-and-exporting/importing-data/).
Cara kerja assertion: [dokumentasi script Postman](https://learning.postman.com/docs/tests-and-scripts/write-scripts/test-scripts/).

## Persiapan alur lengkap (sesudah backend selesai)

Jalankan `npm run setup:demo` lalu `npm run prisma:seed`: dua stasiun demo, akun `superadmin`, `security.manggarai`, dan `security.tanahabang` dibuat. Sandi acak berada di `.env.seed.local`; akun baru wajib mengganti sandi ketika implementasi auth tersedia. Collection bisnis masih draft dan tidak membuat akun/stasiun.

Isi Environment secara lokal:

| Variabel | Isi |
|---|---|
| `superAdminUsername`, `superAdminPassword` | Kredensial Super Admin demo |
| `stationSecurityUsername`, `stationSecurityPassword` | Kredensial petugas stasiun A |
| `otherStationSecurityUsername`, `otherStationSecurityPassword` | Kredensial petugas stasiun B |
| `stationId`, `otherStationId` | UUID stasiun A dan B dari database/GET stations |
| `ingestKey` | Key simulator lokal dari konfigurasi backend |

Biarkan cookie jar Postman aktif. Login memakai cookie sesi, bukan Bearer token. Respons login menyimpan CSRF token ke Environment. Logout mencabut sesi terakhir.

Jalankan request **01–12** secara berurutan. Request 06 menghasilkan UUID sesi dan waktu baru; request 07 mengulang payload sesi identik. Request 08–10 mengirim tiga kegagalan analisis dengan event ID berbeda. Request 11 mengirim ulang payload event ketiga, bukan membuat ID baru. Kirim seluruh event dalam jendela 5 menit.

Sebelum request 13, pastikan `alertId` terisi. Jika endpoint event mengembalikan `data.alertId`, script menyimpannya otomatis. Jika tidak, dari request 12 cari alert dengan sesi request 06 lalu salin UUID alert ke `alertId`. Jangan mengambil alert pengguna lain.

Request 14 dan 15 mengubah status alert demo. Request 19–27 mengganti akun aktif untuk memeriksa batas role/stasiun, lalu logout dan menguji akses tanpa sesi. Untuk mengulang seluruh alur, mulai dari login Super Admin dan buat sesi baru melalui request 06.

Setelah setup berhasil, gunakan Collection Runner. Run pertama lebih mudah dilakukan satu per satu agar respons bisa dipahami. Jangan mengulang request 06 di tengah skenario: UUID sesi berubah.

## Asumsi draft yang perlu diselaraskan dengan implementasi

Spesifikasi belum menentukan seluruh schema body/response, nama cookie, header ingest, dan status sukses. Collection menggunakan:

- `POST /auth/login`: body `username` dan `password`; HTTP 200; CSRF token di `data.csrfToken`. Nama field token dapat diubah melalui `csrfResponseField`.
- Header mutasi berbasis cookie: `X-CSRF-Token`, dapat diubah melalui `csrfHeader`.
- Header simulator: `X-Ingest-Key`, dapat diubah melalui `ingestKeyHeader`. Hanya untuk simulator development.
- `PATCH /alerts/:id/resolve`: body `{"notes":"..."}`; field ini perlu dikonfirmasi saat implementasi.
- Login/logout dan mutasi alert: HTTP 200 dengan envelope `success/data`. Ingest sesi menerima 200/201; ingest event menerima 200/201/202 sampai status final disepakati.
- `GET /health` berada di luar `/api/v1`; sudah ditetapkan dan memeriksa HTTP 200, Content-Type JSON, body liveness, serta header nosniff.

Ini asumsi Collection, bukan penetapan kontrak API baru. Sesuaikan request/assertion dengan OpenAPI final sebelum menjadikannya release gate. Jika implementasi logout menggunakan HTTP 204, ubah assertion dan jangan mencoba mem-parse body kosong.

## Cakupan dan batas bukti

Assertions memeriksa status HTTP dan envelope JSON, ditambah keberadaan CSRF token pada login. Tes negatif memeriksa larangan akses staff untuk petugas, akses baca/tulis alert antarstasiun, akses setelah logout, dan sandi salah.

**Tetap periksa secara manual:** dua kegagalan awal belum membuat alert, kegagalan ketiga membuat tepat satu alert, replay tidak menduplikasi sesi/event/alert, status berubah sesuai aturan, serta isi data hanya dari stasiun yang diizinkan. Respons HTTP sukses saja tidak membuktikan aturan tersebut.

Reset melalui ANALYSIS_RECOVERED, kegagalan inisialisasi kamera, CSRF negatif, balapan acknowledge, retensi, dan SSE belum dicakup Collection awal ini. Rincian tetap ada di [test plan](../docs/test-plan.md). Lulus Collection ini belum berarti seluruh backend atau keamanannya lulus.

## Verifikasi file dan Newman

Dari root repository, setelah dependency yang sudah tercantum terpasang:

```powershell
node postman/validate.cjs
```

Ini hanya memvalidasi file secara offline; tidak mengirim request.

Setelah backend dan data demo siap, ekspor Environment lokal yang sudah diisi ke `postman/Local.private.postman_environment.json`, lalu:

```powershell
npx --no-install newman run postman/Timetable-Admin.postman_collection.json -e postman/Local.private.postman_environment.json --bail
```

Run penuh hanya setelah semua variabel termasuk `alertId` dapat diperoleh sesuai kontrak implementasi; bila respons event belum mengembalikan ID alert, jalankan tahap 01–12 dahulu, salin ID, lalu lanjutkan tahap berikut melalui Postman.

Environment contoh harus tetap kosong dari secret. File `*.private.postman_environment.json` diabaikan Git; jangan ekspor kredensial nyata ke file contoh atau membagikan cookie/CSRF token.
