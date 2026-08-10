# Panduan instalasi — IDAS (DDMRP)

Dokumen ini menjelaskan cara menjalankan aplikasi **IDAS** (*Inventory Decision Analytic System*) di lingkungan development (Docker) dan cara **menghapus database lama** lalu memulai dengan database kosong.

---

## Prasyarat

| Perangkat lunak | Versi minimum |
|-----------------|---------------|
| Docker | 20+ |
| Docker Compose | v2 |
| Git | opsional |

Port yang dipakai:

| Layanan | Port |
|---------|------|
| Frontend (UI) | **3001** |
| Backend (API) | **8000** |
| PostgreSQL | **5432** |

---

## 1. Clone / siapkan proyek

```bash
cd /path/to/ddmrp
```

Struktur penting:

```
ddmrp/
├── backend/          # FastAPI + SQLAlchemy
├── frontend/         # Next.js
├── resources_ext/    # Data 2 June, notebook acuan buffer v2
├── docker-compose.yml
├── docker-compose.dev.yml
├── docker-reset-db.sh
└── docker-seed-master.sh   # Seed master SKU (Data 2 June.csv)
```

**Dokumen v2 (buffer klasifikasi):**

| File | Isi |
|------|-----|
| [INTEGRATION_API_MANUAL_V2.md](./INTEGRATION_API_MANUAL_V2.md) | API integrasi `/integration/v2/*` |
| [USER_MANUAL_V2.md](./USER_MANUAL_V2.md) | Master 21 kolom, konsep buffer v2 |

---

## 2. Menjalankan stack development (disarankan)

Development memakai API di **localhost:8000** agar browser tidak memblokir panggilan ke IP privat.

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build
```

| URL | Keterangan |
|-----|------------|
| http://localhost:3001 | UI |
| http://localhost:8000/docs | Swagger API |
| http://localhost:8000/api/dashboard-summary | Cek API hidup |

Tunggu hingga container `ddmrp-backend` dan `ddmrp-db` sehat.

---

## 3. Database baru (PostgreSQL di Docker)

### 3.1 Pertama kali (volume kosong)

Saat pertama `docker compose up`, Postgres membuat database:

- **User:** `ddmrp_user`
- **Password:** `ddmrp_password`
- **Database:** `ddmrp_db`
- **Volume:** `postgres_data` (persisten)

Backend otomatis membuat tabel (`Base.metadata.create_all`) dan migrasi kolom ringan (`schema_migrate.py`) saat startup.

### 3.2 Isi data awal (opsional)

**Opsi A — UI**

1. Buka **Master Data** → unggah template Master SKU (Excel).
2. Buka **Master Demand** → unggah demand (Excel).

**Opsi B — CLI impor `Data 2.xlsx`**

```bash
docker compose exec backend python scripts/import_data2_xlsx.py
# atau kosongkan dulu lalu isi ulang:
docker compose exec backend python scripts/import_data2_xlsx.py --fresh
```

File default: `resources_ext/Data 2.xlsx`.

**Opsi C — Dataset Data 2 June (buffer v2, disarankan)**

Master 21 kolom + demand dari workbook June:

```bash
# Stack harus sudah running
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --build

# 1) Kosongkan DB (opsional, lingkungan uji bersih)
./docker-reset-db.sh

# 2) Seed master dari CSV (45 SKU, termasuk initial_inventory)
./docker-seed-master.sh

# 3) Import demand
docker compose exec -T backend python scripts/import_data2_xlsx.py \
  --xlsx "/app/resources_ext/Data 2 June.xlsx"
```

| Path host | Path container |
|-----------|----------------|
| `./resources_ext/Data 2 June.csv` | `/app/resources_ext/Data 2 June.csv` |
| `./resources_ext/Data 2 June.xlsx` | `/app/resources_ext/Data 2 June.xlsx` |

**Penting:** jalankan seeder **di dalam container** (`./docker-seed-master.sh`), bukan `python scripts/seed_data2_june.py` di host tanpa `DATABASE_URL` Postgres — data akan masuk SQLite lokal.

**Untuk production** (reset total + impor `Data 2 June.xlsx` sekaligus, dengan backup otomatis): pakai `./docker-reset-and-import.sh` dari root repo alih-alih 3 langkah manual di atas — lihat [README.md § Docker & reset database](../README.md#docker--reset-database).

Opsi seeder:

```bash
./docker-seed-master.sh --dry-run
docker compose exec -T backend python scripts/seed_data2_june.py --fresh-master
```

---

## 4. Menghapus database lama (reset data)

Pilih **satu** metode di bawah ini.

### Metode A — Kosongkan semua tabel (disarankan, volume Postgres tetap)

Menghapus **semua baris** di tabel operasional; skema tabel tetap ada.

```bash
./docker-reset-db.sh
```

Setara dengan:

```bash
docker compose exec -T backend python scripts/reset_database.py --yes
```

Tabel yang dikosongkan antara lain: `sku_master`, `daily_record`, `ddmrp_buffer`, `ddmrp_buffer_detail`, `forecast_run`, `purchase_order`, `sku_operational_state`, `nightly_job_run`.

Setelah reset:

1. Unggah ulang Master SKU + Demand, **atau**
2. Jalankan `import_data2_xlsx.py` seperti di atas.

### Metode B — Hapus volume Postgres (database benar-benar baru)

Gunakan jika ingin menghapus **seluruh** cluster data Postgres (termasuk struktur lama).

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml down
docker volume rm ddmrp_postgres_data 2>/dev/null || docker volume rm teaching-ddmrp_postgres_data
# Nama volume bisa berbeda; cek dengan: docker volume ls | grep postgres
```

Lalu naikkan stack lagi:

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build
```

Postgres akan membuat cluster kosong; backend membuat tabel saat pertama kali jalan.

### Metode C — SQLite lokal (tanpa Docker DB)

Jika `DATABASE_URL` tidak diset, backend memakai `backend/sql_app.db`.

Hapus file:

```bash
rm -f backend/sql_app.db
```

Restart backend; file DB baru dibuat otomatis.

Reset data SQLite:

```bash
cd backend
python3 scripts/reset_database.py --yes
```

---

## 5. Production / staging (tanpa overlay dev)

```bash
docker compose up --build -d
```

Frontend build memakai `NEXT_PUBLIC_API_URL` production (lihat `docker-compose.yml`). Untuk mengubah URL API, **rebuild** image frontend:

```bash
docker compose build --no-cache frontend
docker compose up -d
```

---

## 6. Variabel lingkungan penting

### Backend

| Variabel | Default | Keterangan |
|----------|---------|------------|
| `DATABASE_URL` | SQLite lokal | Di Docker: `postgresql://ddmrp_user:ddmrp_password@db/ddmrp_db` |
| `CORS_ORIGINS` | localhost + domain prod | Origin browser yang boleh memanggil API |
| `NIGHTLY_REFRESH_ENABLED` | `1` | Scheduler refresh harian |
| `NIGHTLY_POP_SIZE` / `NIGHTLY_N_GEN` | `24` / `40` | Parameter GA nightly |

### Frontend (build time)

| Variabel | Dev (`docker-compose.dev.yml`) |
|----------|--------------------------------|
| `NEXT_PUBLIC_API_URL` | `http://localhost:8000` |
| `NEXT_PUBLIC_APP_MODE` | `development` |

---

## 7. Verifikasi instalasi

```bash
# API
curl -s http://localhost:8000/api/dashboard-summary | head

# Dataset
curl -s http://localhost:8000/api/analytics/dataset-status

# Master June (setelah docker-seed-master.sh)
curl -s http://localhost:8000/api/master/skus | python3 -c \
  "import json,sys; print('SKU count', len(json.load(sys.stdin)['skus']))"
```

### Verifikasi buffer v2 (integrasi)

Prasyarat: master + demand sudah terisi (Opsi C di atas).

```bash
# Run v2 (n_gen minimal 5)
curl -s -X POST "http://localhost:8000/api/analytics/integration/v2/run" \
  -H "Content-Type: application/json" \
  -d '{"sku_no":"100008503","pop_size":8,"n_gen":5}' \
  | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('simulation_summary',{}).get('Method'), d.get('buffer_id'))"

# Ringkasan teks seperti notebook
curl -s "http://localhost:8000/api/analytics/integration/v2/result?sku_no=100008503" \
  | python3 -c "import json,sys; print(json.load(sys.stdin).get('simulation_summary_text','')[:200])"

# CSV harian → Excel
curl -s "http://localhost:8000/api/analytics/integration/v2/result?sku_no=100008503&csv=true" \
  -o /tmp/daily_simulation.csv && head -2 /tmp/daily_simulation.csv
```

Panduan lengkap: [INTEGRATION_API_MANUAL_V2.md](./INTEGRATION_API_MANUAL_V2.md).

### Unit test backend

```bash
cd backend && python3 -m unittest discover -s tests -p 'test_*.py' -v
# Parity v2 vs notebook (Data 2 June, ~2 menit)
cd backend && python3 -m unittest tests.test_buffer_v2_parity -v

# Regresi integrasi v1 (setelah buffer v2)
cd backend && python3 -m unittest tests.test_integration_v1_regression -v
```

---

## 8. Troubleshooting

| Gejala | Solusi |
|--------|--------|
| UI tidak bisa panggil API | Pastikan pakai `docker-compose.dev.yml` dan buka UI di `localhost:3001` |
| `No active buffer` di Replenishment | Jalankan **Analytics → Run full pipeline** (v1) atau `POST /integration/v2/run` (v2) |
| v2 run HTTP 400 `initial_inventory` | Jalankan `./docker-seed-master.sh` |
| v2 replenishment 404 | Buffer aktif masih v1 — run `POST /integration/v2/run` |
| `zsh: no matches found` pada curl | Quote URL: `curl "http://localhost:8000/...?sku_no=..."` |
| Port 5432 bentrok | Ubah mapping port di `docker-compose.yml` atau hentikan Postgres lokal |
| Perubahan `NEXT_PUBLIC_*` tidak terlihat | Rebuild image frontend (`--no-cache`) |

---

## Dokumen terkait

- [USER_MANUAL.md](./USER_MANUAL.md) — panduan pengguna aplikasi (UI v1)
- [USER_MANUAL_V2.md](./USER_MANUAL_V2.md) — buffer v2, master 21 kolom
- [INTEGRATION_API_MANUAL.md](./INTEGRATION_API_MANUAL.md) — API integrasi v1
- [INTEGRATION_API_MANUAL_V2.md](./INTEGRATION_API_MANUAL_V2.md) — API integrasi v2
- [../README.md](../README.md) — referensi teknis ringkas
