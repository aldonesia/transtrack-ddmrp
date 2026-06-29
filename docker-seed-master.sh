#!/usr/bin/env bash
# Seed / update sku_master dari resources_ext/Data 2 June.csv (stack Docker harus running).
set -euo pipefail
cd "$(dirname "$0")"

ARGS=("$@")
if [ ${#ARGS[@]} -eq 0 ]; then
  ARGS=(--update)
fi

echo "Seeding master SKU (Data 2 June.csv) di container backend …"
docker compose exec -T backend python scripts/seed_data2_june.py "${ARGS[@]}"
echo "Selesai."
