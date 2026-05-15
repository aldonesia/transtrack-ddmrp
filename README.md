# IDAS — App Notes

**IDAS** = **Inventory Decision Analytic System** (nama produk di UI). Logika perencanaan tetap mengacu DDMRP + notebook hybrid di repo ini.

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

## Endpoint Integrasi (SKU No)

Untuk integrasi sistem eksternal, gunakan endpoint berikut:

- `POST /api/analytics/integration/run`
  - Body JSON:
    - `sku_no` (wajib)
    - `sl_target` (opsional, default `0.95`)
    - `pop_size` (opsional, default `24`)
    - `n_gen` (opsional, default `40`)
    - `include_baseline` (opsional, default `true`)
- `GET /api/analytics/integration/result?sku_no=<SKU_NO>`
  - Mengembalikan latest result forecast + optimize untuk SKU tersebut.
- `GET /api/analytics/integration/replenishment?sku_no=<SKU_NO>`
  - Mengembalikan rekomendasi replenishment berdasarkan latest active buffer SKU tersebut.

### Contoh JSON — `POST /api/analytics/integration/run`

Request body:

```json
{
  "sku_no": "1000001",
  "sl_target": 0.95,
  "pop_size": 24,
  "n_gen": 40,
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
- **Empat kartu KPI:** Total SKU, Zona merah, Perlu replenishment, Open order (angka dari `GET /api/dashboard-summary`).
- **Tabel SKU prioritas kritis:** kolom **Prioritas** (peringkat) dan **Kode SKU** — hanya SKU zona merah, urut defisit NFE menurun (maks 5 baris + tautan “Lihat semua”).
- **Kolom kanan:** widget **Status sistem** (scheduler, refresh harian, status nightly, SKU diproses, waktu refresh), **Distribusi zona buffer**, **Rekomendasi cepat**.

Penjelasan KPI (backend):

- `Total SKU`: jumlah buffer aktif (SKU dengan rencana aktif).
- `Zona Merah`: SKU dengan zona `RED` pada hari referensi buffer.
- `Perlu Replenishment`: SKU dengan `order_qty > 0` pada hari referensi.
- `Open Order`: SKU yang punya minimal satu hari dengan `order_qty > 0` dalam window lead time buffer aktif.

### Catatan Unit pada Dashboard

- Subtitle beranda mockup IDAS menampilkan **CTN** sebagai label unit tampilan replenishment; perhitungan backend dan modul lain tetap **PCS / EA** sampai kebijakan karton diaktifkan di seluruh stack.

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

