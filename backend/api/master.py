"""
Master SKU + demand upload — feeds analytics (DB-backed dataset).
"""
from __future__ import annotations

import re
from datetime import date, datetime
from io import BytesIO
from typing import Any, Optional

import pandas as pd
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.models import DailyRecord, SKUMaster

router = APIRouter(prefix="/api/master", tags=["master"])


@router.get("/template/demand")
def download_demand_template():
    df = pd.DataFrame(
        {
            "Date": [date(2026, 1, 1), date(2026, 1, 2)],
            "SKU": ["1000001", "1000001"],
            "Demand": [120, 95],
            "Promo_Discount": [0.0, 0.0],
        }
    )
    buf = BytesIO()
    df.to_excel(buf, index=False, sheet_name="demand")
    buf.seek(0)
    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": 'attachment; filename="demand_template.xlsx"'},
    )


class SKUMasterIn(BaseModel):
    sku: str = Field(..., min_length=1, max_length=64)
    nama_item: str = ""
    unit: str = "pcs"
    lead_time: int = Field(1, ge=0)
    moq: int = Field(1, ge=1)
    pack_size: int = Field(1, ge=1)
    harga: float = Field(0, ge=0)
    target_sl: float = Field(0.95, ge=0, le=1)
    status: str = "Active"
    group: Optional[str] = None
    purchase_price: float = Field(0, ge=0)
    holding_cost_rate_day: float = Field(0, ge=0)
    lost_sale_rate_each: float = Field(0, ge=0)
    logistic_cost_order: float = Field(0, ge=0)


def _parse_date(val: Any) -> date:
    if isinstance(val, datetime):
        return val.date()
    if isinstance(val, date):
        return val
    if pd.isna(val):
        raise ValueError("empty date")
    return pd.to_datetime(val).date()


def _normalize_column_map(df: pd.DataFrame) -> pd.DataFrame:
    mapping = {}
    for c in df.columns:
        key = str(c).strip().lower()
        key = re.sub(r"\s+", " ", key)
        mapping[c] = key
    out = df.rename(columns=mapping)
    return out


def _coerce_demand_upload(df: pd.DataFrame) -> pd.DataFrame:
    dfn = _normalize_column_map(df)
    col_date = None
    for cand in ("date", "tanggal", "tgl", "periode"):
        if cand in dfn.columns:
            col_date = cand
            break
    col_sku = None
    for cand in ("sku", "id item", "id_item", "material", "material number", "kode"):
        if cand in dfn.columns:
            col_sku = cand
            break
    col_dem = None
    for cand in ("demand", "qty", "quantity", "jumlah", "sales"):
        if cand in dfn.columns:
            col_dem = cand
            break
    col_promo = None
    for cand in ("promo discount", "promo_discount", "diskon", "promo"):
        if cand in dfn.columns:
            col_promo = cand
            break
    if not col_date or not col_sku or not col_dem:
        raise ValueError(
            "Kolom wajib tidak ditemukan. Gunakan Date/Tanggal, SKU/ID Item, Demand/Qty "
            f"(kolom saat ini: {list(dfn.columns)})"
        )
    rows = []
    for _, row in dfn.iterrows():
        try:
            dt = _parse_date(row[col_date])
            sku = str(row[col_sku]).strip()
            if not sku or sku.lower() == "nan":
                continue
            dem = float(pd.to_numeric(row[col_dem], errors="coerce") or 0)
            promo = 0.0
            if col_promo:
                promo = float(pd.to_numeric(row[col_promo], errors="coerce") or 0)
        except Exception:
            continue
        rows.append({"date": dt, "sku": sku, "demand": dem, "promo_discount": promo})
    if not rows:
        raise ValueError("Tidak ada baris valid setelah parsing.")
    return pd.DataFrame(rows)


@router.get("/skus")
def list_master_skus(db: Session = Depends(get_db)):
    rows = db.query(SKUMaster).order_by(SKUMaster.sku).all()
    return {
        "skus": [
            {
                "sku": r.sku,
                "nama_item": r.nama_item,
                "unit": r.unit,
                "lead_time": r.lead_time,
                "moq": r.moq,
                "pack_size": r.pack_size,
                "harga": r.harga,
                "target_sl": r.target_sl,
                "status": r.status,
                "group": r.group,
                "purchase_price": r.purchase_price,
                "holding_cost_rate_day": r.holding_cost_rate_day,
                "lost_sale_rate_each": r.lost_sale_rate_each,
                "logistic_cost_order": r.logistic_cost_order,
            }
            for r in rows
        ]
    }


@router.post("/skus")
def create_or_update_sku(body: SKUMasterIn, db: Session = Depends(get_db)):
    sku = body.sku.strip()
    existing = db.query(SKUMaster).filter(SKUMaster.sku == sku).first()
    if existing:
        for k, v in body.model_dump().items():
            if k == "sku":
                continue
            setattr(existing, k, v)
        db.commit()
        db.refresh(existing)
        return {"ok": True, "sku": sku, "action": "updated"}
    row = SKUMaster(
        sku=sku,
        nama_item=body.nama_item,
        unit=body.unit,
        lead_time=body.lead_time,
        moq=body.moq,
        pack_size=body.pack_size,
        harga=body.harga,
        target_sl=body.target_sl,
        status=body.status,
        group=body.group,
        purchase_price=body.purchase_price,
        holding_cost_rate_day=body.holding_cost_rate_day,
        lost_sale_rate_each=body.lost_sale_rate_each,
        logistic_cost_order=body.logistic_cost_order,
    )
    db.add(row)
    db.commit()
    return {"ok": True, "sku": sku, "action": "created"}


@router.post("/upload/demand")
async def upload_demand(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    if not file.filename:
        raise HTTPException(400, "File kosong.")
    raw = await file.read()
    try:
        df = pd.read_excel(BytesIO(raw))
    except Exception as e:
        raise HTTPException(400, f"Gagal baca Excel: {e}") from e
    try:
        tidy = _coerce_demand_upload(df)
    except ValueError as e:
        raise HTTPException(400, str(e)) from e

    inserted = 0
    updated = 0
    for _, row in tidy.iterrows():
        sku = str(row["sku"]).strip()
        master = db.query(SKUMaster).filter(SKUMaster.sku == sku).first()
        if not master:
            raise HTTPException(
                400,
                f"SKU {sku} belum ada di master. Tambahkan di tab Master SKU terlebih dahulu.",
            )
        rec = (
            db.query(DailyRecord)
            .filter(
                DailyRecord.sku == sku,
                DailyRecord.date == row["date"],
            )
            .first()
        )
        if rec:
            rec.demand = float(row["demand"])
            rec.promo_discount = float(row.get("promo_discount", 0) or 0)
            updated += 1
        else:
            db.add(
                DailyRecord(
                    date=row["date"],
                    sku=sku,
                    demand=float(row["demand"]),
                    promo_discount=float(row.get("promo_discount", 0) or 0),
                )
            )
            inserted += 1
    db.commit()
    return {"ok": True, "inserted": inserted, "updated": updated, "rows_in_file": len(tidy)}
