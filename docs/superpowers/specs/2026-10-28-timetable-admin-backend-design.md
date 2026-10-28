# Timetable Admin Backend — Design Record

**Tanggal:** 28 Oktober 2026  
**Status:** Disetujui untuk diterjemahkan menjadi rencana implementasi  
**Scope:** Backend-only capstone

## Keputusan utama

1. Sistem dibuat dalam repository baru dan tidak mengubah repository Timetable milik dosen.
2. Tahap pertama berfokus pada Express/TypeScript, PostgreSQL, Prisma, SSE, seed data, simulator, Swagger, Postman, dan Newman.
3. Aplikasi mobile dianggap selesai. Integrasi production nanti cukup mengirim event ke API baru dari salinan atau fork yang dikelola pemilik proyek.
4. Super Admin dapat melihat seluruh stasiun. Petugas Stasiun hanya dapat melihat dan menangani data satu stasiun penugasannya.
5. Login dashboard memakai username dan kata sandi.
6. Pengguna mobile mengonfirmasi rekomendasi stasiun terdekat sebelum sesi kamera dicatat.
7. Kamera yang gagal dimulai membuat alert langsung. Tiga kegagalan analisis berturut-turut membuat satu alert untuk sesi tersebut.
8. Status alert adalah 'NEW', 'ACKNOWLEDGED', dan 'RESOLVED'.
9. Foto serta video tidak disimpan. Data identitas dan event mentah disimpan 7 hari; alert dan audit log 30 hari.
10. Backend harus dapat dijalankan lokal melalui Docker dan dapat dideploy ke internet untuk demo.

## Arsitektur pilihan

- REST API untuk operasi data.
- SSE untuk notifikasi satu arah dari backend ke dashboard.
- PostgreSQL sebagai sumber data utama.
- Prisma untuk schema, migration, dan query terparameterisasi.
- Cookie sesi HttpOnly untuk autentikasi dashboard.
- Simulator event untuk pengembangan tanpa ketergantungan pada aplikasi mobile.

## Kriteria keberhasilan

- Petugas tidak dapat membaca atau mengubah data stasiun lain.
- Alert diterbitkan maksimal sekitar lima detik setelah backend menerima event pemicu.
- Dua petugas tidak dapat mengambil alert yang sama.
- Tiga kegagalan analisis menghasilkan tepat satu alert.
- Seluruh alur utama dapat diuji melalui Postman dan dijalankan ulang melalui Newman.
- Tidak ada foto/video di request, database, log, atau response.
- Rilis tidak memiliki kerentanan runtime High/Critical yang relevan dan belum dimitigasi.

## Dokumen rinci

Rincian kebutuhan, data, API, ancaman, keamanan, dan pengujian berada pada dokumen lain di folder 'docs/'.

