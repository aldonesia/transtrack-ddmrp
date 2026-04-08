# DDMRP App Notes

## Unit Standar Perhitungan

- Demand upload disimpan sebagai `pcs/ea`.
- Forecasting, DDMRP, dan GA dihitung dalam `CTN` (carton).
- Konversi per SKU menggunakan `Qty Per Carton` dari master SKU.
- Master SKU upload wajib memiliki kolom `Qty Per Carton`.

## Master Data

### Master SKU

- Template: `GET /api/master/template/master-sku`
- Export: `GET /api/master/export/master-sku`
- Upload: `POST /api/master/upload/master-sku`
- Perilaku upload SKU:
  - SKU baru -> insert
  - SKU dengan kode sama -> update (upsert)

Kolom minimal template:

- `Material Number`
- `Material Group`
- `Lead Time_Days`
- `Sales Price`
- `Purchase Price`
- `Holding Cost Rate/day`
- `Lost Sale Rate/Each`
- `Logistic Cost/Order`
- `MOQ`
- `Qty Per Carton`

### Master Demand

- Template: `GET /api/master/template/demand`
- Export: `GET /api/master/export/demand`
- Upload: `POST /api/master/upload/demand`

Kolom minimal template:

- `Date`
- `SKU`
- `Demand`
- `Promo_Discount` (opsional)

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
    "unit": "CTN",
    "qty_per_carton": 40,
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
    "unit": "CTN",
    "qty_per_carton": 40,
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
    "unit": "CTN",
    "qty_per_carton": 40,
    "forecast": {
      "sku": "1000001",
      "unit": "CTN",
      "qty_per_carton": 40,
      "best_model": "M26-Ensemble-GA",
      "adu": 15.43
    },
    "optimize": {
      "sku": "1000001",
      "unit": "CTN",
      "qty_per_carton": 40,
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
  "unit": "CTN",
  "qty_per_carton": 40,
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

Halaman dashboard menampilkan ringkasan data replenishment berbasis latest active buffer.

### Sumber Data Dashboard

- Endpoint utama: `GET /api/dashboard-summary`
- Endpoint status scheduler: `GET /api/analytics/nightly-status`

### Fitur Dashboard

- Header:
  - Judul dashboard operasional DDMRP.
  - `Buffer Version` menampilkan versi buffer aktif terbaru.
- Kartu KPI:
  - `Total SKU`
  - `Zona Merah`
  - `Perlu Replenishment`
  - `Open Order`
  - `Buffer Active`

Penjelasan KPI:

- `Total SKU`: jumlah SKU yang saat ini memiliki buffer aktif.
- `Zona Merah`: jumlah SKU dengan zona `RED` pada hari referensi buffer aktif.
- `Perlu Replenishment`: jumlah SKU dengan `order_qty > 0` pada hari referensi.
- `Open Order`: jumlah SKU yang memiliki minimal satu order (`order_qty > 0`) dalam window lead time buffer aktif.
- `Buffer Active`: versi buffer aktif terbaru yang digunakan dashboard/replenishment.
- Tabel `Top SKU Kritis`:
  - Kolom: `SKU`, `NFE (CTN)`, `TOY (CTN)`, `TOG (CTN)`, `Action`
  - `Action` menampilkan rekomendasi order dari kondisi hari ini.
- Panel `Nightly Refresh (01:00)`:
  - `Scheduler enabled`
  - `Last status`
  - `Processed SKU`
  - `Last Run Time`

### Catatan Unit pada Dashboard

- Nilai replenishment ditampilkan dalam **CTN**.
- Label unit pada tabel kritis ditulis eksplisit (`NFE/TOY/TOG (CTN)`).

### Arti Status Nightly

- `success`: semua SKU aktif berhasil diproses.
- `partial_success`: sebagian SKU gagal diproses (lihat log backend).
- `failed`: proses nightly gagal total.

### Kondisi Data Kosong

Jika belum ada buffer aktif, dashboard menampilkan nilai nol dan pesan:

- `Belum ada buffer aktif. Jalankan forecast + DDMRP + GA di tab Analytics.`

## Parity Check (App vs Notebook Versi 2)

Gunakan endpoint:

- `GET /api/analytics/parity-snapshot?sku=<SKU>`

Output dipakai untuk membandingkan angka kunci app vs notebook.

### Format Tabel Parity UAT

Gunakan template berikut di dokumen UAT:

| SKU | Qty/CTN | Best Model (App) | MAE (App) | ADU Train (CTN) | Baseline TOR/TOY/TOG | Optimized FV/LTF | Optimized TOR/TOY/TOG | Total Cost Optimized | Fill Rate Optimized | Best Model (Notebook) | MAE (Notebook) | Total Cost (Notebook) | Selisih MAE | Selisih Cost | Status |
| --- | ---: | --- | ---: | ---: | --- | --- | --- | ---: | ---: | --- | ---: | ---: | ---: | ---: | --- |
| 1000001 | 40 | M26-Ensemble-GA | 1.10 | 15.43 | 9.2 / 57.8 / 115.6 | 0.10 / 1.00 | 8.8 / 55.1 / 110.2 | 15100000 | 100.00% | M26-Ensemble-GA | 1.08 | 15050000 | 0.02 | 50000 | PASS |

Keterangan:

- `Status=PASS` jika deviasi dalam toleransi UAT.
- Rekomendasi awal toleransi:
  - MAE: <= 0.2 CTN
  - Total cost: <= 3%

## Langkah UAT Parity yang Direkomendasikan

1. Pastikan master SKU lengkap dan semua SKU memiliki `Qty Per Carton`.
2. Upload demand (pcs/ea) untuk periode uji.
3. Jalankan `POST /api/analytics/run` untuk SKU target.
4. Ambil `parity-snapshot` dari app.
5. Bandingkan dengan output notebook `resources_ext/DDMRP_Hybrid_Algorithm_Versi 2.ipynb`.
6. Isi tabel parity dan tandai PASS/FAIL.

