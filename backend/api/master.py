"""
Master SKU + demand upload — feeds analytics (DB-backed dataset).
"""
from __future__ import annotations

from collections import Counter
from datetime import date
from io import BytesIO
from typing import Any, Optional

import pandas as pd
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from database import get_db
from models import DailyRecord, SKUMaster
from services.master_upload_parse import (
    DEMAND_EXCEL_COLUMNS,
    MASTER_SKU_ALLOWED_UNITS,
    MASTER_SKU_EXCEL_COLUMNS,
    _coerce_demand_upload,
    _coerce_master_sku_upload,
    _first_existing_col,
    _format_date_dd_mm_yy,
    _missing_master_columns_message,
    _normalize_column_map,
    _parse_date,
    _parse_master_sku_row,
    _required_master_column_keys,
    _sku_key_from_excel,
    _str_cell,
    demand_template_sample_rows,
    master_sku_template_sample_rows,
    sku_master_payload_from_parsed,
    sku_master_row_to_excel,
)

router = APIRouter(prefix="/api/master", tags=["master"])


def _parse_opt_date(s: Optional[str]) -> Optional[date]:
    if not s or not str(s).strip():
        return None
    try:
        return date.fromisoformat(str(s).strip()[:10])
    except ValueError:
        return None


async def _read_demand_dataframe(file: UploadFile, raw: bytes) -> pd.DataFrame:
    fn = (file.filename or "").lower()
    try:
        if fn.endswith(".csv"):
            return pd.read_csv(BytesIO(raw))
        return pd.read_excel(BytesIO(raw))
    except Exception as e:
        raise HTTPException(400, f"Gagal baca file: {e}") from e


@router.get("/template/demand")
def download_demand_template():
    """Full Data 2 column layout: ID Item; Nama Item; Date; Demand ; …PromoType."""
    df = pd.DataFrame(
        demand_template_sample_rows(),
        columns=list(DEMAND_EXCEL_COLUMNS),
    )
    buf = BytesIO()
    df.to_excel(buf, index=False, sheet_name="sales")
    buf.seek(0)
    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": 'attachment; filename="demand_template.xlsx"'},
    )


@router.get("/template/master-sku")
def download_master_sku_template():
    """Headers & order = `sku_master` / Data 2: Material Number … Logistic Cost/Order."""
    df = pd.DataFrame(master_sku_template_sample_rows(), columns=list(MASTER_SKU_EXCEL_COLUMNS))
    buf = BytesIO()
    df.to_excel(buf, index=False, sheet_name="sku_master")
    buf.seek(0)
    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": 'attachment; filename="master_sku_template.xlsx"'},
    )



@router.get("/export/master-sku")
def export_master_sku(db: Session = Depends(get_db)):
    rows = db.query(SKUMaster).order_by(SKUMaster.sku).all()
    df = pd.DataFrame(
        [sku_master_row_to_excel(r) for r in rows],
        columns=list(MASTER_SKU_EXCEL_COLUMNS),
    )
    buf = BytesIO()
    df.to_excel(buf, index=False, sheet_name="sku_master")
    buf.seek(0)
    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": 'attachment; filename="master_sku_export.xlsx"'},
    )


class SKUMasterIn(BaseModel):
    sku: str = Field(..., min_length=1, max_length=64)
    nama_item: str = ""
    unit: str = "pcs"
    lead_time: int = Field(1, ge=0)
    moq: Optional[int] = Field(default=None, ge=1)
    harga: float = Field(0, ge=0)
    target_sl: float = Field(0.95, ge=0, le=1)
    status: str = "Active"
    group: Optional[str] = None
    purchase_price: float = Field(0, ge=0)
    holding_cost_rate_day: float = Field(0, ge=0)
    lost_sale_rate_each: float = Field(0, ge=0)
    logistic_cost_order: float = Field(0, ge=0)
    criticality: Optional[str] = None
    abc_class: Optional[str] = None
    xyz_class: Optional[str] = None
    vendor_type: Optional[str] = None
    currency: Optional[str] = None
    holding_cost_day_idr: Optional[float] = Field(default=None, ge=0)
    penalty_per_unit_idr: Optional[float] = Field(default=None, ge=0)
    initial_inventory: Optional[float] = Field(default=None, ge=0)
    qmax: Optional[int] = Field(default=None, ge=1)
    target_percentile: Optional[float] = Field(default=0.95, ge=0, le=1)
    use_forecast: Optional[bool] = Field(default=True)


def _effective_moq(m: Optional[int]) -> int:
    if m is None or m < 1:
        return 1
    return int(m)


def _normalize_master_unit(unit: str) -> str:
    u = str(unit or "EA").strip().upper()
    if u not in MASTER_SKU_ALLOWED_UNITS:
        allowed = ", ".join(sorted(MASTER_SKU_ALLOWED_UNITS))
        raise HTTPException(
            status_code=400,
            detail=f"Unit {u!r} invalid. Allowed: {allowed}",
        )
    return u


def _validate_master_sku_upload(df: pd.DataFrame) -> dict[str, Any]:
    dfn = _normalize_column_map(df)
    required = _required_master_column_keys()
    missing = [k for k in required if k not in dfn.columns]
    if missing:
        msg = _missing_master_columns_message(missing)
        return {
            "ok": False,
            "error": msg,
            "total_rows": len(dfn),
            "valid_rows": 0,
            "error_rows": len(dfn),
            "errors": [{"row": None, "message": msg}],
            "preview": [],
            "expected_columns": list(MASTER_SKU_EXCEL_COLUMNS),
        }

    col_status = _first_existing_col(dfn, ("status",))
    valid = []
    errors = []
    for idx, row in dfn.iterrows():
        row_no = int(idx) + 2
        try:
            parsed = _parse_master_sku_row(row)
            if col_status:
                parsed["status"] = _str_cell(row, col_status, "Active") or "Active"
            valid.append(parsed)
        except Exception as e:
            errors.append({"row": row_no, "message": str(e)})

    return {
        "ok": True,
        "total_rows": len(dfn),
        "valid_rows": len(valid),
        "error_rows": len(errors),
        "errors": errors[:50],
        "preview": valid[:20],
        "expected_columns": list(MASTER_SKU_EXCEL_COLUMNS),
    }


def _validate_demand_upload(df: pd.DataFrame, db: Session) -> dict[str, Any]:
    dfn = _normalize_column_map(df)
    col_date = next((c for c in ("date", "tanggal", "tgl", "periode") if c in dfn.columns), None)
    col_sku = next((c for c in ("sku", "id item", "id_item", "material", "material number", "kode") if c in dfn.columns), None)
    col_dem = next((c for c in ("demand", "qty", "quantity", "jumlah", "sales") if c in dfn.columns), None)
    col_promo = next(
        (
            c
            for c in (
                "promo discount",
                "promo_discount",
                "promodiscountpct",
                "diskon",
                "promo",
            )
            if c in dfn.columns
        ),
        None,
    )
    if not col_date or not col_sku or not col_dem:
        return {
            "ok": False,
            "error": "Missing required columns for demand upload",
            "total_rows": len(dfn),
            "valid_rows": 0,
            "error_rows": len(dfn),
            "errors": [{"row": None, "message": "Need Date, SKU, Demand"}],
            "preview": [],
            "unique_skus": 0,
            "duplicate_rows_in_file": 0,
        }

    valid = []
    errors = []
    sku_cache: dict[str, bool] = {}
    for idx, row in dfn.iterrows():
        row_no = int(idx) + 2
        try:
            dt = _parse_date(row[col_date])
            sku = _sku_key_from_excel(row[col_sku])
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
                raw_promo = pd.to_numeric(row[col_promo], errors="coerce")
                if pd.notna(raw_promo):
                    promo = float(raw_promo)
                    if col_promo == "promodiscountpct" and promo > 1.0:
                        promo = promo / 100.0
            valid.append(
                {
                    "date": _format_date_dd_mm_yy(dt),
                    "sku": sku,
                    "demand": demand,
                    "promo_discount": promo,
                }
            )
        except Exception as e:
            errors.append({"row": row_no, "message": str(e)})

    unique_skus = len({v["sku"] for v in valid})
    pair_counts = Counter((v["date"], v["sku"]) for v in valid)
    duplicate_rows_in_file = sum(c - 1 for c in pair_counts.values() if c > 1)

    return {
        "ok": True,
        "total_rows": len(dfn),
        "valid_rows": len(valid),
        "error_rows": len(errors),
        "errors": errors[:50],
        "preview": valid[:20],
        "unique_skus": unique_skus,
        "duplicate_rows_in_file": duplicate_rows_in_file,
    }


@router.get("/sku-groups")
def list_sku_groups(db: Session = Depends(get_db)):
    """Distinct Material Group values from sku_master (for form dropdowns)."""
    groups = [
        g[0]
        for g in (
            db.query(SKUMaster.group)
            .filter(SKUMaster.group.isnot(None), SKUMaster.group != "")
            .distinct()
            .order_by(SKUMaster.group)
            .all()
        )
        if g[0]
    ]
    return {"groups": groups}


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
                "harga": r.harga,
                "target_sl": r.target_sl,
                "status": r.status,
                "group": r.group,
                "purchase_price": r.purchase_price,
                "holding_cost_rate_day": r.holding_cost_rate_day,
                "lost_sale_rate_each": r.lost_sale_rate_each,
                "logistic_cost_order": r.logistic_cost_order,
                "criticality": getattr(r, "criticality", None),
                "abc_class": getattr(r, "abc_class", None),
                "xyz_class": getattr(r, "xyz_class", None),
                "vendor_type": getattr(r, "vendor_type", None),
                "currency": getattr(r, "currency", None),
                "holding_cost_day_idr": getattr(r, "holding_cost_day_idr", None),
                "penalty_per_unit_idr": getattr(r, "penalty_per_unit_idr", None),
                "initial_inventory": getattr(r, "initial_inventory", None),
                "qmax": getattr(r, "qmax", None),
                "target_percentile": getattr(r, "target_percentile", None),
                "use_forecast": getattr(r, "use_forecast", True) if getattr(r, "use_forecast", True) is not None else True,
            }
            for r in rows
        ]
    }


@router.post("/skus")
def create_or_update_sku(body: SKUMasterIn, db: Session = Depends(get_db)):
    sku = body.sku.strip()
    unit = _normalize_master_unit(body.unit)
    moq_v = _effective_moq(body.moq)
    existing = db.query(SKUMaster).filter(SKUMaster.sku == sku).first()
    if existing:
        data = body.model_dump()
        data.pop("sku", None)
        data["unit"] = unit
        data["moq"] = moq_v
        for k, v in data.items():
            setattr(existing, k, v)
        existing.pack_size = 1
        db.commit()
        db.refresh(existing)
        return {"ok": True, "sku": sku, "action": "updated"}
    row = SKUMaster(
        sku=sku,
        nama_item=body.nama_item,
        unit=unit,
        lead_time=body.lead_time,
        moq=moq_v,
        pack_size=1,
        harga=body.harga,
        target_sl=body.target_sl,
        status=body.status,
        group=body.group,
        purchase_price=body.purchase_price,
        holding_cost_rate_day=body.holding_cost_rate_day,
        lost_sale_rate_each=body.lost_sale_rate_each,
        logistic_cost_order=body.logistic_cost_order,
        criticality=body.criticality,
        abc_class=body.abc_class,
        xyz_class=body.xyz_class,
        vendor_type=body.vendor_type,
        currency=body.currency,
        holding_cost_day_idr=body.holding_cost_day_idr,
        penalty_per_unit_idr=body.penalty_per_unit_idr,
        initial_inventory=body.initial_inventory,
        qmax=body.qmax,
        target_percentile=body.target_percentile if body.target_percentile is not None else 0.95,
        use_forecast=body.use_forecast if body.use_forecast is not None else True,
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
        payload = sku_master_payload_from_parsed(row)
        if existing:
            for k, v in payload.items():
                setattr(existing, k, v)
            updated += 1
        else:
            db.add(
                SKUMaster(
                    sku=sku,
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
    df = await _read_demand_dataframe(file, raw)
    return _validate_demand_upload(df, db)


@router.get("/demand/summary")
def demand_summary(db: Session = Depends(get_db)):
    total = int(db.query(func.count(DailyRecord.id)).scalar() or 0)
    dmin, dmax = db.query(func.min(DailyRecord.date), func.max(DailyRecord.date)).one()
    days_span: Optional[int] = None
    if dmin is not None and dmax is not None:
        days_span = (dmax - dmin).days + 1
    sku_with_demand = int(db.query(func.count(func.distinct(DailyRecord.sku))).scalar() or 0)
    sku_active_master = int(
        db.query(func.count(SKUMaster.sku))
        .filter(
            or_(
                SKUMaster.status.is_(None),
                SKUMaster.status == "",
                SKUMaster.status == "Active",
            )
        )
        .scalar()
        or 0
    )
    demand_groups = [
        g[0]
        for g in (
            db.query(SKUMaster.group)
            .join(DailyRecord, DailyRecord.sku == SKUMaster.sku)
            .filter(SKUMaster.group.isnot(None), SKUMaster.group != "")
            .distinct()
            .order_by(SKUMaster.group)
            .all()
        )
        if g[0]
    ]
    return {
        "total_records": total,
        "date_min": dmin.isoformat() if dmin else None,
        "date_max": dmax.isoformat() if dmax else None,
        "days_span": days_span,
        "sku_with_demand": sku_with_demand,
        "sku_active_master": sku_active_master,
        "demand_groups": demand_groups,
    }


@router.get("/demand")
def list_demand(
    db: Session = Depends(get_db),
    limit: int = 100,
    offset: int = 0,
    sku: Optional[str] = None,
    search: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    group: Optional[str] = None,
    promo_only: bool = False,
):
    """
    List uploaded demand rows from DB (newest first).
    """
    limit = max(1, min(int(limit), 500))
    offset = max(0, int(offset))
    df_from = _parse_opt_date(date_from)
    df_to = _parse_opt_date(date_to)

    base = db.query(DailyRecord, SKUMaster.nama_item, SKUMaster.group).join(
        SKUMaster, DailyRecord.sku == SKUMaster.sku
    )
    if sku:
        base = base.filter(DailyRecord.sku == str(sku).strip())
    if search and str(search).strip():
        term = f"%{str(search).strip()}%"
        base = base.filter(
            or_(
                DailyRecord.sku.like(term),
                SKUMaster.nama_item.like(term),
                SKUMaster.group.like(term),
            )
        )
    if group and str(group).strip() and str(group).strip() != "__all__":
        base = base.filter(SKUMaster.group == str(group).strip())
    if df_from is not None:
        base = base.filter(DailyRecord.date >= df_from)
    if df_to is not None:
        base = base.filter(DailyRecord.date <= df_to)
    if promo_only:
        base = base.filter(
            DailyRecord.promo_discount.isnot(None),
            DailyRecord.promo_discount > 0,
        )

    ordered = base.order_by(DailyRecord.date.desc(), DailyRecord.id.desc())
    total = int(ordered.count())
    page_rows = ordered.offset(offset).limit(limit).all()

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
            for (dr, nama_item, grp) in page_rows
        ],
        "total": total,
    }


class DemandRowIn(BaseModel):
    sku: str = Field(..., min_length=1)
    date: str = Field(..., description="ISO date (YYYY-MM-DD)")
    demand: float = Field(..., ge=0)
    promo_discount: float = Field(0, ge=0)


def _demand_row_out(dr: DailyRecord, nama_item: Optional[str], group: Optional[str]) -> dict[str, Any]:
    return {
        "id": int(dr.id),
        "date": dr.date.isoformat() if dr.date is not None else None,
        "sku": dr.sku,
        "nama_item": nama_item,
        "group": group,
        "demand": float(dr.demand or 0),
        "promo_discount": float(dr.promo_discount or 0),
    }


@router.post("/demand")
def create_demand_row(body: DemandRowIn, db: Session = Depends(get_db)):
    sku = body.sku.strip()
    master = db.query(SKUMaster).filter(SKUMaster.sku == sku).first()
    if not master:
        raise HTTPException(400, f"SKU {sku} belum ada di master. Tambahkan di tab Master SKU terlebih dahulu.")
    d = _parse_opt_date(body.date)
    if d is None:
        raise HTTPException(400, f"Invalid date: {body.date}")
    exists = (
        db.query(DailyRecord)
        .filter(DailyRecord.sku == sku, DailyRecord.date == d)
        .first()
    )
    if exists:
        raise HTTPException(409, f"Demand for SKU {sku} on {body.date} already exists (id={exists.id}). Edit it instead.")
    row = DailyRecord(date=d, sku=sku, demand=float(body.demand), promo_discount=float(body.promo_discount))
    db.add(row)
    db.commit()
    db.refresh(row)
    return _demand_row_out(row, master.nama_item, master.group)


@router.put("/demand/{row_id}")
def update_demand_row(row_id: int, body: DemandRowIn, db: Session = Depends(get_db)):
    row = db.query(DailyRecord).filter(DailyRecord.id == row_id).first()
    if not row:
        raise HTTPException(404, f"Demand record {row_id} not found.")
    sku = body.sku.strip()
    master = db.query(SKUMaster).filter(SKUMaster.sku == sku).first()
    if not master:
        raise HTTPException(400, f"SKU {sku} belum ada di master. Tambahkan di tab Master SKU terlebih dahulu.")
    d = _parse_opt_date(body.date)
    if d is None:
        raise HTTPException(400, f"Invalid date: {body.date}")
    conflict = (
        db.query(DailyRecord)
        .filter(DailyRecord.sku == sku, DailyRecord.date == d, DailyRecord.id != row_id)
        .first()
    )
    if conflict:
        raise HTTPException(409, f"Demand for SKU {sku} on {body.date} already exists (id={conflict.id}).")
    row.sku = sku
    row.date = d
    row.demand = float(body.demand)
    row.promo_discount = float(body.promo_discount)
    db.commit()
    db.refresh(row)
    return _demand_row_out(row, master.nama_item, master.group)


@router.get("/export/demand")
def export_demand(db: Session = Depends(get_db)):
    rows = (
        db.query(DailyRecord)
        .order_by(DailyRecord.date.asc(), DailyRecord.sku.asc())
        .all()
    )
    df = pd.DataFrame(
        [
            {
                "Date": _format_date_dd_mm_yy(r.date) if r.date else None,
                "SKU": r.sku,
                "Demand": float(r.demand or 0),
                "Promo_Discount": float(r.promo_discount or 0),
            }
            for r in rows
        ]
    )
    buf = BytesIO()
    df.to_excel(buf, index=False, sheet_name="demand")
    buf.seek(0)
    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": 'attachment; filename="demand_export.xlsx"'},
    )


@router.post("/upload/demand")
async def upload_demand(
    file: UploadFile = File(...),
    mode: str = Form("upsert"),
    db: Session = Depends(get_db),
):
    if not file.filename:
        raise HTTPException(400, "File kosong.")
    raw = await file.read()
    df = await _read_demand_dataframe(file, raw)
    try:
        tidy = _coerce_demand_upload(df)
    except ValueError as e:
        raise HTTPException(400, str(e)) from e

    insert_only = str(mode).strip().lower() in ("insert_only", "insert", "tambah")

    inserted = 0
    updated = 0
    skipped = 0
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
            if insert_only:
                skipped += 1
                continue
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
    return {
        "ok": True,
        "inserted": inserted,
        "updated": updated,
        "skipped": skipped,
        "rows_in_file": len(tidy),
    }
