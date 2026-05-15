# IDAS — App Notes

**IDAS** = **Inventory Decision Analytic System** (nama produk di UI). Logika perencanaan tetap mengacu DDMRP + notebook hybrid di repo ini.

## Dokumentasi (Markdown)

| Dokumen | Isi |
|---------|-----|
| [docs/USER_MANUAL.md](docs/USER_MANUAL.md) | Panduan pengguna aplikasi (UI) |
| [docs/INTEGRATION_API_MANUAL.md](docs/INTEGRATION_API_MANUAL.md) | API integrasi eksternal (`sku_no`) |
| [docs/INSTALLATION.md](docs/INSTALLATION.md) | Instalasi Docker, reset DB, impor data awal |
| [docs/gap_analysis.md](docs/gap_analysis.md) | Analisis gap produk & prioritas backlog |

## Unit Standar Perhitungan

- Satu unit perencanaan: **PCS / EA** untuk demand, forecast, DDMRP, GA, replenishment, dan dashboard.
- Tidak ada konversi karton; field legacy `pack_size` / `qty_per_carton` di database diset **1** dan tidak dipakai di API/UI.

## Tes otomatis (backend)

Parsing header Excel / tanggal serial / bentuk sheet **Data 2** (`demand` dengan spasi, `ID Item`, dll.) berada di `backend/services/master_upload_parse.py` (tanpa dependensi FastAPI, bisa diuji terpisah).

Dari direktori `backend/`:

```bash
cd backend && python3 -m unittest discover -s tests -p 'test_*.py' -v
```

Membutuhkan Python dengan `pandas` (sama seperti menjalankan API).

## Master Data

### Master SKU

- Template (urutan & nama kolom selaras sheet **`sku_master`** pada `Data 2.xlsx`): `GET /api/master/template/master-sku`
- Export (kolom yang sama + field tambahan dari DB): `GET /api/master/export/master-sku`
- Upload: `POST /api/master/upload/master-sku`
- Perilaku upload SKU:
  - SKU baru -> insert
  - SKU dengan kode sama -> update (upsert)
  - **Material Number** boleh berupa angka atau teks (mis. spare part); header dinormalisasi (trim / spasi).

**Kolom wajib** (harus ada di file):

- `Material Number`, `Material Group`, `Lead Time_Days`, `Sales Price`, `Purchase Price`, `Holding Cost Rate/day`, `Lost Sale Rate/Each`, `Logistic Cost/Order`, `MOQ`

**Kolom opsional** (disimpan ke DB jika ada; dipakai untuk pelaporan / kontrak data, pipeline hybrid utama tetap memakai blok wajib):

- `Material Description` → `nama_item` (jika kosong, fallback ke `Material Group`)
- `Unit`, `Status`, `Criticality`, `ABC Class`, `XYZ Class`, `Vendor Type`, `Currency`
- `Holding Cost/day (IDR)` → `holding_cost_day_idr`
- `Penalty/unit (IDR)` → `penalty_per_unit_idr`

Pada startup, backend menambahkan kolom opsional di tabel `sku_master` jika belum ada (SQLite / Postgres); untuk Postgres produksi disarankan Alembic.

#### Impor penuh `Data 2.xlsx` (CLI)

Skrip: `backend/scripts/import_data2_xlsx.py` — membaca sheet **`sku_master`** dan **`sales`**, memakai parser yang sama dengan API upload, lalu upsert ke `sku_master` + `daily_record`.

```bash
cd backend
python3 -m pip install -r requirements.txt   # sekali, jika belum
python3 scripts/import_data2_xlsx.py        # upsert ke DB default (lihat `database.py`)
python3 scripts/import_data2_xlsx.py --fresh # kosongkan master/demand + forecast/buffer terkait, lalu isi ulang
```

- Default file: `resources_ext/Data 2.xlsx` (relatif ke root repo).
- Path lain: `python3 scripts/import_data2_xlsx.py --xlsx /path/ke/file.xlsx`
- Untuk Postgres: set `DATABASE_URL` lalu jalankan perintah yang sama.

### Master Demand

- Template minimal: `GET /api/master/template/demand`
- Template bentuk sheet **`sales`** (`Data 2.xlsx`): `GET /api/master/template/demand-data2`
- Export: `GET /api/master/export/demand`
- Upload: `POST /api/master/upload/demand`

Kolom minimal (salah satu bentuk header yang didukung):

- `Date`
- `SKU` atau `ID Item`
- `Demand` atau `Demand ` (spasi di akhir, seperti di `Data 2.xlsx`)
- Promo opsional: `Promo_Discount`, `Promo Discount`, atau `PromoDiscountPct`

Untuk file yang diekspor dari Excel dengan sel tanggal sebagai angka, **serial hari Excel** (mis. `45810`) didukung pada upload (`api/master`) selama nilainya dalam rentang realistis (≈1970–); tanggal ISO/`YYYY-MM-DD` tetap didukung.

## Latest Run per SKU

- Endpoint run utama: `POST /api/analytics/run`
- Hasil forecast + optimize disimpan sebagai latest run per SKU.
- Endpoint baca latest run: `GET /api/analytics/latest-run?sku=<SKU>`
- Replenishment selalu mengacu ke latest active buffer per SKU.

## Alur pipeline (notebook RUN 2 → 3 → 4)

| RUN | Modul UI | API / layanan | Output |
|-----|----------|---------------|--------|
| **2** | Analytics — Forecast | `POST /api/analytics/forecast` atau bagian dari `POST /api/analytics/run` | Model terbaik, metrik, deret forecast |
| **3** | Analytics — Classify & GA | `POST /api/analytics/optimize` atau `run` | TOR/TOY/TOG, VF/LTF optimal, klasifikasi ADI-CV² |
| **4** | Replenishment | `GET /api/analytics/replenishment` | Jendela order qty, NFE, zona per hari |

Setelah **run** berhasil, backend menyimpan buffer aktif (`ddmrp_buffer` + `ddmrp_buffer_detail`) dan menginisialisasi state operasional (`sku_operational_state`, OH awal = TOY).

Rencana detail open order: `resources_ext/IMPLEMENTATION_PLAN_OPEN_ORDER.md`.

## Purchase orders & operational NFE (loop operasional)

Setelah buffer aktif, rekomendasi replenishment bisa dikonfirmasi sebagai **purchase order (PO)**. PO mengubah **open order (OP)** dalam perhitungan NFE **tanpa** menjalankan ulang GA.

### Prinsip

```
NFE = On Hand (OH) + Open Order (OP) − Qualified Demand (QD)
```

- **TOR / TOY / TOG** — tetap dari hasil RUN 3 terakhir sampai user menjalankan pipeline lagi.
- **QD** — demand hari ini + forecast horizon H+1…H+DLT (jika > ADU), dari `ForecastRun` + `DailyRecord` (selaras notebook).
- **OP** — jumlah PO berstatus `confirmed` yang belum diterima (`expected_receipt_date` > hari acuan).

### API Purchase order

Prefix: `/api/purchase-orders`

| Method | Path | Keterangan |
|--------|------|------------|
| `POST` | `/` | Buat PO `draft` — body: `{ "sku", "qty", "order_date?", "notes?" }` |
| `POST` | `/{id}/confirm` | Konfirmasi draft → `confirmed` + recalc NFE |
| `POST` | `/{id}/receive` | Terima barang — body opsional: `{ "receipt_qty" }` |
| `POST` | `/{id}/cancel` | Batalkan `draft` atau `confirmed` |
| `GET` | `/` | List — query: `sku`, `status`, `limit`, `offset` |
| `GET` | `/{id}` | Detail satu PO |

Aturan bisnis (v1):

- SKU harus punya buffer **Active**.
- Qty dibulatkan ke MOQ / `pack_size` dari master.
- `expected_receipt_date = order_date + lead_time` (hari kalender dari master, fallback DLT buffer).
- Maksimal **satu PO confirmed per SKU per hari order** (409 jika duplikat).

Contoh — buat & konfirmasi:

```bash
# Draft
curl -s -X POST http://localhost:8000/api/purchase-orders \
  -H "Content-Type: application/json" \
  -d '{"sku":"1000001","qty":171,"notes":"Replenishment"}'

# Confirm (ganti id)
curl -s -X POST http://localhost:8000/api/purchase-orders/1/confirm
```

Response confirm menyertakan `recalc` (NFE, zona, `suggested_order_qty`, OH, OP).

### Recalc manual (tanpa GA)

- `POST /api/analytics/recalc-operational?sku=<SKU>`
- Memperbarui `DDMRPBufferDetail` di jendela buffer aktif dari OH/OP/QD terkini.
- Dipakai tombol **Recalc & refresh** di halaman Replenishment.

### Replenishment — field `operational`

`GET /api/analytics/replenishment?sku=<SKU>` menambahkan blok:

```json
"operational": {
  "on_hand": 196.0,
  "open_order": 171.0,
  "qualified_demand": 15.4,
  "nfe": 58.45,
  "zone": "YELLOW",
  "suggested_order_qty": 171.0,
  "confirmed_pos": [
    {
      "id": 1,
      "qty": 171.0,
      "order_date": "2024-05-01",
      "expected_receipt_date": "2024-05-08",
      "unit": "EA"
    }
  ],
  "unit": "EA"
}
```

- `order_qty` per baris di `recommendations` = **saran residual** setelah recalc (bukan qty PO yang sudah dikonfirmasi).
- UI Replenishment: **Create PO** → modal → `create` + `confirm` → refresh plan & dashboard.

### Tabel database (open order)

| Tabel | Peran |
|-------|--------|
| `purchase_order` | PO draft / confirmed / received / cancelled |
| `sku_operational_state` | OH operasional per SKU (`on_hand`, `as_of_date`, `buffer_id`) |

## Endpoint Integrasi (SKU No)

Panduan lengkap + contoh cURL: **[docs/INTEGRATION_API_MANUAL.md](docs/INTEGRATION_API_MANUAL.md)**.

| Method | Path | Fungsi |
|--------|------|--------|
| `POST` | `/api/analytics/integration/run` | Forecast + optimize + buffer aktif |
| `GET` | `/api/analytics/integration/result?sku_no=<SKU_NO>` | Latest run forecast + optimize |
| `GET` | `/api/analytics/integration/replenishment?sku_no=<SKU_NO>` | Replenishment + `operational` (OH, OP, NFE, zona) |

Body `integration/run`: `sku_no` (wajib), `sl_target` (default `0.95`), `pop_size` (default `30`), `n_gen` (default `80`), `include_baseline` (default `true`).

### Contoh JSON — `POST /api/analytics/integration/run`

Request body:

```json
{
  "sku_no": "1000001",
  "sl_target": 0.95,
  "pop_size": 30,
  "n_gen": 80,
  "include_baseline": true
}
```

Contoh response:

```json
{
  "sku_no": "1000001",
  "status": "ok",
  "buffer_id": 123,
  "latest_run_id": 77,
  "forecast": {
    "sku": "1000001",
    "unit": "PCS",
    "best_model": "M26-Ensemble-GA",
    "best_metrics": {
      "MAE": 1.1,
      "RMSE": 1.8,
      "MAPE*": 7.2
    },
    "train_size": 390,
    "adu": 15.43
  },
  "optimize": {
    "sku": "1000001",
    "unit": "PCS",
    "forecast_best_model": "M26-Ensemble-GA",
    "baseline": {
      "fill_rate": 1.0,
      "total_cost": 17000000
    },
    "optimized": {
      "fv_opt": 0.1,
      "ltf_opt": 1.0,
      "kpi": {
        "fill_rate": 1.0,
        "total_cost": 15100000,
        "tor": 8.8,
        "toy": 55.1,
        "tog": 110.2
      }
    }
  }
}
```

### Contoh JSON — `GET /api/analytics/integration/result?sku_no=1000001`

Contoh response:

```json
{
  "sku_no": "1000001",
  "status": "ok",
  "sku": "1000001",
  "latest_run": {
    "id": 77,
    "run_at": "2026-04-08T18:12:34.123456",
    "unit": "PCS",
    "forecast": {
      "sku": "1000001",
      "unit": "PCS",
      "best_model": "M26-Ensemble-GA",
      "adu": 15.43
    },
    "optimize": {
      "sku": "1000001",
      "unit": "PCS",
      "optimized": {
        "fv_opt": 0.1,
        "ltf_opt": 1.0,
        "kpi": {
          "fill_rate": 1.0,
          "total_cost": 15100000
        }
      }
    }
  }
}
```

### Contoh JSON — `GET /api/analytics/integration/replenishment?sku_no=1000001`

Contoh response:

```json
{
  "sku_no": "1000001",
  "status": "ok",
  "sku": "1000001",
  "unit": "PCS",
  "buffer_id": 123,
  "today_date": "2026-04-09",
  "leadtime_days": 7,
  "tor": 58.0,
  "toy": 196.0,
  "tog": 340.0,
  "operational": {
    "on_hand": 196.0,
    "open_order": 0.0,
    "nfe": 58.45,
    "zone": "YELLOW",
    "suggested_order_qty": 171.0,
    "confirmed_pos": [],
    "unit": "PCS"
  },
  "recommendations": [
    {
      "date": "2026-04-09",
      "order_qty": 12.0,
      "nfe": 3.5,
      "zone": "RED"
    },
    {
      "date": "2026-04-10",
      "order_qty": 0.0,
      "nfe": 18.2,
      "zone": "YELLOW"
    }
  ]
}
```

## Scheduler Refresh Harian (01:00)

Backend sudah memiliki scheduler internal untuk menjalankan `forecast + optimize` semua SKU aktif setiap hari jam 01:00.

Environment variable yang bisa diatur:

- `NIGHTLY_REFRESH_ENABLED` (default `1`)
- `NIGHTLY_REFRESH_HOUR` (default `1`)
- `NIGHTLY_REFRESH_MINUTE` (default `0`)
- `NIGHTLY_SL_TARGET` (default `0.95`)
- `NIGHTLY_POP_SIZE` (default `24`)
- `NIGHTLY_N_GEN` (default `40`)

Endpoint operasional:

- `GET /api/analytics/nightly-status`
  - Cek status scheduler terakhir.
- `POST /api/analytics/nightly-run-now`
  - Trigger manual refresh semua SKU (untuk verifikasi/testing).

## Dashboard (Ringkasan Operasional)

Halaman beranda menampilkan ringkasan operasional buffer aktif (**Ringkasan Operasional** di UI IDAS).

### Sumber Data Dashboard

- Endpoint utama: `GET /api/dashboard-summary`
- Endpoint status scheduler: `GET /api/analytics/nightly-status`

### Fitur Dashboard (sesuai mockup IDAS)

- **Sidebar:** brand **IDAS** + subtitle *Inventory Decision Analytic System*, grup menu **Operasional**, item **Beranda & KPI**, **Master Data**, **Master Demand**, **Analytics & Buffer**, **Replenishment** (badge merah = jumlah SKU perlu replenishment). Footer: **Buffer version**.
- **Header utama:** **Ringkasan Operasional**; subtitle unit tampilan **CTN** + waktu refresh terakhir; **Status sistem** (Aktif); tombol **Eksekusi Semua Order** → `/replenishment`.
- **Alert merah** jika ada SKU zona `RED`.
- **Empat kartu KPI:** Total SKU, Red zone, Needs replenishment, Confirmed PO (angka dari `GET /api/dashboard-summary`).
- Halaman **Replenishment:** rekomendasi order, buffer position (TOR/TOY/TOG), **Create PO**, export CSV, riwayat PO.
- **Tabel SKU prioritas kritis:** kolom **Prioritas** (peringkat) dan **Kode SKU** — hanya SKU zona merah, urut defisit NFE menurun (maks 5 baris + tautan “Lihat semua”).
- **Kolom kanan:** widget **Status sistem** (scheduler, refresh harian, status nightly, SKU diproses, waktu refresh), **Distribusi zona buffer**, **Rekomendasi cepat**.

Penjelasan KPI (backend, `GET /api/dashboard-summary`):

| Field | Arti |
|-------|------|
| `total_sku` | Jumlah buffer aktif |
| `zona_merah` | SKU dengan zona `RED` pada hari start buffer |
| `zona_kuning` / `zona_hijau` | SKU zona kuning / hijau pada hari start |
| `perlu_replenishment` | SKU dengan saran order (`order_qty` > 0) pada hari start |
| `planned_order_skus` | Sama seperti perlu replenishment (saran di buffer) |
| `confirmed_po_skus` | SKU dengan minimal satu PO `confirmed` di jendela buffer |
| `open_order_qty` | Total qty PO `confirmed` di jendela tersebut |
| `open_order` | **Deprecated** — alias ke `planned_order_skus` (kompatibilitas lama) |

### Catatan unit

- Semua perhitungan memakai **unit perencanaan** dari `SKUMaster.unit` (PCS, EA, CTN, …) **tanpa konversi karton**.
- Label di UI mengikuti unit dari API (`operational.unit`, `replenishment.unit`).

### Arti Status Nightly

- `success`: semua SKU aktif berhasil diproses.
- `partial_success`: sebagian SKU gagal diproses (lihat log backend).
- `failed`: proses nightly gagal total.

### Kondisi Data Kosong

Jika belum ada buffer aktif, dashboard menampilkan nilai nol dan pesan:

- `Belum ada buffer aktif. Jalankan forecast + DDMRP + GA di tab Analytics.`

## Parity Check (App vs Notebook Last Version)

Acuan numerik dan alur pipeline: `resources_ext/DDMRP_Hybrid_Algorithm_Last_Version.ipynb` (bukan file notebook lama “Versi 2”).

Gunakan endpoint:

- `GET /api/analytics/parity-snapshot?sku=<SKU>`

Output dipakai untuk membandingkan angka kunci app vs notebook **Last Version** pada data yang setara (mis. setelah impor `Data 2.xlsx` / master + demand di DB).

### Format Tabel Parity UAT

Gunakan template berikut di dokumen UAT:

| SKU | Best Model (App) | MAE (App) | ADU Train (PCS) | Baseline TOR/TOY/TOG | Optimized FV/LTF | Optimized TOR/TOY/TOG | Total Cost Optimized | Fill Rate Optimized | Best Model (Notebook) | MAE (Notebook) | Total Cost (Notebook) | Selisih MAE | Selisih Cost | Status |
| --- | --- | ---: | ---: | --- | --- | --- | ---: | ---: | --- | ---: | ---: | ---: | ---: | --- |
| 1000001 | M26-Ensemble-GA | 1.10 | 15.43 | 9.2 / 57.8 / 115.6 | 0.10 / 1.00 | 8.8 / 55.1 / 110.2 | 15100000 | 100.00% | M26-Ensemble-GA | 1.08 | 15050000 | 0.02 | 50000 | PASS |

Keterangan:

- `Status=PASS` jika deviasi dalam toleransi UAT.
- Rekomendasi awal toleransi:
  - MAE: <= 0.2 PCS
  - Total cost: <= 3%

## Langkah UAT Parity yang Direkomendasikan

1. Pastikan master SKU lengkap untuk SKU yang diuji.
2. Upload demand (pcs/ea) untuk periode uji.
3. Jalankan `POST /api/analytics/run` untuk SKU target.
4. Ambil `parity-snapshot` dari app.
5. Bandingkan dengan output notebook `resources_ext/DDMRP_Hybrid_Algorithm_Last_Version.ipynb` (jalankan sel yang sama untuk SKU dan periode yang setara).
6. Isi tabel parity dan tandai PASS/FAIL.

## Docker & reset database

Development (API di host, frontend hot reload):

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build
```

Reset DB + impor ulang `Data 2.xlsx` (dari root repo):

```bash
./docker-reset-db.sh
```

Setelah reset: upload master/demand lewat UI atau jalankan `backend/scripts/import_data2_xlsx.py`, lalu **Analytics → Run full pipeline** per SKU sebelum uji Replenishment / PO.

## Langkah uji open order (manual)

1. Impor data & jalankan `POST /api/analytics/run` untuk satu SKU.
2. Buka Replenishment, pilih SKU — pastikan ada saran order & NFE.
3. **Create PO** → konfirmasi qty → cek pesan sukses dan `operational.open_order` naik.
4. `POST /api/analytics/recalc-operational?sku=...` atau **Recalc & refresh** — tabel & buffer bar ikut terbarui.
5. (Opsional) `POST /api/purchase-orders/{id}/receive` — OH naik, OP turun setelah recalc.
6. Dashboard: `confirmed_po_skus` dan `open_order_qty` konsisten dengan PO di DB.

