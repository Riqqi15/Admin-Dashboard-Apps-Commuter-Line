# Spesifikasi API — Draft

Base path: '/api/v1'  
Format: JSON UTF-8  
ID publik: UUID  
Waktu: ISO 8601 UTC

Dokumen ini adalah kontrak desain. OpenAPI YAML final dibuat pada tahap implementasi.

## Status implementasi health

Endpoint di luar base path `/api/v1` yang sudah tersedia:

| Method | Path | Respons |
|---|---|---|
| GET | `/health`, `/health/live` | 200, `data.status=ok`; liveness tanpa query database |
| GET | `/health/ready` | 200, `data.status=ready` dan `data.database=connected` setelah query PostgreSQL; 503 `DATABASE_UNAVAILABLE` bila koneksi gagal |

Endpoint authentication, stations, dan staff tersedia sejak Checkpoint B. Pada 17 November 2026, ingest simulator dan REST alert pada bagian 4-5 tersedia. SSE, analytics, dan endpoint pembacaan audit masih kontrak desain.

## 1. Format response

Berhasil:

~~~json
{
  "success": true,
  "data": {}
}
~~~

Gagal:

~~~json
{
  "success": false,
  "error": {
    "code": "STABLE_MACHINE_CODE",
    "message": "Pesan aman untuk client"
  }
}
~~~

## 2. Authentication

Keputusan scope demo: login hanya membutuhkan `username` dan `password`. Tidak ada challenge/endpoint 2FA, PIN tambahan, atau OTP. Cookie sesi dan CSRF token tetap dikelola otomatis oleh client, tanpa kode tambahan yang dimasukkan pengguna. Hashing password, masa berlaku sesi, rate limit login, serta otorisasi per stasiun tetap berlaku.

| Method | Path | Akses | Keterangan |
|---|---|---|---|
| POST | '/auth/login' | Publik | Login username/password, membuat cookie sesi dan CSRF token |
| POST | '/auth/logout' | Login | Mencabut sesi |
| GET | '/auth/me' | Login | Membaca akun dan role aktif |
| POST | '/auth/change-password' | Login | Mengganti password dan mencabut sesi lain |

Login dibatasi maksimal 5 kegagalan per kombinasi username+IP dan 30 percobaan per IP dalam 15 menit. Response gagal selalu generik.

Kontrak yang sudah tersedia:

- Login menerima JSON ketat `{"username":"...","password":"..."}`. Username di-trim dan dinormalisasi lowercase; field tambahan ditolak. Sukses HTTP 200 dengan `data.user` dan `data.csrfToken`. Token sesi hanya dikirim melalui cookie `admin_session`, bukan JSON/Bearer token.
- Cookie memakai `HttpOnly`, `SameSite=Strict`, `Path=/api/v1`, serta `Secure` pada production. Sesi memiliki masa berlaku absolut 8 jam; database hanya menyimpan HMAC SHA-256 token sesi dan CSRF, dengan domain hash terpisah.
- `GET /auth/me` mengembalikan `data` berisi `id`, `username`, `role`, `stationId`, dan `mustChangePassword`. Password/hash/token internal tidak dikirim. CSRF token diperoleh saat login atau ganti sandi; simpan secara lokal pada client, dan login ulang bila token tersebut hilang.
- `POST /auth/change-password` menerima `{"currentPassword":"...","newPassword":"..."}`. Sandi baru 12-128 karakter, berbeda dari sandi lama. Sukses HTTP 200 dengan `data.user` dan CSRF baru, serta cookie sesi baru. Semua sesi lama dicabut, termasuk cookie sebelum rotasi; masa berlaku absolut sesi yang sedang dipakai tidak diperpanjang.
- Akun baru/reset memiliki `mustChangePassword=true`. Sebelum mengganti sandi, hanya profil, ganti sandi, dan logout yang dapat digunakan. Endpoint bisnis mengembalikan HTTP 403 `PASSWORD_CHANGE_REQUIRED`.
- Logout menerima POST tanpa body atau `{}`, membutuhkan cookie dan `X-CSRF-Token`, mencabut sesi, menghapus cookie, dan mengembalikan `data.loggedOut=true` (HTTP 200).
- Semua mutasi berbasis cookie memerlukan `X-CSRF-Token` dari sesi yang sama. Origin yang dikirim harus tepat sama dengan allowlist; `Sec-Fetch-Site: cross-site` ditolak. Request Postman tanpa Origin tetap memerlukan cookie/CSRF untuk mutasi. Login hanya menerima `application/json`.
- Sesi yang kedaluwarsa/dicabut atau akun/stasiun yang nonaktif ditolak HTTP 401. Login dengan username tidak dikenal, sandi salah, atau akun/stasiun nonaktif memakai pesan generik yang sama.

**Batas deployment:** rate limit Checkpoint B memakai MemoryStore per proses dan reset ketika proses API dimulai ulang. Jalankan satu instance untuk demo. Deployment multi-instance memerlukan store pembatasan bersama; batas terdistribusi belum dibuktikan.

## 3. Stations dan staff

| Method | Path | Akses |
|---|---|---|
| GET | '/stations' | Semua admin, hasil sesuai scope |
| POST | '/stations' | Super Admin |
| PATCH | '/stations/:id' | Super Admin |
| GET | '/staff' | Super Admin |
| POST | '/staff' | Super Admin |
| PATCH | '/staff/:id' | Super Admin |
| POST | '/staff/:id/reset-password' | Super Admin |

Petugas baru wajib memiliki 'stationId'. Username dinormalisasi lowercase.

Body implementasi saat ini (field tambahan ditolak):

| Endpoint | Body / query | Respons sukses |
|---|---|---|
| GET `/stations` | `page` (default 1), `pageSize` (default 20, maksimal 100); `stationId` hanya untuk Super Admin | 200, `data.items`, `total`, `page`, `pageSize` |
| POST `/stations` | `code` (uppercase setelah normalisasi, 1-20 karakter `A-Z`, angka, `.`, `_`, `-`), `name` (1-120 karakter), `isActive` opsional | 201, `data` stasiun |
| PATCH `/stations/:id` | Minimal satu dari `code`, `name`, `isActive` | 200, `data` stasiun |
| GET `/staff` | `page`, `pageSize`, `stationId` opsional; hanya Super Admin | 200, `data.items`, `total`, `page`, `pageSize` |
| POST `/staff` | `username`, `password` (12-128 karakter), `stationId` aktif | 201, `data` petugas |
| PATCH `/staff/:id` | Minimal satu dari `username`, `stationId` aktif, `isActive` | 200, `data` petugas |
| POST `/staff/:id/reset-password` | `newPassword` (12-128 karakter), ditentukan Super Admin | 200, `data` petugas dengan `mustChangePassword=true` |

Staff-management hanya mengelola akun `STATION_SECURITY`. Field `role`, `passwordHash`, dan `mustChangePassword` tidak boleh diatur client. ID akun Super Admin pada route staff mengembalikan scoped 404. Sandi reset tidak dikembalikan oleh API; operator menyimpan sandi yang ia masukkan secara lokal.

Petugas mendapat daftar berisi stasiun dari akun terkini di database, tanpa menerima pilihan scope dari client. Penggunaan query `stationId` oleh petugas ditolak 403, termasuk stationId sendiri. Semua route pengelolaan ditolak 403 untuk petugas. Perubahan akun petugas, reset sandi, serta penonaktifan akun/stasiun mencabut sesi yang terdampak. Pemindahan petugas tidak mengubah stasiun pada riwayat alert. Aktivitas login/logout, ganti sandi, serta mutasi stasiun/staff dicatat ke `audit_logs` dalam transaksi tanpa sandi atau token.

Kesalahan input menghasilkan 400 `VALIDATION_ERROR`, duplikasi menghasilkan 409 `CONFLICT`, dan resource tidak ditemukan menghasilkan 404 `NOT_FOUND`, tanpa detail SQL/constraint. Pengujian isolasi mencakup stasiun/staff dan REST alert; SSE belum tersedia.

## 4. Ingest sesi dan event

### 'POST /ingest/sessions'

Request:

~~~json
{
  "externalSessionId": "uuid",
  "externalUserId": "mobile-user-id",
  "displayName": "Nama pengguna",
  "phone": "081234567890",
  "stationId": "uuid",
  "stationConfirmed": true,
  "startedAt": "2026-10-28T08:00:00Z",
  "source": "SIMULATOR"
}
~~~

Aturan:

- 'stationConfirmed' wajib true.
- Request ulang dengan ID dan payload sama mengembalikan resource yang sama.
- ID sama dengan payload berbeda menghasilkan '409 IDEMPOTENCY_CONFLICT'.
- Gambar atau field media ditolak.

### 'POST /ingest/events'

Request:

~~~json
{
  "eventId": "uuid",
  "externalSessionId": "uuid",
  "type": "ANALYSIS_FAILED",
  "errorCode": "VISION_TIMEOUT",
  "occurredAt": "2026-10-28T08:01:00Z"
}
~~~

Aturan alert:

- 'CAMERA_INIT_FAILED': membuat alert segera.
- 'ANALYSIS_FAILED': menambah hitungan kegagalan berturut-turut.
- 'ANALYSIS_RECOVERED': mereset hitungan menjadi nol.
- Kegagalan ketiga membuat alert bila sesi belum mempunyai alert.
- 'SESSION_ENDED': menutup sesi, bukan menutup alert.
- Event yang lebih dari 5 menit atau lebih dari 5 menit di masa depan ditolak untuk mengurangi replay.

Development menggunakan ingest key simulator. Production tidak boleh memakai secret statis di aplikasi mobile; mekanisme token tepercaya ditetapkan saat integrasi mobile dimulai.

Kontrak implementasi ingest (17 November):

- Header `X-Ingest-Key` harus cocok dengan `SIMULATOR_INGEST_KEY` lokal. Key tidak ada/salah: 401; konfigurasi kosong: 503. Mode production dan sumber `MOBILE` belum didukung (501). Key simulator tidak boleh menulis sesi dengan sumber MOBILE (403).
- Batas 60 request/menit per sumber SIMULATOR dan IP, satu proses. Body maksimal 16 KiB; field tambahan/media ditolak. UUID dinormalisasi lowercase sebelum penguncian dan fingerprint HMAC.
- Sesi memerlukan stasiun aktif (404 bila tidak ditemukan; 400 bila nonaktif), nama 1-120 karakter, external user ID 1-100 karakter, telepon opsional 6-32 karakter angka/tanda telepon. `startedAt` dan `occurredAt` wajib ISO datetime dengan offset dan berada dalam jendela +/-5 menit waktu server, termasuk permintaan duplikat. Sesi/event lama harus tidak dikirim ulang setelah jendela ini.
- Sukses baru: 201; duplikat identik: 200, ID sama tanpa menambah row/counter/alert. Payload berbeda dengan ID sama: 409 `IDEMPOTENCY_CONFLICT`. Advisory lock global untuk event ID dan row lock sesi melindungi request bersamaan.
- Respons sesi `data`: `id`, `externalSessionId`, `stationId`, `status`, `startedAt`. Respons event: `id`, `eventId`, `sessionId`, `consecutiveFailures`, `status`, `alertId` (null sebelum ambang). Nama/telepon tidak dikirim kembali melalui ingest.
- Event sebelum waktu mulai atau lebih lama dari event terakhir: 409 `EVENT_OUT_OF_ORDER`. Timestamp sama diterima menurut urutan transaksi. Event baru setelah `SESSION_ENDED`: 409 `SESSION_CLOSED`; sesi kedaluwarsa: 410 `SESSION_EXPIRED`.
- Jenis event: `SESSION_STARTED`, `CAMERA_INIT_FAILED`, `ANALYSIS_FAILED`, `ANALYSIS_RECOVERED`, `SESSION_ENDED`. `errorCode` opsional, hanya pada kegagalan, dari allowlist: `CAMERA_UNAVAILABLE`, `CAMERA_INITIALIZATION_FAILED`, `FRAME_ENCODING_FAILED`, `VISION_TIMEOUT`, `VISION_PROVIDER_UNAVAILABLE`, `NETWORK_TIMEOUT`.
- Satu sesi maksimal satu alert, termasuk saat request paralel. Kegagalan kritis menandai sesi FAILED; recovery mereset counter tanpa menghapus riwayat kegagalan atau menyelesaikan alert. FAILED belum menutup sesi sampai `SESSION_ENDED` diterima. Tidak ada panggilan/SMS otomatis; API membuat alert untuk ditangani petugas.
- Nama/telepon dienkripsi AES-256-GCM dengan IV acak dan AAD terpisah per record/field. TTL sesi/event 7 hari dan metadata alert 30 hari sudah ditulis, tetapi worker penghapusan belum tersedia.

## 5. Alerts

| Method | Path | Akses | Catatan |
|---|---|---|---|
| GET | '/alerts' | Semua admin | Petugas otomatis difilter stasiunnya |
| GET | '/alerts/:id' | Semua admin | Scope diperiksa backend |
| PATCH | '/alerts/:id/acknowledge' | Semua admin | NEW menjadi ACKNOWLEDGED |
| PATCH | '/alerts/:id/resolve' | Pengambil alert/Super Admin | Catatan wajib |
| GET | '/alerts/stream' | Semua admin | Rencana SSE; belum tersedia |

Kontrak REST alert yang tersedia:

- List menerima `page` (default 1), `pageSize` (default 20, maksimal 100), `status` opsional (`NEW`, `ACKNOWLEDGED`, `RESOLVED`), dan `stationId` hanya untuk Super Admin. Petugas mengirim filter stasiun apa pun ditolak 403. Respons `data.items`, `total`, `page`, `pageSize`; daftar tidak memuat nama/telepon/ciphertext.
- Detail mengembalikan metadata alert dan `user: {displayName, phone}` untuk akses yang sah. Setelah 7 hari sejak alert dibuat, atau snapshot telah dipurge, `user=null`; alert melewati `expiresAt` tidak dapat diakses. Penekanan respons PII ini belum menggantikan worker penghapusan fisik.
- Acknowledge menerima `{}` atau tanpa body. Handler diambil dari akun aktif, bukan client. Transaksi mengunci row dan memeriksa NEW sehingga hanya satu klaim berhasil; permintaan lain mendapat 409.
- Resolve menerima `{"notes":"Pengguna telah dibantu"}`, di-trim, 1-1000 karakter. Hanya ACKNOWLEDGED dapat menjadi RESOLVED; handler awal tetap dicatat. Catatan jangan diisi sandi atau data pribadi tambahan.
- Mutasi memerlukan cookie dan CSRF sesi. Role/stasiun/sesi dibaca ulang dalam transaksi setelah account lock untuk menolak permintaan yang bersamaan dengan pencabutan/pemindahan akun. Akses alert stasiun lain disamarkan sebagai 404.
- Pembuatan, klaim, dan penyelesaian mencatat audit dalam transaksi yang sama; audit tidak menyimpan snapshot nama/telepon.

Status penting:

- '401': sesi tidak ada/tidak valid.
- '403': role atau stasiun tidak sesuai.
- '404': resource tidak ditemukan dalam scope pengguna.
- '409 ALERT_ALREADY_ACKNOWLEDGED': alert sudah diambil.
- '422 INVALID_STATE_TRANSITION': transisi status tidak valid.

## 6. Analytics dan audit

| Method | Path | Akses |
|---|---|---|
| GET | '/dashboard/summary' | Semua admin, scope otomatis |
| GET | '/analytics/usage?from=&to=&stationId=' | Semua admin, petugas tidak boleh mengganti stasiun |
| GET | '/audit-logs' | Super Admin |

Rentang tanggal dibatasi agar query tidak digunakan untuk DoS.

## 7. SSE

Contoh:

~~~text
event: alert.created
id: event-uuid
data: {"alertId":"uuid","stationId":"uuid","status":"NEW","createdAt":"..."}
~~~

Payload awal tidak memuat nomor telepon. Detail sensitif hanya diambil melalui endpoint alert setelah otorisasi.

## 8. Security headers dan request rules

- JSON body dibatasi 32 KiB untuk endpoint umum dan 16 KiB untuk endpoint ingest.
- CORS origin allowlist.
- CSRF token pada request perubahan state berbasis cookie.
- Helmet dengan CSP sesuai resource yang benar-benar dipakai.
- Tidak ada unsafe-eval, raw HTML, file upload, URL fetch, atau command execution.
- Error production memakai kode stabil dan tidak mengirim detail internal.

