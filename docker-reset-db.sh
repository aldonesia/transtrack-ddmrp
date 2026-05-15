#!/usr/bin/env bash
# Kosongkan database Postgres di stack Docker (sku_master, daily_record, buffer, dll.)
# Prasyarat: `docker compose up -d` dan container backend berjalan.
set -euo pipefail
cd "$(dirname "$0")"

echo "Menjalankan reset database di container backend …"
docker compose exec -T backend python scripts/reset_database.py --yes
echo "Selesai."
echo ""
echo "Alur uji: 1) Master Data → unggah Master SKU (Excel)  2) Master Demand → unggah demand (Excel)."
echo "Pastikan frontend memanggil API lokal (mis. NEXT_PUBLIC_API_URL=http://localhost:8000) bila UI di host."
