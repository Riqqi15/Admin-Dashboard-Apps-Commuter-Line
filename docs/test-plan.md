# Test Plan — Timetable Admin Backend

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

Environment contoh hanya berisi placeholder:

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

