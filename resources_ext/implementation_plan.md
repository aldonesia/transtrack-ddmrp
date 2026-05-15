# Implementation plan — DDMRP hybrid (API + app)

## Policy: single source of truth (every change)

**All changes** to dataset handling, preprocessing, forecasting, SKU classification, DDMRP simulation, optimization (GA), persistence, APIs, and UI **must align with**:

| Source | Path | Role |
|--------|------|------|
| **Algorithm & pipeline order** | `resources_ext/DDMRP_Hybrid_Algorithm_Last_Version.ipynb` | Authoritative behavior: parameters, splits, models, best-model selection, series used for simulation, VF/LTF bounds, GA, and output tables/KPIs. |
| **Schema & sample data** | `resources_ext/Data 2.xlsx` | Reference workbook: sheets **`sales`** and **`sku_master`** — column names, business meaning, and sample values used for **upload contract**, **DB → DataFrame mapping**, and **UAT / parity**. |

If anything conflicts (older notebooks in `resources_ext/`, stale comments, or app code), **Last Version notebook + `Data 2.xlsx` win** unless stakeholders explicitly decide otherwise (document in PR/commit).

**Extended planning:** `resources_ext/IMPLEMENTATION_PLAN_LARGE_CHANGE.md` (phases, risks, UI/mockup milestones).

---

## Product scope (short)

- **Data:** Master SKU + daily demand through the app (DB), structurally equivalent to what the pipeline reads from `Data 2.xlsx`.
- **Pipeline:** Multi-model forecast → best model → classification → DDMRP simulation → GA, matching the relevant cells/sections in **Last Version**.
- **Outputs:** Run results / buffers / daily detail (and derivatives: replenishment, dashboard, integrations) in a **single PCS planning unit**, consistent with the notebook + Excel (see `README.md`).

---

## Baseline audit (do once, or when notebook/Excel changes)

**Completed deliverable (slice 1):** `resources_ext/PHASE0_AUDIT.md` — notebook inventory, `Data 2.xlsx` column vs DB mapping, README vs code, UI routes, and prioritized gaps for Phase 1. **Update (revisi audit):** README *Parity Check* now references **`DDMRP_Hybrid_Algorithm_Last_Version.ipynb`** (see `PHASE0_AUDIT.md` §0.3 / “Revisi & status gap”). **Update (2026-05-12):** parsing tanggal / header Excel untuk upload dipindahkan ke `backend/services/master_upload_parse.py` (bukan duplikat di `api/master.py`).

1. **Notebook:** inventory main blocks in `DDMRP_Hybrid_Algorithm_Last_Version.ipynb` (preprocessing, unit handling if any, cleaning, split, model set, forecast, simulation input series, `classify_sku`, `simulate_ddmrp`, `GeneticOptimizer`, outputs).
2. **Excel:** column list per sheet `sales` and `sku_master` in `Data 2.xlsx` → mapping **Excel column → internal DataFrame column → DB column**.
3. **Repo:** list Python entry points (below) and **gaps** vs the notebook.

---

## Code locations (current integration surface)

Keep algorithm changes centralized in the hybrid modules (avoid duplicating business logic):

| Area | Primary files |
|------|----------------|
| DB → frames like Excel | `backend/services/db_dataset.py` (and `data_loader.py` if still used for SKU/demand helpers) |
| Forecast | `backend/services/hybrid_forecast.py` |
| Simulation + GA | `backend/services/hybrid_optimizer.py` |
| Orchestration | `backend/services/hybrid_pipeline.py` |
| Analytics / run API | `backend/api/analytics.py` |
| Master upload / template | `backend/api/master.py` |
| Parsing upload (tanpa FastAPI; dipakai API + tes) | `backend/services/master_upload_parse.py` |
| Impor massal `Data 2.xlsx` | `backend/scripts/import_data2_xlsx.py` |
| Migrasi additive kolom master | `backend/schema_migrate.py` (dipanggil dari `main.py`) |
| ORM models | `backend/models.py` |

Other modules (`forecasting.py`, `optimization.py`, `ddmrp_logic.py`, `notebook_code.py`) should only change if still on the production path; prefer **consolidation** into the hybrid pipeline so there is one numerical source of truth.

---

## Status implementasi (diperbarui 2026-05-12)

Ringkasan terhadap workstream di bawah ini dan verifikasi di akhir dokumen. Detail kolom/endpoint ada di `PHASE0_AUDIT.md` dan `README.md`.

### Sudah dilakukan

| Area | Ringkasan |
|------|-----------|
| **Audit baseline** | `PHASE0_AUDIT.md` (inventory notebook, mapping `Data 2.xlsx` ↔ DB, README vs kode, gap prioritas). |
| **Kontrak dataset / DB (Fase 1)** | Template master selaras sheet **`sku_master`**; template demand **`sales`** (`GET /api/master/template/demand-data2`); validator + upload + export; kolom opsional `SKUMaster` (`criticality`, ABC/XYZ, vendor, currency, `holding_cost_day_idr`, `penalty_per_unit_idr`); migrasi additive `schema_migrate.py` di startup. |
| **Parsing Excel** | Serial tanggal Excel, normalisasi header (`Demand `, `ID Item`, varian promo), `_coerce_*` di `master_upload_parse.py`. |
| **DB → frame notebook** | `db_dataset.py`: baris master menyertakan **Material Description** & **Unit**; frame kosong konsisten. |
| **Impor `Data 2.xlsx`** | Skrip CLI `backend/scripts/import_data2_xlsx.py` (`--fresh` / `--xlsx`); dokumentasi di `README.md`. (Contoh run dev: 45 SKU, 13.679 baris demand.) |
| **Tes regresi parsial** | `backend/tests/test_master_helpers.py` (unittest) untuk helper upload tanpa memuat FastAPI. |
| **API hybrid utama** | `POST /api/analytics/run`, `GET /api/analytics/latest-run`, forecast/optimize, integrasi `sku_no`, `GET /api/analytics/parity-snapshot`, nightly + dashboard (sesuai README). |
| **Frontend** | Master + demand: tautan template Data 2; tipe `MasterSku` diperluas; Analytics: **Parity snapshot** + tipe `ParitySnapshot` di `api.ts`. Branding **IDAS**, sidebar **Operasional**, dashboard **Ringkasan Operasional** selaras mockup; skeleton & empty state dashboard. |

### Sebagian / perlu penegasan

| Area | Ringkasan |
|------|-----------|
| **Parity numerik vs notebook** | Endpoint + UI snapshot ada; **belum** ada fixture golden multi-SKU + tes otomatis toleransi vs output `DDMRP_Hybrid_Algorithm_Last_Version.ipynb`. |
| **Satu jalur optimasi** | Hybrid pipeline dipakai analytics/nightly; `POST /api/optimize-buffer` di `main.py` masih memakai `services.ddmrp_logic.optimize_buffer` (jalur legacy), belum digabung atau di-deprecate secara eksplisit di README/plan besar. |
| **Promo / kolom sales** | `Promo_Discount` / `Promo Discount` / `PromoDiscountPct` → `DailyRecord.promo_discount`; **`IsPromo` / `PromoType`** tidak disimpan sebagai kolom DB (hanya konstanta/derive di frame bila diperlukan pipeline). |
| **Biaya IDR di master** | `holding_cost_day_idr` & `penalty_per_unit_idr` tersimpan; **belum** diputus/diimplementasikan apakah menggantikan atau melengkapi rumus `lost_sale_rate_each` / holding di `hybrid_*`. |
| **UAT “resmi”** | Prosedur README + impor CLI siap; **belum** tercatat sebagai gate merge formal / environment staging terpisah di dokumen ini. |

### Belum dilakukan (masih terbuka)

| Area | Ringkasan |
|------|-----------|
| **Regresi parity otomatis** | `tests/fixtures/` + bandingkan angka kunci app vs notebook (MAE, biaya, TOR/TOY/TOG, dll.) dengan toleransi disepakati. |
| **Konsolidasi modul legacy** | Menarik `ddmrp_logic` / rute non-hybrid keluar jalur produksi atau mendokumentasikan “deprecated” dengan pengganti jelas. |
| **Mockup (Fase 0.4)** | **`resources_ext/Mockup.pdf`** di repo; **`Mockup.docx`** sumber. Checklist field vs app per halaman belum lengkap; **UI** dashboard + sidebar IDAS mulai diselaraskan. |
| **Alembic / migrasi prod** | Skema additive saat ini via `create_all` + `schema_migrate`; belum diganti rencana Alembic penuh (lihat `IMPLEMENTATION_PLAN_LARGE_CHANGE.md`). |
| **Keputusan operasional** | Job run berat (GA + banyak model): **sync HTTP vs antrian + polling** — masih di “Open decisions” di bawah. |

---

## Workstreams (aligned with Last Version + Data 2)

### 1. Dataset & database

> **Status (2026-05-12):** kontrak upload + kolom opsional + impor CLI sudah sesuai baris **Sudah dilakukan** di atas; item di bawah tetap menjadi checklist formal / hardening.

- Align upload templates and validators with **`sku_master`** and **`sales`** in `Data 2.xlsx`.
- Ensure migrations/DB columns cover every field the notebook reads from master; legacy `pack_size` / `qty_per_carton` remain in the schema at **1** and are not used for conversion.
- UAT: import `Data 2.xlsx` into a test environment and run end-to-end.

### 2. Python — notebook parity

> **Status:** pipeline hybrid ada; **golden / toleransi otomatis** belum (lihat **Belum dilakukan**).

- Adjust `hybrid_forecast.py` / `hybrid_optimizer.py` / `hybrid_pipeline.py` so behavior matches **Last Version** for the same input frames built from `Data 2.xlsx`.
- Maintain **golden outputs** for a few SKUs (from the notebook) for regression or API parity checks if the project uses them.

### 3. API & persistence

> **Status:** jalur hybrid + persist buffer/run utama sudah; konsolidasi dengan **`/api/optimize-buffer`** (legacy) masih terbuka.

- Run/optimize/replenishment/dashboard endpoints must use the same pipeline outputs as the notebook; no second set of formulas in route handlers except thin glue and validated bugfixes (also covered by parity tests).

### 4. Frontend

- Labels and displayed numbers must match API responses from the pipeline — **no duplicate business calculations in the client**.

---

## Verification (required for merges that touch algorithms)

1. **Data:** At least one SKU from `Data 2.xlsx` loads into the DB with the agreed column contract (upload API **atau** `backend/scripts/import_data2_xlsx.py`).
2. **Run:** Forecast/optimize pipeline completes without error for that SKU.
3. **Parity (if used):** Key metrics match **Last Version** within agreed tolerance (manual via `GET /api/analytics/parity-snapshot` + README *Parity Check*; otomatis = belum).
4. **Regression:** Upload / impor CLI → run → replenishment/dashboard still behaves correctly.
5. **Helper upload (cepat):** `cd backend && python3 -m unittest discover -s tests -p 'test_*.py' -v` — tidak mengganti parity penuh.

---

## Open decisions (update when resolved)

- **Sync HTTP vs background jobs** for heavy runs (GA + many models): timeout limits vs queue + polling.
- **Promo / extra features:** If Last Version still uses promo-related columns from `sales`, add them to DB and templates; if not used, remove consistently from models and app paths (avoid half-implemented features).

---

## Document history

- Earlier revision referenced `DDMRP_Hybrid_Algorithm.ipynb` and a split `forecasting.py` / `optimization.py` layout. **This file is superseded** by the policy above: **`DDMRP_Hybrid_Algorithm_Last_Version.ipynb`** and **`Data 2.xlsx`** are the authoritative algorithm and data references.
- **2026-05-15:** Path mockup resmi **`resources_ext/Mockup.pdf`** (di repo); `PHASE0_AUDIT.md` §0.4 diselaraskan.
- **2026-05-15:** Dihapus komponen **MvpFlowRibbon** / **MvpBadge** (teks “Alur demo video MVP”) dari semua halaman; fokus navigasi lewat sidebar IDAS saja.
