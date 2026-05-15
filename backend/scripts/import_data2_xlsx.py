#!/usr/bin/env python3
"""
Load `resources_ext/Data 2.xlsx` (sheets `sku_master`, `sales`) into the app database.

Uses the same coercion rules as the Master Data API. Run from repo root or any cwd:

  cd backend && python3 scripts/import_data2_xlsx.py

Options:
  --xlsx PATH     Workbook path (default: <repo>/resources_ext/Data 2.xlsx)
  --fresh         Delete existing master + demand (+ forecast/buffer rows tied to SKU) then import
"""
from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent
REPO_ROOT = BACKEND_DIR.parent
sys.path.insert(0, str(BACKEND_DIR))

# Default DB file lives under backend/ when using sqlite URL from database.py
os.chdir(BACKEND_DIR)

import pandas as pd  # noqa: E402
from sqlalchemy.orm import Session  # noqa: E402

from database import SessionLocal, engine  # noqa: E402
from models import (  # noqa: E402
    Base,
    DDMRPBuffer,
    DDMRPBufferDetail,
    DailyRecord,
    ForecastRun,
    SKUMaster,
)
from schema_migrate import migrate_sku_master_columns  # noqa: E402
from services.master_upload_parse import _coerce_demand_upload, _coerce_master_sku_upload  # noqa: E402


def _default_xlsx() -> Path:
    p = REPO_ROOT / "resources_ext" / "Data 2.xlsx"
    return p


def _fresh_reset(db: Session) -> None:
    """Remove rows that block re-import or become inconsistent after full reload."""
    db.query(DDMRPBufferDetail).delete()
    db.query(DDMRPBuffer).delete()
    db.query(ForecastRun).delete()
    db.query(DailyRecord).delete()
    db.query(SKUMaster).delete()
    db.commit()


def import_workbook(db: Session, xlsx: Path, *, fresh: bool) -> dict[str, int]:
    if not xlsx.is_file():
        raise FileNotFoundError(f"Workbook not found: {xlsx}")

    if fresh:
        _fresh_reset(db)

    master_df = pd.read_excel(xlsx, sheet_name="sku_master")
    tidy_m = _coerce_master_sku_upload(master_df)

    inserted_m = updated_m = 0
    for _, row in tidy_m.iterrows():
        sku = str(row["sku"]).strip()
        payload = {
            "group": row["group"],
            "nama_item": row.get("nama_item") or row["group"],
            "unit": row.get("unit") or "pcs",
            "status": row.get("status") or "Active",
            "lead_time": int(row["lead_time"]),
            "harga": float(row["harga"]),
            "purchase_price": float(row["purchase_price"]),
            "holding_cost_rate_day": float(row["holding_cost_rate_day"]),
            "lost_sale_rate_each": float(row["lost_sale_rate_each"]),
            "logistic_cost_order": float(row["logistic_cost_order"]),
            "moq": int(row["moq"]),
            "pack_size": 1,
            "criticality": row.get("criticality"),
            "abc_class": row.get("abc_class"),
            "xyz_class": row.get("xyz_class"),
            "vendor_type": row.get("vendor_type"),
            "currency": row.get("currency"),
            "holding_cost_day_idr": row.get("holding_cost_day_idr"),
            "penalty_per_unit_idr": row.get("penalty_per_unit_idr"),
        }
        existing = db.query(SKUMaster).filter(SKUMaster.sku == sku).first()
        if existing:
            for k, v in payload.items():
                setattr(existing, k, v)
            updated_m += 1
        else:
            db.add(
                SKUMaster(
                    sku=sku,
                    target_sl=0.95,
                    **payload,
                )
            )
            inserted_m += 1
    db.commit()

    sales_df = pd.read_excel(xlsx, sheet_name="sales")
    tidy_d = _coerce_demand_upload(sales_df)

    inserted_d = updated_d = 0
    skipped = 0
    for _, row in tidy_d.iterrows():
        sku = str(row["sku"]).strip()
        master = db.query(SKUMaster).filter(SKUMaster.sku == sku).first()
        if not master:
            skipped += 1
            continue
        dt = row["date"]
        rec = (
            db.query(DailyRecord)
            .filter(DailyRecord.sku == sku, DailyRecord.date == dt)
            .first()
        )
        if rec:
            rec.demand = float(row["demand"])
            rec.promo_discount = float(row.get("promo_discount", 0) or 0)
            updated_d += 1
        else:
            db.add(
                DailyRecord(
                    date=dt,
                    sku=sku,
                    demand=float(row["demand"]),
                    promo_discount=float(row.get("promo_discount", 0) or 0),
                )
            )
            inserted_d += 1
    db.commit()

    return {
        "master_inserted": inserted_m,
        "master_updated": updated_m,
        "master_rows_file": len(tidy_m),
        "demand_inserted": inserted_d,
        "demand_updated": updated_d,
        "demand_rows_file": len(tidy_d),
        "demand_skipped_no_master": skipped,
    }


def main() -> int:
    ap = argparse.ArgumentParser(description="Import Data 2.xlsx into sku_master + daily_record")
    ap.add_argument("--xlsx", type=Path, default=None, help="Path to workbook")
    ap.add_argument(
        "--fresh",
        action="store_true",
        help="Truncate demand/master (+ forecast/buffer) before import",
    )
    args = ap.parse_args()
    xlsx = Path(args.xlsx).resolve() if args.xlsx else _default_xlsx()

    Base.metadata.create_all(bind=engine)
    migrate_sku_master_columns(engine)

    db = SessionLocal()
    try:
        stats = import_workbook(db, xlsx, fresh=args.fresh)
    finally:
        db.close()

    print(f"Database: {engine.url!r}")
    print(f"Workbook: {xlsx}")
    for k, v in stats.items():
        print(f"  {k}: {v}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
