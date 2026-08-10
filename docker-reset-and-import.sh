#!/usr/bin/env bash
# Reset database (SEMUA tabel operasional) lalu impor ulang dari workbook Excel
# Data 2 — sheet `sku_master` -> SKUMaster, sheet `sales` -> DailyRecord (demand).
#
# PERINGATAN — DESTRUKTIF: menghapus seluruh sku_master, daily_record, ddmrp_buffer,
# ddmrp_buffer_detail, forecast_run, purchase_order, sku_operational_state, dan
# nightly_job_run sebelum mengisi ulang dari file Excel. Tidak bisa dibatalkan
# kecuali dari backup. Default-nya skrip ini SELALU mengambil pg_dump dulu dan
# meminta konfirmasi eksplisit sebelum menghapus apa pun.
#
# Prasyarat: `docker compose up -d` dan container `backend` + `db` sudah berjalan
# (lihat docker-compose.yml — untuk prod tanpa overlay dev).
#
# Penggunaan (dari root repo):
#   ./docker-reset-and-import.sh
#       Pakai default resources_ext/Data 2 June.xlsx, backup otomatis + konfirmasi interaktif.
#
#   ./docker-reset-and-import.sh --xlsx "resources_ext/Data 2.xlsx"
#       Pakai workbook lain (harus ada di folder resources_ext/, sesuai volume mount compose).
#
#   ./docker-reset-and-import.sh --yes
#       Lewati prompt konfirmasi (mis. dijalankan dari CI/automation). Backup tetap jalan.
#
#   ./docker-reset-and-import.sh --skip-backup
#       Lewati pg_dump. TIDAK disarankan di production — hanya untuk DB yang memang
#       masih kosong / lingkungan uji.
#
#   ./docker-reset-and-import.sh --backup-dir ./backups
#       Ubah folder tujuan backup (default: ./backups, relatif ke root repo, ditambahkan
#       ke .gitignore secara otomatis oleh skrip ini bila belum ada).
#
# Skrip ini murni orkestrasi tipis di atas skrip yang sudah ada dan teruji:
#   backend/scripts/reset_database.py       (hapus semua baris operasional)
#   backend/scripts/import_data2_xlsx.py    (impor sheet sku_master + sales)

set -euo pipefail
cd "$(dirname "$0")"

XLSX_HOST_ARG="Data 2 June.xlsx"
CONFIRM=1
DO_BACKUP=1
BACKUP_DIR="./backups"

usage() {
  sed -n '2,33p' "$0" | sed 's/^# \{0,1\}//'
}

while [ $# -gt 0 ]; do
  case "$1" in
    --xlsx)
      XLSX_HOST_ARG="$2"
      shift 2
      ;;
    --yes | -y)
      CONFIRM=0
      shift
      ;;
    --skip-backup)
      DO_BACKUP=0
      shift
      ;;
    --backup-dir)
      BACKUP_DIR="$2"
      shift 2
      ;;
    -h | --help)
      usage
      exit 0
      ;;
    *)
      echo "Argumen tidak dikenal: $1" >&2
      usage
      exit 2
      ;;
  esac
done

# --xlsx boleh diberi path relatif ke resources_ext/ atau path lengkap "resources_ext/...";
# di dalam container, resources_ext/ di-mount ke /app/resources_ext (lihat docker-compose.yml).
XLSX_BASENAME="$(basename "$XLSX_HOST_ARG")"
XLSX_HOST_PATH="resources_ext/$XLSX_BASENAME"
XLSX_CONTAINER_PATH="/app/resources_ext/$XLSX_BASENAME"

if ! docker compose ps backend db >/dev/null 2>&1; then
  echo "Container 'backend'/'db' tidak terdeteksi lewat 'docker compose ps'. Pastikan stack sudah 'docker compose up -d' di direktori ini." >&2
  exit 1
fi

if [ ! -f "$XLSX_HOST_PATH" ]; then
  echo "File tidak ditemukan di host: $XLSX_HOST_PATH" >&2
  exit 1
fi

echo "== 1) Validasi workbook =="
docker compose exec -T backend python -c "
import sys
import pandas as pd
path = '$XLSX_CONTAINER_PATH'
try:
    xl = pd.ExcelFile(path)
except FileNotFoundError:
    print(f'File tidak ditemukan di container: {path}', file=sys.stderr)
    sys.exit(1)
missing = [s for s in ('sku_master', 'sales') if s not in xl.sheet_names]
if missing:
    print(f'Sheet hilang di workbook: {missing} (ada: {xl.sheet_names})', file=sys.stderr)
    sys.exit(1)
m = xl.parse('sku_master')
s = xl.parse('sales')
print(f'  sku_master : {len(m)} baris, {m[\"Material Number\"].nunique()} SKU unik')
print(f'  sales      : {len(s)} baris, {s[\"ID Item\"].nunique()} SKU unik, tanggal {s[\"Date\"].min()} s.d. {s[\"Date\"].max()}')
" < /dev/null
echo "Workbook valid: $XLSX_HOST_PATH"
echo ""

DB_URL_MASKED="$(docker compose exec -T backend printenv DATABASE_URL < /dev/null 2>/dev/null | tr -d '\r' | sed -E 's#//[^@]+@#//***:***@#')"
DB_URL_MASKED="${DB_URL_MASKED:-'(tidak diset — fallback SQLite lokal di container backend)'}"

echo "== 2) Target database =="
echo "  DATABASE_URL : $DB_URL_MASKED"
echo ""
echo "Operasi ini akan MENGHAPUS SEMUA DATA operasional (SKU, demand, buffer, forecast,"
echo "purchase order, state operasional, riwayat nightly) lalu mengisi ulang dari:"
echo "  $XLSX_HOST_PATH"
echo ""

if [ "$CONFIRM" -eq 1 ]; then
  read -r -p "Ketik RESET PRODUCTION untuk melanjutkan: " ans
  if [ "$ans" != "RESET PRODUCTION" ]; then
    echo "Dibatalkan."
    exit 1
  fi
fi

if [ "$DO_BACKUP" -eq 1 ]; then
  echo ""
  echo "== 3) Backup (pg_dump) =="
  mkdir -p "$BACKUP_DIR"
  if [ -d .git ] && ! grep -qxF "$(basename "$BACKUP_DIR")/" .gitignore 2>/dev/null; then
    echo "$(basename "$BACKUP_DIR")/" >> .gitignore
  fi
  BACKUP_FILE="$BACKUP_DIR/ddmrp_backup_$(date +%Y%m%d_%H%M%S).sql"
  if docker compose exec -T db bash -c 'pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB"' < /dev/null > "$BACKUP_FILE" 2>backup.err; then
    SIZE="$(du -h "$BACKUP_FILE" | cut -f1)"
    echo "Backup tersimpan: $BACKUP_FILE ($SIZE)"
    rm -f backup.err
  else
    echo "Backup GAGAL:" >&2
    cat backup.err >&2
    rm -f "$BACKUP_FILE" backup.err
    echo "Menghentikan proses — tidak ada data yang diubah. Jalankan backup manual, atau ulangi dengan --skip-backup jika memang disengaja (tidak disarankan di production)." >&2
    exit 1
  fi
else
  echo ""
  echo "== 3) Backup dilewati (--skip-backup) =="
fi

echo ""
echo "== 4) Reset database =="
docker compose exec -T backend python scripts/reset_database.py --yes < /dev/null

echo ""
echo "== 5) Impor $XLSX_BASENAME (sku_master -> SKUMaster, sales -> DailyRecord) =="
docker compose exec -T backend python scripts/import_data2_xlsx.py --xlsx "$XLSX_CONTAINER_PATH" < /dev/null

echo ""
echo "Selesai."
echo ""
echo "Langkah berikutnya (data belum bisa dipakai Replenishment/PO sampai ini dijalankan):"
echo "  1. Untuk tiap SKU aktif: Analytics & Buffer -> pilih SKU -> Run full pipeline"
echo "     (atau POST /api/analytics/run per SKU / tunggu scheduler harian 01:00)."
echo "  2. Cek GET /api/dashboard-summary dan halaman Replenishment untuk verifikasi."
