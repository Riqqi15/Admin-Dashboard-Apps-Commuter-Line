# Test Plan — Timetable Admin Backend

## Bukti lokal 21 November 2026

- **Database test terpisah:** semua tes vitest dan Newman memakai `timetable_admin_test` (dibuat/dimigrasi oleh `npm run db:test:setup` pada `pretest`). Jumlah baris database demo identik sebelum dan sesudah seluruh run.
- `npm test`: **105 tes pada 22 file**, termasuk auth/stasiun, ingest, crypto PII, REST alert, race, SSE stream, analytics, daily stats, retention, OpenAPI, dan audit (aksi auth/stasiun/staff/alert, penolakan lintas stasiun, tanpa secret). Suite yang sama lulus terhadap PostgreSQL Docker (`npm run test:docker`).
- Retention kini memanggil worker asli (`runRetention` di `src/workers/retention-job.ts`), bukan salinan SQL: alert/audit kedaluwarsa, sesi admin kedaluwarsa/dicabut, PII 7 hari, urutan FK event → sesi → tracked user, idempotensi, serta stasiun/akun/statistik tidak terhapus.
- OpenAPI: dokumen sama persis dengan route terpasang, semua `$ref` ter-resolve, CSRF wajib pada setiap mutasi, tidak disajikan di production, tanpa secret.
- Simulator (`npm run simulate`) diuji manual terhadap API lokal pada database test: `three-consecutive-failures` membuat tepat satu alert, `camera-init-failed` membuat alert segera, replay `duplicate-event` 200 tanpa menambah counter.
- `npm run postman:camera`: 24 request HTTP / 68 assertion. Ambang gagal 1–3, replay identik, detail sesuai scope, claim/resolve serta penolakan lintas stasiun.
- `npm run postman:admin`: regresi 25 request HTTP / 61 assertion.
- `npm run postman:validate`: **38 request / 46 script / 2 Environment**, secret contoh kosong.
- `npm run typecheck`: lulus tanpa error.
- Race ingest mencakup UUID berbeda casing, ID event sama lintas sesi, event paralel, counter dan satu alert. Race alert mencakup dua claimant dan pencabutan/pemindahan akun setelah middleware autentikasi.
- Crypto memeriksa roundtrip, IV acak, key/AAD salah dan manipulasi tag. Detail menguji snapshot tidak mengikuti perubahan profil serta penekanan PII setelah 7 hari.
- SSE: isolasi stasiun, Super Admin semua stasiun, event updated pada acknowledge/resolve, revokasi sesi menutup stream, batas koneksi per akun (3 max), penolakan tanpa autentikasi, penolakan mustChangePassword.
- Analytics: scope dashboard summary (station security vs Super Admin), parameter stationId rejection, validasi rentang tanggal (31 hari max, reversed), default 7 hari, audit logs Super Admin only, filter audit (station/action/date), exclusion details, pagination, penolakan tanpa autentikasi.
- Daily stats: increment session/uniqueUser, no double-count same user same day, failedSessionCount pada transisi FAILED pertama, alertCount/resolvedAlertCount, averageResponseSeconds, duplikat event idempoten, independensi per stasiun.
- Retention: hapus alert/audit/sesi kedaluwarsa, PII purge tanpa hapus alert, PII purge idempoten, urutan FK (events sebelum sessions), preservasi stasiun/akun/stats, hapus tracked user setelah sesi dihapus.

Daftar skenario berikut tetap menjadi target acceptance lengkap. Docker terbaru dan `test:docker` dengan database `_test` terbukti pada 21 November (lihat `docs/docker.md`). Yang belum dibuktikan: run CI pertama di GitHub dan deployment internet (TLS, proxy, multi-instance).

## 1. Tujuan

Membuktikan aturan bisnis, isolasi stasiun, keamanan API, konsistensi transaksi, retensi data, dan kontrak response sebelum backend dianggap selesai.

## 2. Lapisan pengujian

### Unit test

- Normalisasi username.
- Aturan role dan station assignment.
- Penghitung kegagalan berturut-turut.
- Reset hitungan oleh 'ANALYSIS_RECOVERED'.
- State machine alert.
- Perhitungan retensi dan anonimisasi.

### Integration test

- Express route + PostgreSQL test database.
- Session lifecycle dan CSRF.
- Query scoping per stasiun.
- Idempotency sesi/event.
- Transaksi event + alert.
- Race acknowledge.
- Cleanup dan aggregate statistics.
- SSE authorization dan filtering.

### Postman/Newman

Collection folder:

1. Health Check
2. Authentication
3. Stations
4. Staff Management
5. Camera Session Ingest
6. Camera Failure Events
7. Alerts
8. Analytics
9. Audit Logs
10. Security and Negative Tests

Environment contoh hanya berisi nilai dummy tanpa secret:

- 'baseUrl'
- 'superAdminUsername'
- 'superAdminPassword'
- 'stationSecurityUsername'
- 'stationSecurityPassword'
- 'csrfToken'
- 'stationId'
- 'otherStationId'
- 'externalSessionId'
- 'alertId'

Environment berisi secret nyata tidak boleh dikomit.

## 3. Alur acceptance utama

1. Login Super Admin berhasil.
2. Buat dua stasiun dan dua petugas berbeda.
3. Buat sesi simulator pada stasiun A.
4. Kirim dua 'ANALYSIS_FAILED'; pastikan alert belum ada.
5. Kirim 'ANALYSIS_RECOVERED'; pastikan hitungan reset.
6. Kirim tiga 'ANALYSIS_FAILED'; pastikan tepat satu alert 'NEW'.
7. Kirim ulang event ketiga; pastikan tidak ada duplikasi.
8. Login sebagai petugas stasiun A; alert terlihat.
9. Petugas stasiun B meminta alert tersebut; response '403' atau scoped '404'.
10. Dua request acknowledge paralel dikirim; satu berhasil dan satu '409'.
11. Petugas pengambil menyelesaikan alert dengan catatan.
12. Statistik dan audit log diperiksa.

## 4. Security test cases

| ID | Kasus | Hasil yang diharapkan |
|---|---|---|
| SEC-001 | Request tanpa sesi | '401' |
| SEC-002 | Cookie sesi dimodifikasi | '401', sesi tidak diterima |
| SEC-003 | Mutasi tanpa CSRF token | '403' |
| SEC-004 | Origin tidak diizinkan | Ditolak |
| SEC-005 | Brute-force login | '429' setelah batas |
| SEC-006 | Petugas A membaca resource stasiun B | '403' atau scoped '404' |
| SEC-007 | Petugas A mengubah alert stasiun B | '403' atau scoped '404' |
| SEC-008 | Event ID sama dengan payload berbeda | '409' |
| SEC-009 | Timestamp replay di luar jendela | Ditolak |
| SEC-010 | String SQL/XSS pada field teks | Disimpan sebagai data aman atau ditolak; tidak dieksekusi |
| SEC-011 | Body terlalu besar | '413' |
| SEC-012 | Field media/gambar | '422' |
| SEC-013 | Acknowledge race | Satu sukses, satu '409' |
| SEC-014 | SSE petugas mencoba stasiun lain | Tidak menerima event |
| SEC-015 | Error internal dipicu | Tidak ada stack trace/detail DB pada response |

## 5. Retention test

- Gunakan clock/test fixture yang dapat dikontrol.
- Data pengguna, sesi, dan event berusia lebih dari 7 hari dihapus atau dianonimkan.
- PII alert berusia lebih dari 7 hari dikosongkan.
- Alert dan audit berusia lebih dari 30 hari dihapus.
- Akun admin, stasiun, dan statistik agregat tetap tersedia.

## 6. Release gate

- Lint dan typecheck lulus.
- Unit dan integration test lulus.
- Newman lulus terhadap deployment test.
- Migration diuji dari database kosong.
- Dependency scan ditriase.
- Security checklist ditandatangani/dicentang dengan bukti.
- Tidak ada secret pada repository atau artefak test.

