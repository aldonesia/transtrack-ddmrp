# Gap analysis — IDAS (DDMRP)

Dokumen ini merangkum **apa yang sudah cukup** untuk pengguna dan **apa yang masih kurang**, setelah implementasi Master Data, Analytics (RUN 2–4), Replenishment, Purchase Order operasional, dokumentasi, integrasi API, scheduler harian, dan panel zona di Replenishment.

**Profil pengguna acuan:** tim operasional (gudang/perencanaan) + tim IT integrasi + konteks teaching/pilot.

**Tanggal acuan:** 2026-05-15

---

## Ringkasan eksekutif

| Aspek | Status |
|-------|--------|
| Demo / teaching / pilot internal | **Layak** |
| Operasi harian tanpa kejutan | **Belum lengkap** |
| Produksi terbuka (internet) | **Perlu P0** (auth, PO, buffer vs scheduler) |

**Satu kalimat:** Untuk belajar dan pilot aplikasi sudah cukup; untuk operasi harian dan produksi, yang paling kurang adalah **siklus PO lengkap di UI**, **perilaku jelas saat buffer/scheduler di-run ulang**, dan **keamanan + visibilitas scheduler**.

---

## Yang sudah cukup kuat

| Area | Keterangan |
|------|------------|
| Pipeline DDMRP hybrid | Forecast → GA/buffer → replenishment, selaras notebook |
| Purchase order | Create + confirm via modal (konfirmasi manual) |
| Dokumentasi | [USER_MANUAL.md](./USER_MANUAL.md), [INSTALLATION.md](./INSTALLATION.md), [INTEGRATION_API_MANUAL.md](./INTEGRATION_API_MANUAL.md) |
| Dashboard | KPI, prioritas merah, ringkasan operasional |
| Replenishment | Tabel jadwal, Create PO per baris RED/YELLOW, export CSV, recalc |
| Panel zona | Klik widget Red/Yellow/Green → daftar SKU (`sku_by_zone` di dashboard API) |
| Integrasi | `integration/run`, `integration/result`, `integration/replenishment` |
| Infrastruktur | Docker compose, reset DB, impor `Data 2.xlsx` |
| Scheduler | RUN 2+3 otomatis jam 01:00 (env) |

---

## Gap analysis (prioritas)

### P0 — Operasional harian & kepercayaan data

#### G1. PO vs run ulang buffer / scheduler malam

**Status:** Didokumentasikan di [USER_MANUAL.md § PO dan run ulang buffer](./USER_MANUAL.md#po-dan-run-ulang-buffer); **belum diperbaiki di kode**.

| Gejala | Penyebab teknis |
|--------|------------------|
| On Hand “melompat” setelah jam 01:00 atau Run full pipeline | `seed_operational_state_for_buffer` reset OH = TOY baru |
| Open order > 0 tapi daftar PO kosong di UI | `confirmed_pos` filter `buffer_id` buffer aktif; PO lama mengacu buffer archived |
| KPI Confirmed PO tidak selaras | Filter `order_date` dalam jendela buffer baru |

**Dampak user:** bingung; keputusan order berdasarkan angka yang tampak kontradiktif.

**Target perbaikan (usulan):**

- Pertahankan OH operasional jika ada PO `confirmed` aktif, **atau**
- Tampilkan semua PO confirmed per SKU (tanpa filter `buffer_id` ketat), **dan**
- Setelah nightly: opsi recalc otomatis / banner “buffer di-refresh malam ini”.

---

#### G2. Siklus PO lengkap di UI

**Status:** API ada (`receive`, `cancel`); **UI belum**.

| Aksi | API | UI |
|------|-----|-----|
| Create + confirm | Ya | Ya |
| Receive barang | Ya | Tidak |
| Cancel PO | Ya | Tidak |

**Dampak user:** PO salah tidak bisa ditutup tanpa curl/Postman; penerimaan barang tidak memperbarui OH lewat aplikasi.

**Target perbaikan:** tombol Receive / Cancel di riwayat PO Replenishment + refresh plan & dashboard.

---

#### G3. Keamanan & multi-user

**Status:** Tidak ada login, role, audit siapa melakukan aksi.

**Dampak user:** siapa pun dengan URL produksi bisa mengubah master, confirm PO, trigger pipeline.

**Target perbaikan (minimal):** autentikasi dasar (session/JWT), role viewer vs operator vs admin; opsional audit log PO.

---

### P1 — Transparansi & kontrol scheduler

#### G4. Visibilitas job malam (01:00)

**Status:** `GET /api/analytics/nightly-status` + record `nightly_job_run`; UI terbatas.

**Kurang di UI:**

- Waktu mulai/selesai, durasi
- Jumlah SKU sukses / gagal + daftar SKU gagal
- Peringatan jika job belum pernah jalan

**Dampak user:** angka berubah “sendiri” tanpa penjelasan.

**Target perbaikan:** panel di Dashboard; link ke log/detail gagal.

---

#### G5. Kebijakan scheduler vs PO

**Status:** Scheduler menjalankan `post_run` semua SKU aktif; tidak skip SKU dengan PO confirmed.

**Dampak user:** konflik dengan G1 setiap malam untuk banyak SKU.

**Target perbaikan (usulan):** env `NIGHTLY_SKIP_SKU_WITH_OPEN_PO`, atau tidak reset OH jika OP > 0.

---

### P2 — Onboarding, data, integrasi

#### G6. Onboarding & validasi upload

**Kurang:**

- Wizard langkah 1–4 (Master SKU → Demand → Analytics → Replenishment)
- Pesan error Excel per baris/kolom
- Indikator “forecast usang” (usia `ForecastRun` terakhir)

**Dampak user:** banyak tanya support di awal pakai.

---

#### G7. Integrasi ERP / sistem eksternal

**Sudah ada:** [INTEGRATION_API_MANUAL.md](./INTEGRATION_API_MANUAL.md).

**Kurang:**

- Koleksi Postman / contoh skrip uji resmi
- Webhook atau notifikasi zona RED
- Panduan idempotensi & retry `integration/run`
- SLA / timeout untuk GA per SKU (45 SKU × GA bisa lama)

---

#### G8. Pelaporan & audit

**Sudah ada:** export CSV PO (saran + confirmed).

**Kurang:**

- PDF purchase order
- Ringkasan harian (email/digest)
- Audit trail: siapa confirm PO, kapan

---

### P3 — Produksi & kualitas engineering

#### G9. Migrasi database

**Status:** `create_all` + `schema_migrate.py` ringan; belum Alembic.

**Dampak:** risiko skema drift di Postgres produksi jangka panjang.

---

#### G10. Pengujian otomatis

**Status:** ~23 unit test backend; `tsc` frontend; tidak ada E2E UI.

**Kurang:** tes integrasi nightly, tes PO setelah pipeline, tes `sku_by_zone`.

---

#### G11. Monitoring & operasi

**Kurang:**

- Health check terdokumentasi untuk load balancer
- Log terpusat / alert jika nightly `failed` atau `partial_success`
- Metrik durasi per SKU pada job malam

---

### P4 — Nice to have (bukan blocker pilot)

| ID | Item | Catatan |
|----|------|---------|
| N1 | Batch create PO (“execute all” dengan konfirmasi per SKU) | Tombol lama sengaja dihapus; perlu desain ulang |
| N2 | `initial_on_hand` per SKU di master | OH tidak selalu = TOY |
| N3 | Partial receipt / split line PO | Out of scope rencana awal |
| N4 | UI bahasa Indonesia | Manual ID, UI EN — pilih satu atau i18n |
| N5 | Multi-gudang / multi-unit | Saat ini satu unit PCS/EA |
| N6 | Parity checklist otomatis vs notebook | Parity snapshot manual di Analytics |

---

## Matriks prioritas (rekomendasi 2–4 minggu)

| Prioritas | Gap | Effort kasar | Manfaat user |
|-----------|-----|--------------|--------------|
| **P0** | G2 — Receive/Cancel PO di UI | 1–2 hari | Operasi harian tanpa API |
| **P0** | G1 — PO vs run ulang buffer | 2–3 hari | Kepercayaan data setelah scheduler |
| **P0** | G3 — Auth dasar | 2–5 hari | Aman di produksi |
| **P1** | G4 — Status scheduler di Dashboard | 1 hari | Transparansi jam 01:00 |
| **P1** | G5 — Kebijakan nightly vs PO | 1–2 hari | Kurangi efek samping malam |
| **P2** | G6 — Onboarding + error upload | 2–3 hari | Kurangi support |
| **P2** | G7 — Postman + skenario integrasi | 1–2 hari | IT go-live |
| **P2** | G8 — Audit / PDF PO | 2+ hari | Enterprise readiness |
| **P3** | G9–G11 — Alembic, tes, monitoring | berkelanjutan | Stabilitas jangka panjang |

---

## Checklist verifikasi manual (belum lengkap di repo)

Rujukan: [IMPLEMENTATION_PLAN_OPEN_ORDER.md](../resources_ext/IMPLEMENTATION_PLAN_OPEN_ORDER.md) § Definition of done.

- [ ] Satu SKU uji end-to-end dari `Data 2.xlsx`: run → replenishment → PO → recalc → run ulang → cek G1
- [ ] Nightly `nightly-run-now` dengan N SKU aktif: catat durasi & partial failure
- [ ] Integrasi: `integration/run` + `integration/replenishment` untuk 1 SKU
- [ ] Klik widget zona → daftar SKU → pilih baris → jadwal ter-load
- [ ] Produksi: CORS + URL [USER_MANUAL](./USER_MANUAL.md) / [INTEGRATION_API_MANUAL](./INTEGRATION_API_MANUAL.md)

---

## Profil user & fokus backlog

### Jika user utama = **gudang / perencanaan**

Fokus: **G1, G2, G4, G6** — data yang konsisten, PO selesai di UI, scheduler terjelaskan.

### Jika user utama = **IT integrasi**

Fokus: **G7, G3, G9** — API stabil, auth, migrasi, dokumentasi uji.

### Jika user utama = **teaching only**

Fokus: **G6, N6** — onboarding & parity notebook; P0 produksi bisa ditunda.

---

## Dokumen terkait

| Dokumen | Isi |
|---------|-----|
| [USER_MANUAL.md](./USER_MANUAL.md) | Panduan operasional + PO vs run ulang |
| [INSTALLATION.md](./INSTALLATION.md) | Docker, reset DB |
| [INTEGRATION_API_MANUAL.md](./INTEGRATION_API_MANUAL.md) | API eksternal |
| [../README.md](../README.md) | Referensi teknis |
| [../resources_ext/IMPLEMENTATION_PLAN_OPEN_ORDER.md](../resources_ext/IMPLEMENTATION_PLAN_OPEN_ORDER.md) | Rencana PO P1–P3 |

---

## Riwayat dokumen

| Tanggal | Perubahan |
|---------|-----------|
| 2026-05-15 | Versi awal — ringkasan gap pasca implementasi PO, docs, UI replenishment |
