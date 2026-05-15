"""
Operational NFE recalc (no GA) — notebook-aligned QD, PO pipeline as OP.
"""
from __future__ import annotations

import json
from datetime import date, datetime, timedelta
from typing import Any, Dict, List, Optional, Tuple

import numpy as np
from sqlalchemy import func
from sqlalchemy.orm import Session

from models import (
    DDMRPBuffer,
    DDMRPBufferDetail,
    DailyRecord,
    ForecastRun,
    PurchaseOrder,
    SKUMaster,
    SkuOperationalState,
)
from services.hybrid_forecast import build_forecast_series_for_simulation

PO_STATUS_CONFIRMED = "confirmed"
PO_STATUS_RECEIVED = "received"


def compute_nfe(oh: float, op: float, qd: float) -> float:
    return float(oh) + float(op) - float(qd)


def zone_from_nfe(nfe: float, tor: float, toy: float) -> str:
    if nfe <= tor:
        return "RED"
    if nfe <= toy:
        return "YELLOW"
    return "GREEN"


def suggested_order_qty(nfe: float, toy: float, tog: float, pack_size: int) -> float:
    if nfe > toy:
        return 0.0
    ps = max(int(pack_size), 1)
    return float(max(int(max(tog - nfe, ps)), ps))


def get_active_buffer(db: Session, sku: str) -> DDMRPBuffer:
    buf = (
        db.query(DDMRPBuffer)
        .filter(DDMRPBuffer.sku == sku, DDMRPBuffer.status == "Active")
        .order_by(DDMRPBuffer.id.desc())
        .first()
    )
    if not buf:
        raise ValueError(f"No active buffer for SKU {sku}. Run forecast + optimization first.")
    return buf


def sum_confirmed_open_order(db: Session, sku: str, as_of: date) -> float:
    row = (
        db.query(func.coalesce(func.sum(PurchaseOrder.qty), 0.0))
        .filter(
            PurchaseOrder.sku == sku,
            PurchaseOrder.status == PO_STATUS_CONFIRMED,
            PurchaseOrder.expected_receipt_date > as_of,
        )
        .scalar()
    )
    return float(row or 0.0)


def list_confirmed_pos(
    db: Session,
    sku: str,
    *,
    buffer_id: Optional[int] = None,
) -> List[Dict[str, Any]]:
    q = db.query(PurchaseOrder).filter(
        PurchaseOrder.sku == sku,
        PurchaseOrder.status == PO_STATUS_CONFIRMED,
    )
    if buffer_id is not None:
        q = q.filter(PurchaseOrder.buffer_id == int(buffer_id))
    rows = q.order_by(PurchaseOrder.order_date.asc()).all()
    return [
        {
            "id": int(p.id),
            "qty": float(p.qty),
            "order_date": p.order_date.isoformat() if p.order_date else None,
            "expected_receipt_date": p.expected_receipt_date.isoformat()
            if p.expected_receipt_date
            else None,
            "unit": p.unit,
        }
        for p in rows
    ]


def _load_series_context(
    db: Session,
    sku: str,
    dlt: int,
) -> Tuple[List[date], np.ndarray, np.ndarray, Dict[date, int]]:
    rows = (
        db.query(DailyRecord.date, DailyRecord.demand)
        .filter(DailyRecord.sku == sku)
        .order_by(DailyRecord.date.asc())
        .all()
    )
    if not rows:
        empty = np.array([], dtype=float)
        return [], empty, empty, {}

    dates = [r.date for r in rows if r.date is not None]
    demands = np.array([float(r.demand or 0) for r in rows], dtype=float)
    forecast = np.maximum(demands.copy(), 0.0)

    run = (
        db.query(ForecastRun)
        .filter(ForecastRun.sku == sku)
        .order_by(ForecastRun.id.desc())
        .first()
    )
    if run and run.forecast_json:
        try:
            payload = json.loads(run.forecast_json)
            clean = np.array(payload.get("series_clean") or [], dtype=float)
            if len(clean) == len(demands):
                result_fc = {
                    "best_model": payload.get("best_model"),
                    "train_size": int(payload.get("train_size") or 0),
                    "predictions": payload.get("predictions") or {},
                }
                if result_fc["best_model"] and result_fc["predictions"]:
                    forecast = build_forecast_series_for_simulation(
                        result_fc, clean, dlt=dlt
                    )
        except (json.JSONDecodeError, TypeError, KeyError):
            pass

    if dlt > 0 and len(forecast) < len(demands) + dlt:
        pad = max(float(np.mean(demands)), 0.0) if len(demands) else 0.0
        forecast = np.concatenate([forecast, np.full(dlt, pad)])

    date_to_idx = {d: i for i, d in enumerate(dates)}
    return dates, demands, forecast, date_to_idx


def qualified_demand_at_index(
    t: Optional[int],
    demands: np.ndarray,
    forecast: np.ndarray,
    dlt: int,
    ost: float,
) -> float:
    """Notebook QD: demand[t] + sum forecast[t+1..t+dlt] where forecast > OST."""
    if t is None:
        return float(ost) * max(1, min(dlt, 1))
    qd = float(demands[t]) if t < len(demands) else float(ost)
    for k in range(1, dlt + 1):
        j = t + k
        if j < len(forecast) and float(forecast[j]) > ost:
            qd += float(forecast[j])
    return qd


def ensure_operational_state(
    db: Session,
    sku: str,
    buf: DDMRPBuffer,
    as_of: date,
) -> SkuOperationalState:
    state = db.query(SkuOperationalState).filter(SkuOperationalState.sku == sku).first()
    if state and int(state.buffer_id) == int(buf.id):
        return state
    if state:
        db.delete(state)
        db.flush()

    oh = float(buf.toy or 0.0)
    state = SkuOperationalState(
        sku=sku,
        as_of_date=as_of,
        on_hand=oh,
        buffer_id=int(buf.id),
        updated_at=datetime.utcnow(),
    )
    db.add(state)
    db.flush()
    return state


def seed_operational_state_for_buffer(db: Session, sku: str, buf: DDMRPBuffer) -> None:
    """P2: initialize OH=TOY when a new active buffer is saved from the pipeline."""
    if not buf.start_date:
        return
    existing = db.query(SkuOperationalState).filter(SkuOperationalState.sku == sku).first()
    if existing:
        db.delete(existing)
        db.flush()
    ensure_operational_state(db, sku, buf, buf.start_date)


def build_recalc_summary(
    *,
    sku: str,
    as_of: date,
    oh: float,
    op: float,
    qd: float,
    nfe: float,
    zone: str,
    suggested: float,
    tor: float,
    toy: float,
    tog: float,
    unit: str,
) -> Dict[str, Any]:
    return {
        "sku": sku,
        "as_of_date": as_of.isoformat(),
        "on_hand": round(oh, 2),
        "open_order": round(op, 2),
        "qualified_demand": round(qd, 2),
        "nfe": round(nfe, 2),
        "zone": zone,
        "suggested_order_qty": round(suggested, 2),
        "tor": round(tor, 2),
        "toy": round(toy, 2),
        "tog": round(tog, 2),
        "unit": unit,
    }


def get_operational_snapshot(
    db: Session,
    sku: str,
    as_of: Optional[date] = None,
) -> Dict[str, Any]:
    sku_s = str(sku).strip()
    buf = get_active_buffer(db, sku_s)
    day = as_of or buf.start_date
    if not day:
        raise ValueError("Active buffer missing start_date.")

    master = db.query(SKUMaster).filter(SKUMaster.sku == sku_s).first()
    unit = str(master.unit or "EA").strip().upper() if master else "EA"
    pack_size = int(master.pack_size or master.moq or 1) if master else 1

    state = db.query(SkuOperationalState).filter(SkuOperationalState.sku == sku_s).first()
    if not state or int(state.buffer_id) != int(buf.id):
        state = ensure_operational_state(db, sku_s, buf, day)

    oh = float(state.on_hand)
    op = sum_confirmed_open_order(db, sku_s, day)
    adu = float(buf.adu or 0.0)
    dlt = int(buf.dlt or 1)
    tor = float(buf.tor or 0.0)
    toy = float(buf.toy or 0.0)
    tog = float(buf.tog or 0.0)

    _, demands, forecast, date_to_idx = _load_series_context(db, sku_s, dlt)
    t = date_to_idx.get(day)
    qd = qualified_demand_at_index(t, demands, forecast, dlt, adu)
    nfe = compute_nfe(oh, op, qd)
    zone = zone_from_nfe(nfe, tor, toy)
    sug = suggested_order_qty(nfe, toy, tog, pack_size)

    return {
        "on_hand": round(oh, 2),
        "open_order": round(op, 2),
        "qualified_demand": round(qd, 2),
        "nfe": round(nfe, 2),
        "zone": zone,
        "suggested_order_qty": round(sug, 2),
        "confirmed_pos": list_confirmed_pos(db, sku_s, buffer_id=int(buf.id)),
        "unit": unit,
    }


def recalc_operational_nfe(
    db: Session,
    sku: str,
    as_of: Optional[date] = None,
) -> Dict[str, Any]:
    sku_s = str(sku).strip()
    buf = get_active_buffer(db, sku_s)
    if not buf.start_date:
        raise ValueError("Active buffer missing start_date.")

    start = buf.start_date
    end = buf.end_date or (start + timedelta(days=int(buf.dlt or 1) - 1))
    day = as_of or start

    master = db.query(SKUMaster).filter(SKUMaster.sku == sku_s).first()
    pack_size = int(master.pack_size or master.moq or 1) if master else 1
    unit = str(master.unit or "EA").strip().upper() if master else "EA"

    state = ensure_operational_state(db, sku_s, buf, day)
    oh = float(state.on_hand)
    op = sum_confirmed_open_order(db, sku_s, day)

    adu = float(buf.adu or 0.0)
    dlt = int(buf.dlt or 1)
    tor = float(buf.tor or 0.0)
    toy = float(buf.toy or 0.0)
    tog = float(buf.tog or 0.0)

    _, demands, forecast, date_to_idx = _load_series_context(db, sku_s, dlt)

    last_summary: Dict[str, Any] = {}
    cur = start
    while cur <= end:
        t = date_to_idx.get(cur)
        qd = qualified_demand_at_index(t, demands, forecast, dlt, adu)
        nfe = compute_nfe(oh, op, qd)
        zone = zone_from_nfe(nfe, tor, toy)
        sug = suggested_order_qty(nfe, toy, tog, pack_size)

        detail = (
            db.query(DDMRPBufferDetail)
            .filter(DDMRPBufferDetail.buffer_id == buf.id, DDMRPBufferDetail.date == cur)
            .first()
        )
        if detail:
            detail.nfe = round(nfe, 2)
            detail.zone = zone
            detail.order_qty = sug
        else:
            db.add(
                DDMRPBufferDetail(
                    buffer_id=buf.id,
                    date=cur,
                    nfe=round(nfe, 2),
                    zone=zone,
                    order_qty=sug,
                )
            )

        if cur == day:
            last_summary = build_recalc_summary(
                sku=sku_s,
                as_of=cur,
                oh=oh,
                op=op,
                qd=qd,
                nfe=nfe,
                zone=zone,
                suggested=sug,
                tor=tor,
                toy=toy,
                tog=tog,
                unit=unit,
            )
        cur += timedelta(days=1)

    state.as_of_date = day
    state.buffer_id = int(buf.id)
    state.updated_at = datetime.utcnow()
    db.flush()
    return last_summary
