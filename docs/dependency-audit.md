# Dependency audit — 9 November 2026

Snapshot hasil pemeriksaan lokal, bukan jaminan bebas kerentanan.

## Perubahan terarah

- Prisma CLI awal `8.0.0-rc.28` disamakan ke `7.10.1`, sesuai Prisma Client `7.10.1`. Belum ada schema/migration yang bergantung pada versi CLI lama.
- Override `lodash@4.18.1` mengatasi dependency transitive yang terpasang pada versi `4.17.21`. [Advisory lodash](https://github.com/advisories/GHSA-r5fr-rjxr-66jc) menyebut perbaikan code injection tersedia mulai `4.18.0`.
- Override `handlebars@4.7.10` mengganti versi transitive lama pada tool Newman. [Advisory Handlebars](https://github.com/advisories/GHSA-p8wg-vrv2-v86f) menyebut perbaikan tersedia di `4.7.10`.
- Override tidak menambahkan kedua package tersebut ke API; entrypoint API tidak menggunakan rendering template atau Newman.

Tidak dilakukan `npm audit fix --force` atau downgrade otomatis ke Newman versi lama. Override perlu dipertahankan hanya sampai upstream memakai versi patched dan diuji ulang ketika dependency diperbarui.

## Hasil

`npm audit --omit=dev`: **0 vulnerabilities**, exit 0.

`npm audit` lengkap: **16 temuan dependency** — 10 High, 6 Moderate, 0 Critical; exit 1. Angka ini adalah jumlah package yang ditandai audit, bukan jumlah bug yang terbukti dapat dieksploitasi melalui endpoint API.

Temuan tersisa berada dalam pohon Newman/Postman development: `@faker-js/faker`, `csv-parse`, `flatted`, `httpntlm`, `jose`, `newman`, `node-forge`, `postman-collection`, `postman-request`, `postman-runtime`, `postman-sandbox`, `qs`, `serialised-error`, `underscore`, `uuid`, dan `uvm`.

Pembatasan saat ini:

- Newman hanya dijalankan lokal melalui script pengujian, tidak dipanggil oleh route Express.
- Collection berasal dari repository ini, tanpa template, CSV, atau script pihak luar.
- Development tools tidak boleh dimasukkan ke image runtime production nantinya. Pemisahan image dan CI masih Task 12; belum dibuktikan dengan build container.
- Snapshot ini bukan validasi semua jalur tool tersebut aman. Temuan development masih harus diselesaikan atau diberi mitigasi/pengecualian terdokumentasi sebelum release gate dinyatakan selesai.

Verifikasi setelah override: jalankan `npm test`, `npm run typecheck`, `npm run build`, `npm run postman:validate`, dan `npm run postman:health` terhadap server lokal. Hasil pengujian health hanya mencakup liveness; tidak membuktikan seluruh fitur Newman kompatibel.
