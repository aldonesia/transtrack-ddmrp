# Fase 0 — Audit & baseline (Notebook ↔ Data 2.xlsx ↔ DB ↔ Services ↔ API ↔ UI)

**Tanggal baseline:** 2026-05-12  
**Revisi dokumen:** 2026-05-12 — README parity mengacu **Last Version**; penyesuaian status gap Fase 1 (tanpa mengubah kode impor otomatis penuh). **2026-05-15:** **`resources_ext/Mockup.pdf`** di repo sebagai acuan mockup UI / UAT (§0.4). **Revisi kode:** 2026-05-12 — `_parse_date` mendukung **serial tanggal Excel** pada upload demand/master (rentang ~1970+). **Revisi Fase 1 (2026-05-12):** template/validator/export master & demand selaras **`Data 2.xlsx`**; kolom opsional `sku_master` + migrasi additive di startup; template `GET /api/master/template/demand-data2`.

**Artefak:** `DDMRP_Hybrid_Algorithm_Last_Version.ipynb`, `Data 2.xlsx`, **`Mockup.pdf`** (mockup UI), `Mockup.docx` (sumber), kode `backend/`, `frontend/`, `README.md`.

**Catatan file:** `tmp_sheet1.xml` di root repo berisi contoh master lama (FMCG). Workbook **`resources_ext/Data 2.xlsx`** saat ini berbeda (spare part). Audit di bawah mengacu pada **`Data 2.xlsx`** yang dipakai di path resmi.

**Kebijakan unit (2026-05-12):** aplikasi memakai **satu unit PCS** end-to-end; tidak ada konversi karton. Kolom DB `pack_size` / `qty_per_carton` tetap ada untuk kompatibilitas tetapi diset **1** dan tidak diekspos di API/UI.

---

## 0.1 Inventory notebook — Last Version

Blok utama (urutan logis pipeline) dan fungsi/kelas yang menjadi acuan porting:

| # | Area | Fungsi / kelas (cuplikan dari sel) |
|---|------|-------------------------------------|
| 1 | Load data | `load_all_data`, `get_sku_list`, `get_sku_demand`, `get_sku_params` |
| 2 | Metrik & baseline | `compute_metrics`, `naive_mae` |
| 3 | Model statistik | `forecast_ma`, `forecast_ses`, `forecast_holt`, `forecast_holtwinters`, `forecast_croston`, helper `mse`/`sse`/`hw` |
| 4 | Preprocessing & fitur ML | `clean_demand_adaptive`, `make_features`, `split_xy` |
| 5 | Model ML & ensemble | `run_elasticnet`, `run_hgb`, `run_rf`, `run_mlp`, `run_dow_en`, `run_ensemble_ga`, `run_forecast` |
| 6 | Klasifikasi | `classify_sku` |
| 7 | Simulasi & GA | `round_up_pack`, `simulate_ddmrp`, `GeneticOptimizer` (`__init__`, `_rand`, `_fit`, `run`) |

**Mapping implementasi (target konsolidasi):** `backend/services/hybrid_forecast.py`, `hybrid_optimizer.py`, `hybrid_pipeline.py`, plus `db_dataset.py` untuk frame kompatibel loader notebook.

---

## 0.2 `Data 2.xlsx` — sheet, kolom, vs DB

### Sheet `sales` (sheet1)

| Kolom Excel | Contoh / catatan | `DailyRecord` / `SKUMaster` | Status |
|-------------|------------------|----------------------------|--------|
| `ID Item` | SKU | `DailyRecord.sku` | OK |
| `Nama Item` | Deskripsi | `SKUMaster.nama_item` (via join upload) | OK jika master punya nama |
| `Date` | Serial Excel (mis. 45810) | `DailyRecord.date` | **OK (upload app):** `api/master._parse_date` menginterpretasi serial Excel (≥ ~1970) sebelum `pd.to_datetime`; tanggal ISO/string tetap didukung. |
| `Demand ` | Spasi di akhir nama kolom | `DailyRecord.demand` (PCS) | **OK (upload app):** `_normalize_column_map` mem-*strip* nama kolom → kandidat `demand` cocok untuk `Data 2.xlsx` / template. |
| `Sales Price Price After Discont` | Harga | Bukan kolom harian di DB; dipakai dari `SKUMaster.harga` di `db_dataset` | OK untuk pipeline saat ini |
| `Promo Discount` | Angka | Map ke `DailyRecord.promo_discount` bersama varian header lain | **OK (Fase 1):** `_coerce_demand_upload` memetakan `Promo Discount` / `Promo_Discount` / `PromoDiscountPct` |
| `IsPromo` | 0/1 | Derive / `promo_discount > 0` di frame | OK |
| `PromoDiscountPct` | | `DailyRecord.promo_discount` | OK |
| `PromoType` | NONE | Tidak ada di DB; di frame jadi `"NONE"` | OK (konstanta) |

### Sheet `sku_master` (sheet2)

| Kolom Excel | `SKUMaster` | Status |
|-------------|-------------|--------|
| `Material Number` | `sku` | OK |
| `Material Description` | `nama_item` (parsial) | OK — upload template Data 2 |
| `Material Group` | `group` | OK |
| `Unit` | `unit` | OK |
| `Criticality`, `ABC Class`, `XYZ Class`, `Vendor Type`, `Currency` | `criticality`, `abc_class`, `xyz_class`, `vendor_type`, `currency` | **OK (Fase 1):** kolom opsional di `SKUMaster` + template/upload |
| `Lead Time_Days` | `lead_time` | OK |
| `MOQ` | `moq` | OK |
| `Sales Price` | `harga` | OK |
| `Purchase Price` | `purchase_price` | OK |
| `Holding Cost Rate/day` | `holding_cost_rate_day` | OK |
| `Holding Cost/day (IDR)` | `holding_cost_day_idr` | **OK (Fase 1):** kolom opsional tersimpan |
| `Lost Sale Rate/Each` | `lost_sale_rate_each` | OK |
| `Penalty/unit (IDR)` | `penalty_per_unit_idr` | **OK (Fase 1):** kolom opsional tersimpan (pipeline hybrid utama belum wajib memakai nilai ini) |
| `Logistic Cost/Order` | `logistic_cost_order` | OK |
| *(tidak dipakai)* | `pack_size` (legacy, nilai 1) | **N/A** — bukan kontrak Excel untuk workbook ini |

---

## 0.3 `README.md` vs kode — ringkas

| Fitur (README) | Di kode | Status |
|----------------|---------|--------|
| Satu unit PCS (demand + forecast + DDMRP) | `unit: PCS` di response; `ForecastRun.qty_per_carton=1` legacy DB | **Implemented** (2026-05-12) |
| Template / upload master & demand | `api/master.py` | **Implemented (Fase 1)** — template master urutan **`sku_master` Data 2**; template demand **`sales`** via `template/demand-data2`; validator menerima header alias |
| `POST /api/analytics/run`, `GET .../latest-run` | `api/analytics.py` | **Implemented** |
| Integrasi `sku_no` run / result / replenishment | `api/analytics.py` | **Implemented** |
| Scheduler 01:00, `nightly-status`, `nightly-run-now` | `main.py` + `NightlyJobRun` | **Implemented** |
| `GET /api/dashboard-summary` | `main.py` | **Implemented** |
| `GET /api/analytics/parity-snapshot` | `api/analytics.py` | **Implemented** (perlu golden fixture + toleransi) |
| Parity UAT di `README.md` (judul + langkah banding notebook) | Mengacu `resources_ext/DDMRP_Hybrid_Algorithm_Last_Version.ipynb` | **Implemented** (revisi dokumen 2026-05-12) |
| `POST /api/optimize-buffer` | `main.py` | **Partial / legacy** — jalur terpisah dari hybrid pipeline; verifikasi masih dipakai UI |
| Dokstring `analytics.py` | Sudah merujuk Last Version + PCS | **Implemented** |

---

## Revisi & status gap (poin 2)

### Ditutup / diperbarui pada revisi dokumen ini

- **README parity:** section *Parity Check* dan langkah UAT memakai **`DDMRP_Hybrid_Algorithm_Last_Version.ipynb`** (bukan `…_Versi 2.ipynb`).
- **Header kolom `Demand ` (spasi):** untuk upload lewat `api/master`, `_normalize_column_map` mem-*strip* nama kolom sehingga kandidat `demand` terdeteksi — selaras dengan bentuk `Data 2.xlsx` / template.
- **Tanggal serial Excel** pada upload demand/master: `backend/api/master.py` → `_parse_date` (serial ≥ 25569 ≈ 1970-01-01, origin 1899-12-30); di luar rentang itu tetap lewat `pd.to_datetime`.

### Masih terbuka (setelah Fase 1 data)

- **Parity otomatis penuh:** fixture golden dari notebook + tes vs `parity-snapshot` (saat ini: tes unit untuk **helper upload** di `backend/tests/` + UI menampilkan JSON snapshot).
- **`POST /api/optimize-buffer`:** dokumentasi/penghapusan jalur legacy vs `hybrid_pipeline` saja.
- **Mockup (0.4):** **`resources_ext/Mockup.pdf`** sudah di repo; inventaris field vs app belum lengkap (halaman mungkin raster — salin teks manual / OCR jika perlu).
- **Rumus bisnis:** apakah `penalty_per_unit_idr` / `holding_cost_day_idr` akan dipakai di hybrid (saat ini arsip + export) — keputusan Fase 2+.

---

## 0.4 Mockup (`Mockup.docx` + `Mockup.pdf`)

| Artefak | Path | Catatan |
|---------|------|--------|
| Sumber asli (sering gambar di dalam DOCX) | `resources_ext/Mockup.docx` | Sulit diekstrak teks otomatis dari XML Word jika isinya drawing-only. |
| Acuan UAT / video / salin teks | `resources_ext/Mockup.pdf` | File di repo (~736 KB). Jika halaman hasil konversi berupa gambar, teks UI tidak bisa di-parse otomatis — gunakan salinan manual dari PDF/Preview atau OCR. |

| Route / area UI (Next.js) | File | Catatan mockup |
|---------------------------|------|------------------|
| `/` | `frontend/src/app/page.tsx` | Samakan label & urutan blok dengan PDF per halaman beranda. |
| `/master`, `/master/demand` | `master/page.tsx`, `master/demand/page.tsx` | Idem — bandingkan tab, tombol template, tabel. |
| `/analytics` | `analytics/page.tsx` | Idem — tab forecast / optimasi / buffer. |
| `/replenishment` | `replenishment/page.tsx` | Idem — selector SKU, tabel order window. |

**Tindakan:** (1) Buka `resources_ext/Mockup.pdf` sebagai sumber kebenaran visual. (2) Buat checklist field-per-field per halaman vs app (Chrome MVP: alur 4 langkah di UI).

---

## Ringkasan gap prioritas (setelah Fase 1 data)

1. **Parity:** N SKU + `tests/fixtures/` + toleransi numerik.
2. **Satu jalur optimasi:** keputusan `optimize-buffer` vs hybrid saja.
3. **Mockup:** checklist layar/field (Fase 0.4).
4. **Hybrid:** opsional memakai `penalty_per_unit_idr` / `holding_cost_day_idr` di rumus jika disepakati.

---

## Referensi cepat file

| Komponen | Path |
|----------|------|
| Notebook | `resources_ext/DDMRP_Hybrid_Algorithm_Last_Version.ipynb` |
| Dataset | `resources_ext/Data 2.xlsx` |
| Mockup (PDF) | `resources_ext/Mockup.pdf` |
| DB → frame | `backend/services/db_dataset.py` |
| Pipeline | `backend/services/hybrid_pipeline.py` |
| API master | `backend/api/master.py` |
| API analytics | `backend/api/analytics.py` |
| Model ORM | `backend/models.py` |
| Migrasi additive SKU | `backend/schema_migrate.py` (dipanggil dari `main.py`) |
| Tes helper upload Excel | `backend/tests/test_master_helpers.py` |
