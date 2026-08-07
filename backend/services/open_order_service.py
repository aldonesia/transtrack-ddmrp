"""
Purchase order lifecycle (draft → confirmed → received / cancelled).
"""
from __future__ import annotations

import math
from datetime import date, datetime, timedelta
from typing import Any, Dict, List, Optional

from sqlalchemy.orm import Session

from models import DDMRPBuffer, PurchaseOrder, SKUMaster
from services.operational_nfe import (
    PO_STATUS_CONFIRMED,
    PO_STATUS_RECEIVED,
    get_active_buffer,
    recalc_operational_nfe,
)

PO_STATUS_DRAFT = "draft"
PO_STATUS_CANCELLED = "cancelled"

ONE_PO_PER_DAY_PER_SKU = True


def _norm_sku(sku: str) -> str:
    return str(sku).strip()


def _round_order_qty(qty: float, moq: int, pack_size: int) -> float:
    moq_v = max(int(moq or 1), 1)
    pack_v = max(int(pack_size or moq_v), 1)
    q = max(float(qty), 0.0)
    if q <= 0:
        raise ValueError("Quantity must be greater than zero.")
    if q < moq_v:
        q = float(moq_v)
    if pack_v > 1:
        q = float(math.ceil(q / pack_v) * pack_v)
    return q


def _lead_time_days(master: Optional[SKUMaster], buf: DDMRPBuffer) -> int:
    if master and master.lead_time is not None and int(master.lead_time) > 0:
        return int(master.lead_time)
    return int(buf.dlt or 1)


def po_to_dict(po: PurchaseOrder) -> Dict[str, Any]:
    return {
        "id": int(po.id),
        "sku": po.sku,
        "buffer_id": int(po.buffer_id),
        "order_date": po.order_date.isoformat() if po.order_date else None,
        "qty": float(po.qty),
        "unit": po.unit,
        "expected_receipt_date": po.expected_receipt_date.isoformat()
        if po.expected_receipt_date
        else None,
        "status": po.status,
        "source": po.source,
        "created_at": po.created_at.isoformat() if po.created_at else None,
        "confirmed_at": po.confirmed_at.isoformat() if po.confirmed_at else None,
        "received_at": po.received_at.isoformat() if po.received_at else None,
        "notes": po.notes,
    }


def create_draft_po(
    db: Session,
    sku: str,
    qty: float,
    *,
    buffer_id: Optional[int] = None,
    order_date: Optional[date] = None,
    notes: Optional[str] = None,
    source: str = "replenishment",
) -> PurchaseOrder:
    sku_s = _norm_sku(sku)
    buf = get_active_buffer(db, sku_s)
    if buffer_id is not None and int(buffer_id) != int(buf.id):
        raise ValueError("buffer_id does not match active buffer for this SKU.")

    master = db.query(SKUMaster).filter(SKUMaster.sku == sku_s).first()
    if not master:
        raise ValueError(f"SKU {sku_s} not found in master data.")

    moq = int(master.moq or 1)
    pack_size = int(master.pack_size or moq)
    qty_r = _round_order_qty(qty, moq, pack_size)

    od = order_date or buf.start_date
    if not od:
        raise ValueError("No order_date and buffer has no start_date.")

    lt = _lead_time_days(master, buf)
    expected = od + timedelta(days=lt)
    unit = str(master.unit or "EA").strip().upper()

    po = PurchaseOrder(
        sku=sku_s,
        buffer_id=int(buf.id),
        order_date=od,
        qty=qty_r,
        unit=unit,
        expected_receipt_date=expected,
        status=PO_STATUS_DRAFT,
        source=source,
        created_at=datetime.utcnow(),
        notes=notes,
    )
    db.add(po)
    db.commit()
    db.refresh(po)
    return po


def _get_po(db: Session, po_id: int) -> PurchaseOrder:
    po = db.query(PurchaseOrder).filter(PurchaseOrder.id == int(po_id)).first()
    if not po:
        raise ValueError(f"Purchase order {po_id} not found.")
    return po


def _check_duplicate_confirmed(db: Session, sku: str, order_date: date, exclude_id: int) -> None:
    if not ONE_PO_PER_DAY_PER_SKU:
        return
    exists = (
        db.query(PurchaseOrder.id)
        .filter(
            PurchaseOrder.sku == sku,
            PurchaseOrder.order_date == order_date,
            PurchaseOrder.status == PO_STATUS_CONFIRMED,
            PurchaseOrder.id != exclude_id,
        )
        .first()
    )
    if exists:
        raise ValueError(
            f"A confirmed PO already exists for SKU {sku} on {order_date.isoformat()}."
        )


def confirm_po(db: Session, po_id: int) -> Dict[str, Any]:
    po = _get_po(db, po_id)
    if po.status != PO_STATUS_DRAFT:
        raise ValueError(f"Cannot confirm PO in status '{po.status}'.")

    _check_duplicate_confirmed(db, po.sku, po.order_date, po.id)

    po.status = PO_STATUS_CONFIRMED
    po.confirmed_at = datetime.utcnow()
    db.commit()

    recalc = recalc_operational_nfe(db, po.sku, as_of=po.order_date)
    db.commit()

    db.refresh(po)
    return {"po": po_to_dict(po), "recalc": recalc}


def receive_po(
    db: Session,
    po_id: int,
    receipt_qty: Optional[float] = None,
) -> Dict[str, Any]:
    po = _get_po(db, po_id)
    if po.status != PO_STATUS_CONFIRMED:
        raise ValueError(f"Cannot receive PO in status '{po.status}'.")

    qty_in = float(receipt_qty if receipt_qty is not None else po.qty)
    if qty_in <= 0:
        raise ValueError("receipt_qty must be greater than zero.")

    from models import SkuOperationalState

    state = db.query(SkuOperationalState).filter(SkuOperationalState.sku == po.sku).first()
    if state:
        state.on_hand = float(state.on_hand) + qty_in
        state.updated_at = datetime.utcnow()

    po.status = PO_STATUS_RECEIVED
    po.received_at = datetime.utcnow()
    db.commit()

    as_of = po.expected_receipt_date or po.order_date
    recalc = recalc_operational_nfe(db, po.sku, as_of=as_of)
    db.commit()

    db.refresh(po)
    return {"po": po_to_dict(po), "recalc": recalc}


def auto_receive_all_due_pos(db: Session) -> Dict[str, Any]:
    """Auto-receive confirmed POs whose lead time has elapsed.

    "Elapsed" is judged against each SKU's own buffer reference date
    (`DDMRPBuffer.start_date`, the app's simulated "today" — see
    `api/analytics.py:get_replenishment`), not wall-clock date, so this stays
    consistent with the NFE/zone math the rest of the operational loop uses.
    Received qty moves from open order (OP) into on-hand stock (OH) via
    `receive_po`.
    """
    due = (
        db.query(PurchaseOrder)
        .join(DDMRPBuffer, DDMRPBuffer.id == PurchaseOrder.buffer_id)
        .filter(
            PurchaseOrder.status == PO_STATUS_CONFIRMED,
            DDMRPBuffer.start_date.isnot(None),
            PurchaseOrder.expected_receipt_date <= DDMRPBuffer.start_date,
        )
        .all()
    )

    received: List[Dict[str, Any]] = []
    failed: List[Dict[str, Any]] = []
    for po in due:
        try:
            result = receive_po(db, po.id)
            received.append(result["po"])
        except ValueError as e:
            failed.append({"po_id": int(po.id), "error": str(e)})

    return {"checked": len(due), "received": len(received), "pos": received, "failed": failed}


def cancel_po(db: Session, po_id: int) -> Dict[str, Any]:
    po = _get_po(db, po_id)
    if po.status == PO_STATUS_RECEIVED:
        raise ValueError("Cannot cancel a received PO.")
    if po.status == PO_STATUS_CANCELLED:
        raise ValueError("PO is already cancelled.")

    was_confirmed = po.status == PO_STATUS_CONFIRMED
    po.status = PO_STATUS_CANCELLED
    db.commit()

    recalc = None
    if was_confirmed:
        recalc = recalc_operational_nfe(db, po.sku, as_of=po.order_date)
        db.commit()

    db.refresh(po)
    out: Dict[str, Any] = {"po": po_to_dict(po)}
    if recalc is not None:
        out["recalc"] = recalc
    return out


def list_pos(
    db: Session,
    *,
    sku: Optional[str] = None,
    status: Optional[str] = None,
    buffer_id: Optional[int] = None,
    limit: int = 50,
    offset: int = 0,
) -> Dict[str, Any]:
    q = db.query(PurchaseOrder).order_by(PurchaseOrder.id.desc())
    if sku:
        q = q.filter(PurchaseOrder.sku == _norm_sku(sku))
    if status:
        q = q.filter(PurchaseOrder.status == str(status).strip().lower())
    if buffer_id is not None:
        q = q.filter(PurchaseOrder.buffer_id == int(buffer_id))

    total = q.count()
    rows = q.offset(max(offset, 0)).limit(min(max(limit, 1), 200)).all()
    return {
        "total": total,
        "limit": limit,
        "offset": offset,
        "rows": [po_to_dict(p) for p in rows],
    }


def get_po(db: Session, po_id: int) -> Dict[str, Any]:
    return po_to_dict(_get_po(db, po_id))
