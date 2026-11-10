# Pengujian API dengan Postman

Status Checkpoint B: **health, authentication, stations, dan staff management tersedia**. Collection berisi 36 request dalam 11 folder: 20 request untuk endpoint yang sudah diimplementasikan, 16 request ingest/alert/analytics/audit yang masih draft. Keberhasilan workflow di bawah tidak membuktikan fitur yang masih draft.

## File dan impor

- `Timetable-Admin.postman_collection.json`: Collection utama, termasuk request ganti sandi dan pengelolaan stasiun/staff.
- `Local.postman_environment.json`: contoh Environment native, `baseUrl=http://127.0.0.1:3000`.
- `Docker.postman_environment.json`: contoh Environment Docker, `baseUrl=http://127.0.0.1:3001`.
- `validate.cjs`: validasi struktur, variabel, sintaks script, dan secret contoh secara offline.

Impor Collection dan salah satu Environment melalui **Import**, lalu pilih Environment di kanan atas. Jika Collection lama sudah ada, pilih **Replace** dan periksa tidak ada duplikat. File JSON dalam repo yang diperbarui tidak otomatis memperbarui salinan di aplikasi Postman.

Untuk native, jalankan database/migration sesuai README utama, lalu `npm run dev`. Docker memerlukan engine yang aktif dan image terbaru melalui `npm run docker:up`. Image sebelum Checkpoint B hanya memiliki health/readiness.

## Tes otomatis tanpa memasukkan sandi manual

Setelah dependency, Prisma Client, database lokal, dan migration siap:

~~~powershell
npm run postman:validate
npm run postman:admin
~~~

`postman:validate` tidak mengirim request. `postman:admin` otomatis menjalankan build, membuka server HTTP nyata pada port loopback sementara, dan memakai PostgreSQL lokal proyek dari `.env` (hanya port 5434/5435 dan database `timetable_admin`). Script menolak mode production.

Workflow menjalankan **22 request / 55 assertion** dari Collection utama, meliputi:

1. Health dan database readiness.
2. Login Super Admin dengan sandi sementara, ganti sandi, dan profil.
3. Daftar/buat/ubah stasiun.
4. Daftar/buat/ubah petugas dan reset sandi.
5. Logout admin lalu login sebagai petugas yang baru dibuat.
6. Penolakan akses bisnis sebelum sandi sementara diganti.
7. Ganti sandi petugas dan daftar yang hanya berisi stasiunnya.
8. Penolakan pemilihan scope stasiun dan akses pengelolaan staff.
9. Logout, penolakan profil tanpa sesi, dan login dengan sandi salah.

Kredensial acak hanya berada di memori; cookie dikelola Newman. Fixture memakai prefix acak per run, lalu akun/stasiun/sesi/audit fixture dibersihkan. Akun demo tidak diubah dan Environment contoh tidak diisi secret. Tidak perlu menyalin sandi atau token ke terminal.

Runner otomatis memilih folder 01-05 dan request auth/otorisasi tertentu. Jangan menjalankan seluruh Collection karena fitur kamera/alert belum tersedia.

## Mencoba manual di Postman

Untuk akun demo, jalankan `npm run setup:demo` dan `npm run prisma:seed` jika belum tersedia. Sandi awal ada di `.env.seed.local`; seed ulang tidak mengganti sandi akun yang sudah ada. Isi kredensial hanya di Environment lokal/private.

| Variabel | Keterangan |
|---|---|
| `superAdminUsername`, `superAdminPassword` | Kredensial Super Admin |
| `stationSecurityUsername`, `stationSecurityPassword` | Kredensial petugas stasiun A |
| `otherStationSecurityUsername`, `otherStationSecurityPassword` | Kredensial petugas stasiun B |
| `currentPassword`, `newPassword` | Sandi akun yang sedang login dan sandi penggantinya (12-128 karakter) |
| `managedStationCode`, `managedStationName`, `managedStationUpdatedName` | Data stasiun uji; kode harus unik |
| `managedStationId` | Otomatis diisi setelah Create Station |
| `managedStaffUsername`, `managedStaffPassword` | Username unik dan sandi sementara petugas uji |
| `managedStaffId` | Otomatis diisi setelah Create Staff |
| `managedStaffResetPassword` | Sandi sementara baru untuk Reset Staff Password |
| `managedStaffNewPassword` | Dipakai workflow otomatis saat petugas mengganti sandi sementara |
| `stationId`, `otherStationId` | UUID stasiun untuk fixture dan tes scope |
| `csrfToken` | Otomatis diisi setelah login/ganti sandi; tidak diisi manual |

Urutan awal: **Check API Health -> Check Database Connection -> Login as Super Admin -> Change Password -> Get Current User -> List Stations**. Setelah ganti sandi, perbarui variabel sandi akun terkait agar login berikutnya memakai sandi terbaru. CSRF baru disimpan otomatis dan cookie lama tidak berlaku.

Akun dengan `mustChangePassword=true` hanya dapat memakai profil, ganti sandi, dan logout; daftar stasiun/staff akan menolak sampai sandi diganti. Untuk akun yang sudah mengganti sandi, request Change Password tidak wajib dijalankan lagi.

Cookie jar harus aktif. Login memakai `admin_session`, bukan Bearer token. Mutasi memerlukan `X-CSRF-Token` milik sesi aktif; saat mengganti akun, lakukan login lagi untuk memperbarui cookie/CSRF. Token CSRF hilang berarti perlu login ulang.

Request **Require Temporary Password Change** sengaja mengharapkan 403 pada akun bersandi sementara. Request **Deny Station Scope Override** sengaja dijalankan sebagai petugas, bukan Super Admin. Request pengelolaan stasiun/staff dijalankan sebagai Super Admin yang sudah mengganti sandi.

## Bagian yang masih draft

Folder Camera Sessions, Camera Failure Events, Alerts, Analytics, dan Audit Logs belum memiliki backend. Tes negatif akses alert lintas stasiun juga belum dapat dijalankan. Jangan memakai hasil 403 endpoint stasiun sebagai bukti isolasi alert/SSE.

Variabel `ingestKey`, `externalSessionId`, `eventId`, `alertId`, serta kontrak response ingest/claim/resolve masih mengikuti desain dan akan diselaraskan pada implementasi berikutnya. Foto/video kamera tidak dikirim atau disimpan.

## Batas bukti dan keamanan

Integration/security tests memeriksa cookie production, sesi hash-only, CSRF, rate limit, revokasi akun/stasiun, mass assignment, dan request bersamaan. Newman memeriksa alur HTTP nyata dan isi daftar stasiun. Frontend, integrasi mobile, retensi, alert, dan deployment production belum dibuktikan.

Rate limit memakai MemoryStore satu proses; restart menghapus counter, sehingga deployment multi-instance memerlukan shared store. Pengujian Docker Checkpoint B belum dijalankan ketika Docker Desktop dijeda; native PostgreSQL tetap dapat dipakai.

Environment contoh harus selalu kosong dari secret. File `*.private.postman_environment.json` diabaikan Git. Jangan membagikan ekspor berisi sandi, cookie, atau token.

Referensi: [kontrak API](../docs/api-specification.md), [progres](../docs/progress.md), [impor Postman](https://learning.postman.com/docs/getting-started/importing-and-exporting/importing-data/).
