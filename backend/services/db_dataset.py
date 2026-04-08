"""
Build sales + master DataFrames from PostgreSQL/SQLite (uploaded via Master Data).
Same column names as Excel-backed data_loader for hybrid_forecast compatibility.
"""
from __future__ import annotations

from typing import Any, Dict

import pandas as pd
from sqlalchemy import or_
from sqlalchemy.orm import Session

from models import DailyRecord, SKUMaster


def _master_row_dict(m: SKUMaster) -> Dict[str, Any]:
    sku = str(m.sku).strip()
    harga = float(m.harga or 0)
    purch = float(m.purchase_price or 0)
    hold_r = float(m.holding_cost_rate_day or 0)
    lost = float(m.lost_sale_rate_each or 0)
    log_cost = float(m.logistic_cost_order or 0)
    return {
        "Material Number": sku,
        "Lead Time_Days": int(m.lead_time or 0),
        "Sales Price": harga,
        "Purchase Price": purch,
        "Holding Cost Rate/day": hold_r,
        "Lost Sale Rate/Each": lost,
        "Logistic Cost/Order": log_cost,
        "MOQ": int(m.moq or 1),
        # pack_size in master acts as carton mapping (pcs per carton) when provided.
        "Qty Per Carton": int(m.pack_size or 1),
        "Material Group": str(m.group or m.nama_item or ""),
    }


def load_sales_master_frames_from_db(db: Session) -> Dict[str, pd.DataFrame]:
    masters = (
        db.query(SKUMaster)
        .filter(
            or_(
                SKUMaster.status == "Active",
                SKUMaster.status.is_(None),
                SKUMaster.status == "",
            )
        )
        .all()
    )
    if not masters:
        return {
            "sales": pd.DataFrame(
                columns=[
                    "ID Item",
                    "Date",
                    "Demand ",
                    "Nama Item",
                    "Sales Price Price After Discont",
                    "IsPromo",
                    "PromoDiscountPct",
                    "PromoType",
                ]
            ),
            "master": pd.DataFrame(
                columns=[
                    "Material Number",
                    "Lead Time_Days",
                    "Sales Price",
                    "Purchase Price",
                    "Holding Cost Rate/day",
                    "Lost Sale Rate/Each",
                    "Logistic Cost/Order",
                    "MOQ",
                    "Qty Per Carton",
                    "Material Group",
                ]
            ),
        }

    master_df = pd.DataFrame([_master_row_dict(m) for m in masters])
    master_df["Material Number"] = master_df["Material Number"].astype(str)

    sku_set = {str(m.sku).strip() for m in masters}

    sales_list = []
    if sku_set:
        dr_rows = (
            db.query(DailyRecord, SKUMaster)
            .join(SKUMaster, DailyRecord.sku == SKUMaster.sku)
            .filter(DailyRecord.sku.in_(list(sku_set)))
            .all()
        )
    else:
        dr_rows = []

    for dr, sm in dr_rows:
        promo = float(dr.promo_discount or 0)
        harga = float(sm.harga or 0)
        sales_list.append(
            {
                "ID Item": str(dr.sku).strip(),
                "Date": dr.date,
                "Demand ": float(dr.demand or 0),
                "Nama Item": sm.nama_item or "",
                "Sales Price Price After Discont": harga,
                "IsPromo": promo > 0,
                "PromoDiscountPct": promo,
                "PromoType": "NONE",
            }
        )

    sales_df = pd.DataFrame(sales_list)
    if not sales_df.empty:
        sales_df["Date"] = pd.to_datetime(sales_df["Date"])

    return {"sales": sales_df, "master": master_df}
