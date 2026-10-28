# Threat Model — Timetable Admin Backend

## Executive summary

Risiko terbesar berasal dari API yang dapat diakses internet: pengambilalihan akun admin, broken access control lintas stasiun, event ingest palsu yang memicu dispatch petugas, kebocoran PII melalui response/log/SSE, serta denial of service pada endpoint login, ingest, dan koneksi SSE. Repository masih berada pada tahap desain; seluruh kontrol di bawah adalah persyaratan terencana dan belum dapat dianggap sudah diterapkan.

## Scope and assumptions

**In scope:** backend Express/TypeScript yang direncanakan, PostgreSQL/Prisma, sesi admin, REST API, SSE, simulator development, cleanup worker, Postman/Newman, dan deployment internet demo. Evidence desain berada pada 'docs/architecture.md', 'docs/api-specification.md', 'docs/database-design.md', dan 'docs/security-checklist.md'.

**Out of scope:** repository aplikasi Timetable milik dosen, implementasi mobile, web dashboard, model deteksi objek, jaringan dan proses internal stasiun nyata, serta pengiriman WhatsApp/SMS.

**Asumsi:**

- Sistem capstone berskala kecil dan menjalankan satu instance API.
- API production/demo dapat dijangkau dari internet melalui HTTPS.
- Hanya Super Admin dan Petugas Stasiun yang mempunyai akun dashboard.
- Data pengguna berisi PII minimum: external ID, nama, dan telepon.
- Simulator dan seed hanya tersedia pada development.
- Kontrol yang disebutkan adalah target implementasi, bukan kontrol existing yang sudah diverifikasi.

**Open questions yang dapat mengubah ranking:** penyedia hosting/reverse proxy, mekanisme token integrasi mobile production, jumlah pengguna/petugas sebenarnya, serta kebutuhan compliance organisasi.

## System model

### Primary components

- Express API: entry point, autentikasi, RBAC, validasi, business rules, dan SSE.
- PostgreSQL melalui Prisma: penyimpanan state dan transaksi.
- Admin client masa depan: login, REST, dan SSE.
- Simulator/future mobile client: pengirim event ingest.
- Cleanup worker: anonimisasi dan penghapusan berdasarkan retensi.
- CI/Postman/Newman: build dan acceptance test.

### Data flows and trust boundaries

- Internet → API: username/password, cookie sesi, CSRF token, query/filter, serta mutasi alert melalui HTTPS; wajib autentikasi, rate limit, origin checks, dan schema validation.
- Ingest client → API: external user, stasiun, sesi, event, dan timestamp melalui HTTPS; wajib autentikasi ingest, idempotency, replay protection, rate limit, dan validation.
- API → PostgreSQL: PII terenkripsi, session hash, event, alert, audit, dan aggregate melalui koneksi database berprivilege minimum dan Prisma.
- API → Admin client: JSON serta SSE; payload wajib difilter berdasarkan role/stasiun dan tidak memuat PII yang tidak diperlukan.
- Cleanup worker → PostgreSQL: delete/anonymize terjadwal; akun/stasiun tidak boleh ikut terhapus.
- Developer/CI → build/deployment: source, dependency, environment, dan migration; secret tidak boleh masuk repository atau log CI.

#### Diagram

~~~mermaid
flowchart LR
    Internet["Internet clients"] -->|HTTPS| API["Express API"]
    Ingest["Simulator or mobile"] -->|HTTPS events| API
    API -->|Prisma| DB["PostgreSQL"]
    API -->|REST and SSE| Internet
    Worker["Cleanup worker"] -->|Retention| DB
    CI["CI and Newman"] -->|Build and tests| API
~~~

## Assets and security objectives

| Asset | Why it matters | Security objective (C/I/A) |
|---|---|---|
| Admin credentials and sessions | Pengambilalihan memberi akses operasional | C, I |
| PII pengguna | Kebocoran nama/telepon merugikan privasi | C |
| Station assignment and RBAC | Menentukan batas akses petugas | I |
| Camera sessions and events | Menjadi dasar statistik dan alert | I, A |
| Alert lifecycle | Dispatch serta bukti penanganan | I, A |
| Audit logs | Investigasi tindakan admin/petugas | I, A |
| Database encryption key and secrets | Kebocoran membuka PII/sesi/infrastruktur | C, I |
| API/SSE availability | Dibutuhkan agar alert dapat diterima | A |
| Build and deployment artifacts | Supply-chain compromise dapat mengambil alih server | C, I, A |

## Attacker model

### Capabilities

- Penyerang internet dapat mengirim request ke endpoint publik dan mencoba credential stuffing, fuzzing, replay, serta DoS tingkat aplikasi.
- Pengguna terautentikasi sebagai petugas dapat memodifikasi ID/query untuk mencoba mengakses stasiun lain.
- Penyerang dapat memperoleh payload/ID yang pernah terlihat pada perangkat atau log yang bocor.
- Dependency berbahaya atau rentan dapat masuk melalui supply chain bila tidak ditinjau.

### Non-capabilities

- Tidak diasumsikan memiliki akses shell, database, secret production, atau akun cloud.
- Tidak diasumsikan dapat mengubah repository mobile milik dosen.
- Tidak diasumsikan mempunyai akses fisik atau jaringan internal stasiun.
- Serangan terhadap model deteksi gambar berada di luar scope karena media/model tidak diproses backend ini.

## Entry points and attack surfaces

| Surface | How reached | Trust boundary | Notes | Evidence |
|---|---|---|---|---|
| Login/session API | Internet HTTPS | Internet → API | Brute force, fixation, cookie theft | 'docs/api-specification.md' Authentication |
| Staff/station API | Authenticated REST | Admin → API | Privilege escalation, mass assignment | 'docs/api-specification.md' Stations dan staff |
| Ingest API | Internet HTTPS | Ingest client → API | Forgery, replay, event flood | 'docs/api-specification.md' Ingest sesi dan event |
| Alert API | Authenticated REST | Admin → API | BOLA, invalid transitions, race | 'docs/api-specification.md' Alerts |
| SSE | Authenticated connection | API → Admin | Cross-station leakage, connection exhaustion | 'docs/architecture.md' SSE |
| Analytics/audit | Authenticated REST | Admin → API | PII leakage, expensive queries | 'docs/api-specification.md' Analytics dan audit |
| PostgreSQL | Internal network | API/worker → DB | Injection, overprivilege, data theft | 'docs/database-design.md' |
| Cleanup worker | Scheduled process | Worker → DB | Accidental over-deletion | 'docs/architecture.md' Components |
| CI/dependencies | Developer/CI | Supply chain → runtime | Malicious/outdated package, secret leak | 'docs/security-checklist.md' Dependency dan release |

## Top abuse paths

1. Penyerang melakukan credential stuffing pada login → memperoleh sesi petugas/Super Admin → membaca PII atau mengubah alert.
2. Petugas mengubah station ID atau resource UUID → backend gagal menerapkan station scope → data stasiun lain terbuka atau berubah.
3. Penyerang memalsukan/replay event kegagalan → alert palsu terbentuk → petugas terdistraksi dan statistik rusak.
4. Situs jahat mengirim request dengan cookie admin → endpoint mutasi tanpa CSRF/origin check → akun atau alert diubah.
5. Petugas membuka SSE dengan parameter stasiun lain → filter hanya dilakukan client-side → menerima alert/PII lintas stasiun.
6. Dua petugas acknowledge bersamaan → update non-atomik → kepemilikan alert ambigu dan audit tidak konsisten.
7. Penyerang mengirim payload besar/rentang analytics luas/membuka banyak SSE → resource server/database habis → alert terlambat.
8. Error/log mencatat cookie, token, atau nomor telepon → operator/log service yang tidak semestinya memperoleh data sensitif.
9. Dependency runtime rentan atau kompromi supply chain → eksekusi kode atau pencurian secret saat build/runtime.

## Threat model table

| Threat ID | Threat source | Prerequisites | Threat action | Impact | Impacted assets | Existing controls (evidence) | Gaps | Recommended mitigations | Detection ideas | Likelihood | Impact severity | Priority |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| TM-001 | Remote attacker | Login internet exposed dan password lemah/berulang | Credential stuffing atau brute force | Account takeover | Credentials, PII, alerts | Planned requirements in 'docs/security-checklist.md' | Belum ada kode/rate limit terverifikasi | Argon2id, throttling per IP+username, generic errors, session revocation, strong temporary-password flow | Failed-login counters, lockout/rate-limit metrics | High | High | high |
| TM-002 | Malicious/compromised station staff | Memiliki sesi petugas valid | Mengganti resource ID atau station filter | Cross-station read/write | PII, RBAC, alerts | Station scoping planned in 'docs/architecture.md' | Belum ada centralized authorization guard | Enforce station scope in service/query, deny client-selected scope, BOLA tests on every resource | Log denied cross-station attempts | Medium | High | high |
| TM-003 | Remote attacker or forged client | Ingest auth/replay protection lemah | Mengirim/replay event palsu hingga alert dibuat | False dispatch, data integrity loss, DoS | Events, alerts, availability | Idempotency/replay design in 'docs/api-specification.md' | Production mobile trust mechanism unresolved | Trusted token strategy, timestamp window, unique IDs, payload fingerprint, rate limits, source attribution | Duplicate/replay counters, alert-volume anomaly | High | High | high |
| TM-004 | Malicious website | Admin browser memiliki cookie aktif | Memicu mutasi tanpa consent | Staff/alert state changed | Accounts, alerts | CSRF/origin controls planned in 'docs/security-checklist.md' | Belum diimplementasikan | CSRF token, Origin validation, SameSite cookie, narrow CORS | CSRF rejection logs | Medium | High | high |
| TM-005 | Authenticated staff | SSE accepts client station parameter or broad subscription | Subscribe ke event stasiun lain | Real-time PII/alert leakage | PII, alerts | SSE scoping planned in 'docs/architecture.md' | Belum ada handler yang dapat diuji | Derive station from session, minimize SSE payload, REST reauthorization for details | Subscription audit and cross-station tests | Medium | High | high |
| TM-006 | Concurrent legitimate clients | Alert NEW dilihat beberapa petugas | Race acknowledge menghasilkan dua owner | Operational confusion, inconsistent audit | Alerts, audit | Conditional update planned in 'docs/database-design.md' | Belum ada transaction test | Atomic conditional update/transaction, unique invariant, return 409 | Metric for acknowledge conflicts | Medium | Medium | medium |
| TM-007 | Remote attacker | Input reaches query/log/output unsafely | Injection, stored XSS payload, atau log forging | Data compromise or operator deception | DB, audit, admin client | Prisma/schema validation planned | Implementasi belum ada | Strict schemas, parameterized ORM, safe rendering contract, structured logs | Validation-error and suspicious-input metrics | Medium | High | high |
| TM-008 | Attacker or accidental operator | Sensitive data appears in response/error/log/backups | Exfiltrate PII/session/secret | Privacy and account compromise | PII, sessions, secrets | Encryption/redaction/retention planned | Key management and hosting controls unresolved | Application encryption, log redaction tests, least privilege, encrypted backups, retention jobs | Secret scanning, canary tests, access-log review | Medium | High | high |
| TM-009 | Remote attacker | Public endpoints lack resource limits | Flood login, ingest, analytics, or SSE | API unavailable, delayed alerts | Availability | Rate/body/range limits planned | Hosting capacity/proxy config unknown | Layered rate limits, body/range caps, server timeouts, connection quotas, reverse proxy | Latency, saturation, open-SSE metrics | High | Medium | medium |
| TM-010 | Supply-chain attacker | Vulnerable/malicious dependency enters build | Execute code or steal secrets | Full service compromise | Runtime, secrets, DB | Lockfile/scanning planned | No CI exists yet | Minimal dependencies, maintained versions, lockfile, review advisories, CI SCA, no automatic unreviewed major upgrade | Dependency alerts, build provenance review | Medium | High | high |
| TM-011 | Cleanup bug/operator mistake | Retention query too broad | Delete accounts/stations or needed evidence | Data loss | Accounts, stations, audit | Retention scope planned in 'docs/test-plan.md' | No backup/restore proof yet | Explicit table filters, dry-run count, transaction, backup, retention integration test | Deletion-count alerts and audit record | Low | High | medium |

## Criticality calibration

**Critical:** pre-auth remote code execution; authentication bypass to Super Admin; theft of database/encryption secrets enabling broad PII compromise.

**High:** cross-station PII exposure; forged ingest causing systematic false dispatch; persistent account takeover; supply-chain compromise with runtime access.

**Medium:** bounded DoS; double assignment of individual alerts; cleanup failure recoverable from backup; limited audit-log manipulation.

**Low:** low-sensitivity metadata disclosure; noisy invalid requests with no operational impact; UI-only issue without authorization impact.

## Focus paths for security review

| Path | Why it matters | Related Threat IDs |
|---|---|---|
| 'src/middleware/auth*' | Session validation, CSRF, dan role enforcement | TM-001, TM-004 |
| 'src/middleware/station*' | Central station scoping | TM-002, TM-005 |
| 'src/routes/ingest*' | Internet-facing untrusted event boundary | TM-003, TM-007, TM-009 |
| 'src/services/alert*' | Threshold, deduplication, state transitions, race | TM-003, TM-006 |
| 'src/routes/stream*' | SSE authentication, filtering, connection limits | TM-005, TM-009 |
| 'src/services/analytics*' | Query range dan station scope | TM-002, TM-009 |
| 'src/workers/retention*' | Destructive cleanup and anonymization | TM-008, TM-011 |
| 'src/config/*' | Secrets, proxy, cookie, CORS, dan production flags | TM-001, TM-004, TM-008, TM-009 |
| 'prisma/schema.prisma' | Constraints supporting authorization and integrity | TM-002, TM-006, TM-011 |
| 'postman/' and 'tests/security/' | Evidence bahwa negative security cases enforced | TM-001 through TM-011 |
| 'package.json' and lockfile | Runtime dependency and scripts | TM-010 |
| Deployment configuration | HTTPS, proxy trust, Swagger/simulator exposure | TM-004, TM-008, TM-009 |

## Quality check

- [x] Login, staff/station, ingest, alert, analytics, audit, SSE, database, cleanup, dan CI entry points covered.
- [x] Every trust boundary appears in at least one abuse path/threat.
- [x] Runtime, development simulator, test tooling, dan CI are separated.
- [x] User clarification for local plus internet deployment is reflected.
- [x] Unresolved production mobile authentication and hosting details are explicit.
- [x] Planned controls are not misrepresented as implemented controls.

## Notes on use

Threat model ini harus diperbarui setelah route, middleware, schema, dan deployment configuration benar-benar ada. Priority dapat berubah berdasarkan hosting, jumlah pengguna, serta mekanisme autentikasi integrasi mobile.

