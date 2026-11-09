# Product Requirements Document — Timetable Admin Backend

## 1. Ringkasan

Timetable Admin Backend adalah layanan terpisah untuk mencatat penggunaan fitur Camera Assist per stasiun, membuat alert ketika terjadi kegagalan kritis, dan mendukung penanganan oleh petugas keamanan pada stasiun tersebut. Tahap capstone pertama tidak mencakup web dashboard.

## 2. Masalah

Pengelola belum memiliki sumber data terpusat untuk mengetahui berapa pengguna memakai Camera Assist pada setiap stasiun, apakah terjadi kegagalan, siapa yang menangani alert, dan berapa lama penanganannya.

## 3. Tujuan

- Mencatat sesi Camera Assist berdasarkan pengguna dan stasiun yang telah dikonfirmasi.
- Membuat alert untuk kegagalan kritis.
- Membatasi petugas ke satu stasiun penugasan.
- Menyediakan statistik agregat untuk Super Admin.
- Menyediakan API yang aman, terdokumentasi, dan dapat diuji melalui Postman.
- Mendukung pengembangan lokal dan deployment internet untuk demo.

## 4. Di luar scope

- Mengubah repository Timetable milik dosen.
- Mengubah tampilan atau alur aplikasi mobile.
- Menjalankan model deteksi objek pada backend admin.
- Menyimpan gambar, rekaman, atau frame kamera.
- Membuat web dashboard pada tahap pertama.
- Mengirim WhatsApp atau SMS.
- Autentikasi dua faktor (2FA/MFA), PIN tambahan, serta OTP melalui SMS, email, atau aplikasi authenticator pada versi demo capstone.
- Mengelola jadwal, rute, atau tiket kereta.

## 5. Aktor

### Super Admin

- Login dengan username dan kata sandi.
- Melihat data seluruh stasiun.
- Membuat, mengubah, menonaktifkan, dan memindahkan akun petugas.
- Melihat statistik, alert, dan audit log.

### Petugas Stasiun

- Terikat pada tepat satu stasiun.
- Hanya melihat sesi dan alert stasiun tersebut.
- Mengambil dan menyelesaikan alert.

### Pengguna Mobile

- Merupakan pengguna aplikasi yang sudah ada.
- Tidak dapat login ke sistem admin.
- Direferensikan melalui 'external_user_id' dan data minimum yang dikirim melalui kontrak integrasi.

## 6. Kebutuhan fungsional

| ID | Kebutuhan |
|---|---|
| FR-001 | Sistem menyediakan login dashboard menggunakan username dan kata sandi, tanpa tahap 2FA, PIN tambahan, atau OTP pada versi demo capstone. |
| FR-002 | Super Admin dapat mengelola akun Petugas Stasiun. |
| FR-003 | Setiap Petugas Stasiun wajib memiliki tepat satu stasiun aktif. |
| FR-004 | Petugas hanya dapat membaca dan mengubah resource pada stasiunnya. |
| FR-005 | API ingest dapat membuat sesi Camera Assist yang berisi pengguna, stasiun, dan waktu mulai. |
| FR-006 | Stasiun pada sesi harus berasal dari pilihan yang telah dikonfirmasi pengguna. |
| FR-007 | Kegagalan inisialisasi kamera membuat alert segera. |
| FR-008 | Tiga event 'ANALYSIS_FAILED' berturut-turut tanpa 'ANALYSIS_RECOVERED' membuat satu alert. |
| FR-009 | Satu sesi hanya dapat mempunyai satu alert. |
| FR-010 | Alert mengikuti transisi 'NEW → ACKNOWLEDGED → RESOLVED'. |
| FR-011 | Hanya satu petugas dapat mengambil sebuah alert. |
| FR-012 | Penyelesaian alert wajib menyertakan catatan. |
| FR-013 | SSE mengirim 'alert.created' dan 'alert.updated' sesuai scope role/stasiun. |
| FR-014 | API menyediakan ringkasan sesi, pengguna unik, kegagalan, alert, dan waktu respons. |
| FR-015 | Sistem mencatat tindakan keamanan dan perubahan penting pada audit log. |
| FR-016 | Seed dan simulator menyediakan data demo tanpa aplikasi mobile. |
| FR-017 | Job retensi menghapus atau menganonimkan data sesuai periode yang disetujui. |

## 7. Kebutuhan nonfungsional

| ID | Kebutuhan |
|---|---|
| NFR-001 | Alert dikirim melalui SSE maksimal sekitar lima detik setelah event pemicu diterima. |
| NFR-002 | Semua ID publik menggunakan UUID acak. |
| NFR-003 | API menggunakan validasi schema ketat dan batas ukuran request. |
| NFR-004 | Password, token, cookie, dan nomor telepon lengkap tidak boleh masuk log. |
| NFR-005 | Production memakai HTTPS dan origin allowlist. |
| NFR-006 | Error production tidak membocorkan stack trace atau detail database. |
| NFR-007 | Query database menggunakan Prisma tanpa raw SQL dari input pengguna. |
| NFR-008 | Database kosong dapat disiapkan ulang melalui migration dan seed. |
| NFR-009 | API memiliki OpenAPI/Swagger dan Postman Collection. |
| NFR-010 | Rilis diblokir bila ada kerentanan runtime High/Critical yang relevan dan belum dimitigasi. |

## 8. Retensi dan privasi

- Identitas pengguna, sesi kamera, dan event mentah: 7 hari.
- Alert dan audit log: 30 hari.
- Setelah 7 hari, PII pada alert dianonimkan tetapi metadata operasional alert dipertahankan sampai hari ke-30.
- Statistik agregat tanpa identitas boleh disimpan lebih lama.
- Foto dan video dilarang pada request, penyimpanan, dan log.

## 9. Acceptance criteria

- Migration dan seed berhasil pada PostgreSQL kosong.
- Postman dapat menjalankan alur login, pembuatan petugas, ingest, alert, acknowledge, resolve, statistik, dan audit.
- Pengujian lintas stasiun selalu menghasilkan '403'.
- Pengujian dua acknowledge paralel menghasilkan satu sukses dan satu '409'.
- Pengiriman event duplikat tidak membuat record atau alert duplikat.
- Cleanup retensi dapat dibuktikan dengan data uji.
- Unit, integration, Postman/Newman, dan security checks lulus.

## 10. Asumsi

- Capstone memiliki skala kecil, satu instance API utama, dan jumlah akun petugas terbatas.
- API akan dideploy ke internet untuk demo setelah pengembangan lokal selesai.
- Integrasi mobile production belum menjadi bagian implementasi awal.
- Simulator development memakai kredensial khusus yang tidak tersedia pada production.

