#!/usr/bin/env python3
"""
Seed / update sku_master from resources_ext/Data 2 June.csv (21 columns, delimiter ';').

Docker (from repo root):
  ./docker-seed-master.sh
  docker compose exec -T backend python scripts/seed_data2_june.py --update

Local (sqlite, only if DATABASE_URL not set to Postgres):
  cd backend && python3 scripts/seed_data2_june.py
"""
from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent
REPO_ROOT = BACKEND_DIR.parent
sys.path.insert(0, str(BACKEND_DIR))
os.chdir(BACKEND_DIR)

from database import SessionLocal, engine  # noqa: E402
from models import Base, SKUMaster  # noqa: E402
from schema_migrate import migrate_sku_master_columns  # noqa: E402
from services.master_upload_parse import (  # noqa: E402
    _coerce_master_sku_upload,
    read_master_upload_dataframe,
    sku_master_payload_from_parsed,
)


def _default_csv() -> Path:
    for candidate in (
        REPO_ROOT / "resources_ext" / "Data 2 June.csv",
        Path("/app/resources_ext/Data 2 June.csv"),
    ):
        if candidate.is_file():
            return candidate
    return REPO_ROOT / "resources_ext" / "Data 2 June.csv"


def seed_master_csv(
    db,
    csv_path: Path,
    *,
    fresh_master: bool = False,
    dry_run: bool = False,
) -> dict[str, int]:
    if not csv_path.is_file():
        raise FileNotFoundError(f"CSV not found: {csv_path}")

    df = read_master_upload_dataframe(str(csv_path))
    tidy = _coerce_master_sku_upload(df)

    if fresh_master and not dry_run:
        db.query(SKUMaster).delete()
        db.commit()

    inserted = updated = 0
    for _, row in tidy.iterrows():
        sku = str(row["sku"]).strip()
        payload = sku_master_payload_from_parsed(row)
        existing = db.query(SKUMaster).filter(SKUMaster.sku == sku).first()
        if dry_run:
            if existing:
                updated += 1
            else:
                inserted += 1
            continue
        if existing:
            for k, v in payload.items():
                setattr(existing, k, v)
            updated += 1
        else:
            db.add(SKUMaster(sku=sku, target_sl=0.95, **payload))
            inserted += 1

    if not dry_run:
        db.commit()

    return {
        "rows_in_file": len(tidy),
        "inserted": inserted,
        "updated": updated,
        "fresh_master": int(fresh_master),
        "dry_run": int(dry_run),
    }


def main() -> int:
    ap = argparse.ArgumentParser(description="Seed sku_master from Data 2 June.csv")
    ap.add_argument("--csv", type=Path, default=None, help="Path to master CSV")
    ap.add_argument(
        "--update",
        action="store_true",
        help="Upsert rows (default mode)",
    )
    ap.add_argument(
        "--fresh-master",
        action="store_true",
        help="Delete all sku_master rows before import",
    )
    ap.add_argument("--dry-run", action="store_true", help="Parse only, no DB commit")
    ap.add_argument("-q", "--quiet", action="store_true")
    args = ap.parse_args()

    csv_path = Path(args.csv).resolve() if args.csv else _default_csv()

    Base.metadata.create_all(bind=engine)
    migrate_sku_master_columns(engine)

    db = SessionLocal()
    try:
        stats = seed_master_csv(
            db,
            csv_path,
            fresh_master=args.fresh_master,
            dry_run=args.dry_run,
        )
    finally:
        db.close()

    if not args.quiet:
        print(f"Database: {engine.url!r}")
        print(f"CSV: {csv_path}")
        for k, v in stats.items():
            print(f"  {k}: {v}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
