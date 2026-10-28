# Spesifikasi API — Draft

Base path: '/api/v1'  
Format: JSON UTF-8  
ID publik: UUID  
Waktu: ISO 8601 UTC

Dokumen ini adalah kontrak desain. OpenAPI YAML final dibuat pada tahap implementasi.

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

| Method | Path | Akses | Keterangan |
|---|---|---|---|
| POST | '/auth/login' | Publik | Login username/password, membuat cookie sesi dan CSRF token |
| POST | '/auth/logout' | Login | Mencabut sesi |
| GET | '/auth/me' | Login | Membaca akun dan role aktif |
| POST | '/auth/change-password' | Login | Mengganti password dan mencabut sesi lain |

Login memiliki rate limit per IP serta username+IP. Response gagal selalu generik.

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
- Event di luar jendela waktu yang diizinkan ditolak untuk mengurangi replay.

Development menggunakan ingest key simulator. Production tidak boleh memakai secret statis di aplikasi mobile; mekanisme token tepercaya ditetapkan saat integrasi mobile dimulai.

## 5. Alerts

| Method | Path | Akses | Catatan |
|---|---|---|---|
| GET | '/alerts' | Semua admin | Petugas otomatis difilter stasiunnya |
| GET | '/alerts/:id' | Semua admin | Scope diperiksa backend |
| PATCH | '/alerts/:id/acknowledge' | Semua admin | NEW menjadi ACKNOWLEDGED |
| PATCH | '/alerts/:id/resolve' | Pengambil alert/Super Admin | Catatan wajib |
| GET | '/alerts/stream' | Semua admin | SSE sesuai role/stasiun |

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

- JSON body limit kecil dan eksplisit.
- CORS origin allowlist.
- CSRF token pada request perubahan state berbasis cookie.
- Helmet dengan CSP sesuai resource yang benar-benar dipakai.
- Tidak ada unsafe-eval, raw HTML, file upload, URL fetch, atau command execution.
- Error production memakai kode stabil dan tidak mengirim detail internal.

