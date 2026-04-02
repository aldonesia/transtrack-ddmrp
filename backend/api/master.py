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

from database import get_db
from models import DailyRecord, SKUMaster

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


@router.get("/template/master-sku")
def download_master_sku_template():
    df = pd.DataFrame(
        {
            "Material Number": [1000001, 1000002],
            "Material Group": ["FOOD-DRY", "BEVERAGE"],
            "Lead Time_Days": [3, 5],
            "Sales Price": [12000, 9000],
            "Purchase Price": [9000, 7000],
            "Holding Cost Rate/day": [0.00015, 0.00012],
            "Lost Sale Rate/Each": [0.15, 0.12],
            "Logistic Cost/Order": [750000, 750000],
            "MOQ": [100, 50],
        }
    )
    buf = BytesIO()
    df.to_excel(buf, index=False, sheet_name="master_sku")
    buf.seek(0)
    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": 'attachment; filename="master_sku_template.xlsx"'},
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


def _coerce_master_sku_upload(df: pd.DataFrame) -> pd.DataFrame:
    dfn = _normalize_column_map(df)

    required = {
        "material number": "material_number",
        "material group": "material_group",
        "lead time_days": "lead_time_days",
        "sales price": "sales_price",
        "purchase price": "purchase_price",
        "holding cost rate/day": "holding_cost_rate_day",
        "lost sale rate/each": "lost_sale_rate_each",
        "logistic cost/order": "logistic_cost_order",
        "moq": "moq",
    }
    missing = [k for k in required if k not in dfn.columns]
    if missing:
        raise ValueError(
            "Kolom Master SKU tidak lengkap. Wajib: "
            f"{', '.join(required.keys())}. Missing: {', '.join(missing)}"
        )

    rows = []
    for _, row in dfn.iterrows():
        try:
            sku = str(int(pd.to_numeric(row["material number"], errors="raise"))).strip()
            if not sku:
                continue
            material_group = str(row["material group"]).strip()
            lead_time = int(pd.to_numeric(row["lead time_days"], errors="raise"))
            sales_price = float(pd.to_numeric(row["sales price"], errors="raise"))
            purchase_price = float(pd.to_numeric(row["purchase price"], errors="raise"))
            holding_cost_rate_day = float(pd.to_numeric(row["holding cost rate/day"], errors="raise"))
            lost_sale_rate_each = float(pd.to_numeric(row["lost sale rate/each"], errors="raise"))
            logistic_cost_order = float(pd.to_numeric(row["logistic cost/order"], errors="raise"))
            moq = int(pd.to_numeric(row["moq"], errors="raise"))
            if moq <= 0:
                continue
        except Exception:
            continue
        rows.append(
            {
                "sku": sku,
                "group": material_group,
                "lead_time": max(0, lead_time),
                "harga": max(0.0, sales_price),
                "purchase_price": max(0.0, purchase_price),
                "holding_cost_rate_day": max(0.0, holding_cost_rate_day),
                "lost_sale_rate_each": max(0.0, lost_sale_rate_each),
                "logistic_cost_order": max(0.0, logistic_cost_order),
                "moq": max(1, moq),
            }
        )
    if not rows:
        raise ValueError("Tidak ada baris valid setelah parsing Master SKU.")
    return pd.DataFrame(rows)


def _validate_master_sku_upload(df: pd.DataFrame) -> dict[str, Any]:
    dfn = _normalize_column_map(df)
    required = [
        "material number",
        "material group",
        "lead time_days",
        "sales price",
        "purchase price",
        "holding cost rate/day",
        "lost sale rate/each",
        "logistic cost/order",
        "moq",
    ]
    missing = [k for k in required if k not in dfn.columns]
    if missing:
        return {
            "ok": False,
            "error": f"Missing columns: {', '.join(missing)}",
            "total_rows": len(dfn),
            "valid_rows": 0,
            "error_rows": len(dfn),
            "errors": [{"row": None, "message": f"Missing columns: {', '.join(missing)}"}],
            "preview": [],
        }

    valid = []
    errors = []
    for idx, row in dfn.iterrows():
        row_no = int(idx) + 2
        try:
            sku = str(int(pd.to_numeric(row["material number"], errors="raise"))).strip()
            group = str(row["material group"]).strip()
            lead_time = int(pd.to_numeric(row["lead time_days"], errors="raise"))
            sales_price = float(pd.to_numeric(row["sales price"], errors="raise"))
            purchase_price = float(pd.to_numeric(row["purchase price"], errors="raise"))
            holding = float(pd.to_numeric(row["holding cost rate/day"], errors="raise"))
            lost = float(pd.to_numeric(row["lost sale rate/each"], errors="raise"))
            log_cost = float(pd.to_numeric(row["logistic cost/order"], errors="raise"))
            moq = int(pd.to_numeric(row["moq"], errors="raise"))
            if not sku:
                raise ValueError("Material Number kosong")
            if moq <= 0:
                raise ValueError("MOQ harus > 0")
            valid.append(
                {
                    "sku": sku,
                    "group": group,
                    "lead_time": max(0, lead_time),
                    "sales_price": max(0.0, sales_price),
                    "purchase_price": max(0.0, purchase_price),
                    "holding_cost_rate_day": max(0.0, holding),
                    "lost_sale_rate_each": max(0.0, lost),
                    "logistic_cost_order": max(0.0, log_cost),
                    "moq": max(1, moq),
                }
            )
        except Exception as e:
            errors.append({"row": row_no, "message": str(e)})

    return {
        "ok": True,
        "total_rows": len(dfn),
        "valid_rows": len(valid),
        "error_rows": len(errors),
        "errors": errors[:50],
        "preview": valid[:20],
    }


def _validate_demand_upload(df: pd.DataFrame, db: Session) -> dict[str, Any]:
    dfn = _normalize_column_map(df)
    col_date = next((c for c in ("date", "tanggal", "tgl", "periode") if c in dfn.columns), None)
    col_sku = next((c for c in ("sku", "id item", "id_item", "material", "material number", "kode") if c in dfn.columns), None)
    col_dem = next((c for c in ("demand", "qty", "quantity", "jumlah", "sales") if c in dfn.columns), None)
    col_promo = next((c for c in ("promo discount", "promo_discount", "diskon", "promo") if c in dfn.columns), None)
    if not col_date or not col_sku or not col_dem:
        return {
            "ok": False,
            "error": "Missing required columns for demand upload",
            "total_rows": len(dfn),
            "valid_rows": 0,
            "error_rows": len(dfn),
            "errors": [{"row": None, "message": "Need Date, SKU, Demand"}],
            "preview": [],
        }

    valid = []
    errors = []
    sku_cache: dict[str, bool] = {}
    for idx, row in dfn.iterrows():
        row_no = int(idx) + 2
        try:
            dt = _parse_date(row[col_date])
            sku = str(row[col_sku]).strip()
            if not sku or sku.lower() == "nan":
                raise ValueError("SKU kosong")
            exists = sku_cache.get(sku)
            if exists is None:
                exists = db.query(SKUMaster).filter(SKUMaster.sku == sku).first() is not None
                sku_cache[sku] = exists
            if not exists:
                raise ValueError(f"SKU {sku} belum ada di master")
            demand = float(pd.to_numeric(row[col_dem], errors="raise"))
            promo = 0.0
            if col_promo:
                promo = float(pd.to_numeric(row[col_promo], errors="coerce") or 0)
            valid.append({"date": str(dt), "sku": sku, "demand": demand, "promo_discount": promo})
        except Exception as e:
            errors.append({"row": row_no, "message": str(e)})

    return {
        "ok": True,
        "total_rows": len(dfn),
        "valid_rows": len(valid),
        "error_rows": len(errors),
        "errors": errors[:50],
        "preview": valid[:20],
    }


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


@router.post("/validate/master-sku")
async def validate_master_sku(
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
    _ = db  # keep signature consistent for future DB-based validation extensions
    return _validate_master_sku_upload(df)


@router.post("/upload/master-sku")
async def upload_master_sku(
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
        tidy = _coerce_master_sku_upload(df)
    except ValueError as e:
        raise HTTPException(400, str(e)) from e

    inserted = 0
    updated = 0
    for _, row in tidy.iterrows():
        sku = str(row["sku"]).strip()
        existing = db.query(SKUMaster).filter(SKUMaster.sku == sku).first()
        payload = {
            "group": row["group"],
            "nama_item": row["group"],  # fallback: no item name in provided columns
            "lead_time": int(row["lead_time"]),
            "harga": float(row["harga"]),
            "purchase_price": float(row["purchase_price"]),
            "holding_cost_rate_day": float(row["holding_cost_rate_day"]),
            "lost_sale_rate_each": float(row["lost_sale_rate_each"]),
            "logistic_cost_order": float(row["logistic_cost_order"]),
            "moq": int(row["moq"]),
            "pack_size": int(row["moq"]),
            "status": "Active",
        }
        if existing:
            for k, v in payload.items():
                setattr(existing, k, v)
            updated += 1
        else:
            db.add(
                SKUMaster(
                    sku=sku,
                    unit="pcs",
                    target_sl=0.95,
                    **payload,
                )
            )
            inserted += 1
    db.commit()
    return {"ok": True, "inserted": inserted, "updated": updated, "rows_in_file": len(tidy)}


@router.post("/validate/demand")
async def validate_demand(
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
    return _validate_demand_upload(df, db)


@router.get("/demand")
def list_demand(
    db: Session = Depends(get_db),
    limit: int = 100,
    sku: Optional[str] = None,
):
    """
    List uploaded demand rows from DB.
    Used by `/master/demand` UI to show "daftar list demand".
    """
    limit = max(1, min(int(limit), 500))
    q = (
        db.query(DailyRecord, SKUMaster.nama_item, SKUMaster.group)
        .join(SKUMaster, DailyRecord.sku == SKUMaster.sku)
        .order_by(DailyRecord.date.desc(), DailyRecord.id.desc())
        .limit(limit)
    )
    if sku:
        sku_s = str(sku).strip()
        q = q.filter(DailyRecord.sku == sku_s)

    rows = q.all()
    return {
        "rows": [
            {
                "id": int(dr.id),
                "date": dr.date.isoformat() if dr.date is not None else None,
                "sku": dr.sku,
                "nama_item": nama_item,
                "group": grp,
                "demand": float(dr.demand or 0),
                "promo_discount": float(dr.promo_discount or 0),
            }
            for (dr, nama_item, grp) in rows
        ]
    }


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
