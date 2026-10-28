# Visual Database Design

Diagram ini menggambarkan database backend Admin Dashboard Timetable.

![Timetable Admin ERD](diagrams/timetable-admin-erd.svg)

## File diagram

- Source Mermaid: [timetable-admin-erd.mmd](diagrams/timetable-admin-erd.mmd)
- Gambar SVG: [timetable-admin-erd.svg](diagrams/timetable-admin-erd.svg)
- Gambar PNG: [timetable-admin-erd.png](diagrams/timetable-admin-erd.png)

## Catatan relasi

- Satu Petugas Stasiun hanya ditugaskan ke satu stasiun.
- Super Admin tidak memiliki 'station_id'.
- Satu stasiun dapat mempunyai beberapa petugas, sesi kamera, alert, dan statistik harian.
- Satu sesi kamera mempunyai banyak event dan maksimal satu alert.
- Foto atau video kamera tidak disimpan.
- PII pengguna disimpan terenkripsi dan mengikuti retensi tujuh hari.

