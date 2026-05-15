# Rencana implementasi — penyelarasan app dengan notebook terbaru, Data 2.xlsx, dan Mockup

Dokumen ini merencanakan **perubahan besar** end-to-end: dari **dataset (master SKU + demand)**, **logika forecast & DDMRP di Python** (sesuai `DDMRP_Hybrid_Algorithm_Last_Version.ipynb` dan dataset `Data 2.xlsx`), **semua layanan backend**, hingga **seluruh antarmuka pengguna** (sesuai `Mockup.docx` dan `README.md` sebagai referensi perilaku produk).

**Artefak acuan**

| Artefak | Peran |
|--------|--------|
| `resources_ext/DDMRP_Hybrid_Algorithm_Last_Version.ipynb` | Sumber kebenaran algoritma (preprocessing, forecast, klasifikasi, simulasi DDMRP, GA, output). |
| `resources_ext/Data 2.xlsx` | Sumber kebenaran **skema dataset** (workbook berisi sheet `sales` dan `sku_master` — verifikasi ulang nama kolom saat kickoff). |
| `resources_ext/Mockup.docx` | Sumber asli **UI/UX** (screens, alur, copy); isinya sering **gambar**. |
| `resources_ext/Mockup.pdf` | Export PDF untuk acuan visual / salin teks (ada di repo); jika halaman raster, gunakan inventaris manual atau OCR. |
| `README.md` | Referensi perilaku produk (satu unit **PCS**, latest run, integrasi, nightly, dashboard, parity). **Harus diverifikasi** mana yang sudah diimplementasi di kode vs masih spesifikasi. |

---

## 1. Tujuan & definisi “selesai”

### 1.1 Tujuan bisnis / produk

- Pengguna mengelola **master SKU** dan **demand harian** lewat aplikasi (bukan file statis saja).
- Pipeline **forecast → pemilihan model terbaik → DDMRP + GA** mengikuti **notebook Last Version** pada data yang setara dengan **`Data 2.xlsx`**.
- Hasil perhitungan **tersimpan** (buffer / run / detail) dan menjadi dasar **replenishment** dan **dashboard**.
- **UI** mengikuti **Mockup** (layout, alur, label) sejauh artefak memungkinkan.

### 1.2 Definisi selesai (acceptance tingkat tinggi)

1. **Dataset:** Template upload + validasi + mapping DB mencerminkan kolom `Data 2.xlsx` / notebook; tidak ada kolom “gelap” yang hanya ada di notebook.
2. **Python:** Untuk set SKU UAT dari `Data 2.xlsx`, metrik kunci (mis. best model, MAE, TOR/TOY/TOG, biaya) berada dalam **toleransi parity** yang disepakati vs notebook.
3. **API:** Seluruh alur yang dideskripsikan `README.md` (jika disetujui sebagai scope) tersedia, terdokumentasi, dan konsisten dengan unit **PCS**.
4. **UI:** Semua layar di mockup ter-cover; tidak ada data dummy kritis di jalur produksi.

---

## 2. Fase 0 — Audit & baseline (wajib sebelum coding besar)

**Output:** dokumen gap “Notebook ↔ Excel ↔ DB ↔ Services ↔ API ↔ UI”.

**Hasil audit (slice 1):** `resources_ext/PHASE0_AUDIT.md` — inventory notebook Last Version, header `Data 2.xlsx` vs ORM, ringkasan README vs kode, dan gap prioritas untuk Fase 1.

| # | Tugas | Hasil |
|---|--------|--------|
| 0.1 | Inventory sel notebook Last Version (RUN / section): preprocessing, unit, split, model, simulasi, GA | Daftar fungsi/parameter yang harus ada di `backend/services/*`. |
| 0.2 | Baca header & contoh baris `Data 2.xlsx` (`sales`, `sku_master`): semua kolom, tipe, null | Tabel “kolom → tipe → DB column → dipakai di mana”. |
| 0.3 | Cocokkan dengan `README.md` (unit PCS, latest run, nightly, integrasi, parity) | Daftar fitur: **Implemented / Partial / Docs only**. |
| 0.4 | Inventaris layar dari `Mockup.docx` (manual dari gambar) | Daftar route + komponen + sumber API per layar. |

**Risiko yang ditangani di fase ini:** implementasi UI atau API mengikuti README sementara mockup beda — harus diputuskan mana yang menang per poin.

---

## 3. Fase 1 — Kontrak dataset & database

**Prinsip:** satu pipeline internal (DataFrame / ORM) yang **identik** dengan yang diharapkan notebook.

### 3.1 Master SKU (`sku_master` / `SKUMaster`)

- Finalisasi kolom wajib/opsional master & demand (tanpa konversi karton; legacy DB `pack_size`/`qty_per_carton` = 1).
- Update: template Excel, validator upload, upsert logic, migrasi DB.
- Aturan SKU: string vs numerik, normalisasi, unik.

### 3.2 Demand harian (`sales` / `DailyRecord`)

- Finalisasi kolom: `Date`, `SKU`, `Demand`, promo (jika model masih memakai fitur promo).
- Aturan: duplikat `(date, sku)`, urutan tanggal, imputasi hari tanpa transaksi (sesuai notebook / loader saat ini).
- Pastikan demand dan hasil pipeline selalu dalam **PCS** (satu boundary, tidak bocor ke banyak layer).

### 3.3 Migrasi & environment

- Rencanakan **Alembic** (atau setara) jika deployment production; hindari hanya mengandalkan `create_all` untuk perubahan skema bertahap.
- Data seed UAT: impor `Data 2.xlsx` → DB untuk regresi otomatis.

**Deliverable fase 1:** dokumen kontrak data + migrasi + template/validator terbaru.

---

## 4. Fase 2 — Python: forecast & DDMRP (parity dengan notebook)

### 4.1 Refactor / merge kode

- Satukan perubahan `Last_Version.ipynb` ke modul yang jelas (bisa tetap `hybrid_forecast.py` / `hybrid_optimizer.py` / `hybrid_pipeline.py` atau dipecah ulang).
- Hilangkan duplikasi antara “notebook path” vs “API path”; satu fungsi inti `run_*` yang dipanggil API.

### 4.2 Parity & regresi

- Pilih **N SKU** dari `Data 2.xlsx` (smooth, intermittent, dengan promo, edge lead time).
- Simpan **golden output** dari notebook (JSON/CSV kecil di repo `tests/fixtures/`).
- Tambah skrip atau endpoint **parity snapshot** (seperti yang dijelaskan `README.md`) dan toleransi numerik (contoh di README: MAE, total cost).

**Deliverable fase 2:** layanan Python + tes parity yang hijau pada dataset UAT.

---

## 5. Fase 3 — Backend services & API

### 5.1 Orkestrasi run

- Satu entrypoint resmi: run forecast + optimasi + persist **latest run per SKU** + buffer aktif + detail (sesuai desain produk di `README.md` jika diadopsi).
- Pertimbangkan **async/background job** + polling status jika durasi run melebihi batas UX (notebook + GA bisa berat).

### 5.2 Endpoint surface (selaraskan dengan README + mockup)

Prioritas implementasi disesuaikan hasil audit Fase 0, kandidat umum:

- Master: template / validate / upload / export untuk SKU & demand.
- Analytics: run, latest-run, (opsional) parity-snapshot.
- Replenishment: berdasarkan buffer aktif / latest run; unit & window tanggal terdokumentasi.
- Dashboard: agregasi KPI dari buffer aktif (dan nightly status jika ada).
- Integrasi eksternal: `sku_no` run/result/replenishment jika scope tetap.

### 5.3 Observabilitas & error

- Logging terstruktur per SKU run (gagal model tunggal vs gagal total).
- Response error yang actionable (validasi dataset, SKU tidak ada, data tidak cukup untuk split).

**Deliverable fase 3:** OpenAPI stabil + contoh request/response untuk UAT.

---

## 6. Fase 4 — Frontend (semua UI)

**Prasyarat:** inventaris layar dari mockup (Fase 0.4).

### 6.1 Urutan UI yang disarankan

1. Master SKU & Master Demand (upload, validasi, daftar, export).
2. Analytics (pilih SKU, parameter GA/SL, hasil forecast, hasil optimasi, unit PCS).
3. Replenishment (SKU terpilih, rekomendasi per hari).
4. Dashboard (KPI, top kritis, status batch/scheduler jika ada).
5. Lainnya yang muncul di mockup (settings, audit, dll.).

### 6.2 Teknis front

- Types TypeScript selaras response API (`unit`, dll.).
- State management untuk run panjang (loading, partial result, error).
- Aksesibilitas & konsistensi layout mengikuti mockup.

**Deliverable fase 4:** semua route di mockup terhubung API nyata; tidak ada data statis palsu di jalur kritikal.

---

## 7. Fase 5 — QA, performa, go-live

| Area | Kegiatan |
|------|-----------|
| UAT | Skenario end-to-end dari upload → run → replenishment → dashboard. |
| Performa | Uji durasi per SKU; putuskan batas `n_gen`/`pop_size` production; skalakan batch nightly. |
| Keamanan | Validasi file upload (size, type), rate limit run berat jika perlu. |
| Deploy | Env DB, CORS, scheduler, migrasi, rollback buffer (archive). |

---

## 8. Milestone & estimasi kasar (dapat digeser setelah audit)

| Milestone | Isi | Catatan |
|-----------|-----|---------|
| M0 | Fase 0 selesai | Menentukan scope pasti & mengurangi rework. |
| M1 | Fase 1 selesai | Tanpa data benar, ML tidak bisa disertifikasi. |
| M2 | Fase 2 selesai | Parity hijau = risiko algoritma turun drastis. |
| M3 | Fase 3 selesai | Integrasi sistem lain bisa mulai. |
| M4 | Fase 4 selesai | Siap demo ke stakeholder dari mockup. |
| M5 | Fase 5 selesai | Siap production. |

Estimasi absolut bergantung pada hasil audit (berapa sel notebook berubah, berapa layar mockup). **Jangan mulai Fase 4 besar-besaran sebelum M1–M2** stabil.

---

## 9. Risiko & keputusan terbuka

1. **Mockup hanya gambar di DOCX** — gunakan **`Mockup.pdf`** di `resources_ext/` + **inventaris layar/field** (manual atau OCR) agar tidak ada interpretasi salah.
2. **README vs kode** — fitur yang sudah didokumentasikan belum tentu ada di repo; scope harus dikunci per fitur.
3. **Run sinkron vs antrian** — UX vs kompleksitas infrastruktur (Redis/RQ/Celery, dll.).
4. **Parity numerik** — float, seed GA, versi library: toleransi dan lingkungan harus disepakati.
5. **Zona waktu “hari ini”** untuk replenishment — kalender server vs kalender bisnis vs tanggal data terakhir.

---

## 10. Checklist “ready to start development”

- [ ] Tabel kolom `Data 2.xlsx` vs DB disetujui.
- [ ] Daftar layar + field dari **`Mockup.pdf`** disetujui (salinan teks / OCR jika perlu).
- [ ] Daftar endpoint final + ownership (internal vs integrasi) disetujui.
- [ ] Toleransi parity & SKU UAT disepakati.
- [ ] Strategi migrasi DB (Alembic) disepakati untuk lingkungan production.

---

## Referensi file di repo

- Notebook: `resources_ext/DDMRP_Hybrid_Algorithm_Last_Version.ipynb`
- Dataset: `resources_ext/Data 2.xlsx`
- Mockup: `resources_ext/Mockup.docx`, `resources_ext/Mockup.pdf`
- Dokumentasi produk / API: `README.md`
- Rencana lama (Phase 4): `resources_ext/implementation_plan.md` — **tetap arsip referensi**; rencana besar ini: **`resources_ext/IMPLEMENTATION_PLAN_LARGE_CHANGE.md`** (file ini).
