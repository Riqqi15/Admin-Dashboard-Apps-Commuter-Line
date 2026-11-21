# Dependency audit — 9 November 2026

Snapshot hasil pemeriksaan lokal, bukan jaminan bebas kerentanan.

## Perubahan terarah

- Prisma CLI awal `8.0.0-rc.28` disamakan ke `7.10.1`, sesuai Prisma Client `7.10.1`. Belum ada schema/migration yang bergantung pada versi CLI lama.
- Override `lodash@4.18.1` mengatasi dependency transitive yang terpasang pada versi `4.17.21`. [Advisory lodash](https://github.com/advisories/GHSA-r5fr-rjxr-66jc) menyebut perbaikan code injection tersedia mulai `4.18.0`.
- Override `handlebars@4.7.10` mengganti versi transitive lama pada tool Newman. [Advisory Handlebars](https://github.com/advisories/GHSA-p8wg-vrv2-v86f) menyebut perbaikan tersedia di `4.7.10`.
- Override tidak menambahkan kedua package tersebut ke API; entrypoint API tidak menggunakan rendering template atau Newman.

Tidak dilakukan `npm audit fix --force` atau downgrade otomatis ke Newman versi lama. Override perlu dipertahankan hanya sampai upstream memakai versi patched dan diuji ulang ketika dependency diperbarui.

## Pembaruan 21 November 2026

Audit ulang dengan advisory terbaru:

- `npm audit --omit=dev --omit=optional` (flag yang sama dengan instalasi image produksi di `Dockerfile`): **0 vulnerabilities**, exit 0. Ini yang dipakai gate CI.
- `npm audit --omit=dev`: **3 High**, exit 1 — `effect <=3.22.0` ([GHSA-7589-6fvf-x4pw](https://github.com/advisories/GHSA-7589-6fvf-x4pw), ReDoS pada regex `Schema.TemplateLiteral`), terpasang `effect@3.20.0` lewat `prisma@7.10.1` → `@prisma/config`. Paket `prisma` ada karena peer opsional `@prisma/client`.
- Triase reachability: `effect` dan `prisma` **tidak ada** pada image runtime (diperiksa dengan `ls node_modules` di container). API tidak mengimpor `effect`; hanya Prisma CLI (migration/generate pada mesin/CI/build dengan schema milik repository ini) yang memuatnya, tanpa input pengguna. Dampak runtime: tidak terjangkau.
- Tidak dilakukan `npm audit fix --force` (akan menurunkan Prisma ke 6.12.0, perubahan breaking). Pantau rilis Prisma yang memperbarui `effect`; setelah itu perbarui `prisma`/`@prisma/client` bersamaan dan jalankan ulang seluruh tes.
- `npm audit` lengkap: **19 temuan** (13 High, 6 Moderate, 0 Critical), seluruhnya pada tooling development (Newman/Postman dan Prisma CLI).

## Hasil (9 November 2026, dipertahankan sebagai riwayat)

`npm audit --omit=dev`: **0 vulnerabilities**, exit 0.

`npm audit` lengkap: **16 temuan dependency** — 10 High, 6 Moderate, 0 Critical; exit 1. Angka ini adalah jumlah package yang ditandai audit, bukan jumlah bug yang terbukti dapat dieksploitasi melalui endpoint API.

Temuan tersisa berada dalam pohon Newman/Postman development: `@faker-js/faker`, `csv-parse`, `flatted`, `httpntlm`, `jose`, `newman`, `node-forge`, `postman-collection`, `postman-request`, `postman-runtime`, `postman-sandbox`, `qs`, `serialised-error`, `underscore`, `uuid`, dan `uvm`.

Pembatasan saat ini:

- Newman hanya dijalankan lokal melalui script pengujian, tidak dipanggil oleh route Express.
- Collection berasal dari repository ini, tanpa template, CSV, atau script pihak luar.
- Development tools tidak boleh dimasukkan ke image runtime production nantinya. Pemisahan image dan CI masih Task 12; belum dibuktikan dengan build container.
- Snapshot ini bukan validasi semua jalur tool tersebut aman. Temuan development masih harus diselesaikan atau diberi mitigasi/pengecualian terdokumentasi sebelum release gate dinyatakan selesai.

Verifikasi setelah override: jalankan `npm test`, `npm run typecheck`, `npm run build`, `npm run postman:validate`, dan `npm run postman:health` terhadap server lokal. Hasil pengujian health hanya mencakup liveness; tidak membuktikan seluruh fitur Newman kompatibel.
