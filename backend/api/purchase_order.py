"""
Purchase order API — operational loop (P1).
"""
from __future__ import annotations

import os
from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from database import get_db
from services import open_order_service as po_svc

router = APIRouter(prefix="/api/purchase-orders", tags=["purchase-orders"])

# Background auto-receive loop config (thread lives in main.py, state read/written from there
# and exposed here so the frontend PO module can poll it).
AUTO_RECEIVE_ENABLED = os.getenv("AUTO_RECEIVE_ENABLED", "1") == "1"
AUTO_RECEIVE_INTERVAL_MINUTES = int(os.getenv("AUTO_RECEIVE_INTERVAL_MINUTES", "30"))

auto_receive_state = {
    "enabled": AUTO_RECEIVE_ENABLED,
    "running": False,
    "last_run_at": None,
    "last_checked": 0,
    "last_received": 0,
}


class CreatePOBody(BaseModel):
    sku: str = Field(..., min_length=1)
    qty: float = Field(..., gt=0)
    order_date: Optional[str] = None
    notes: Optional[str] = None
    source: str = "replenishment"


class ReceivePOBody(BaseModel):
    receipt_qty: Optional[float] = Field(None, gt=0)


def _parse_date_opt(s: Optional[str]) -> Optional[date]:
    if not s or not str(s).strip():
        return None
    try:
        return date.fromisoformat(str(s).strip()[:10])
    except ValueError as e:
        raise HTTPException(400, f"Invalid date: {s}") from e


def _http_from_value_error(e: ValueError) -> HTTPException:
    msg = str(e)
    code = 404 if "not found" in msg.lower() or "no active buffer" in msg.lower() else 400
    if "already exists" in msg.lower():
        code = 409
    return HTTPException(status_code=code, detail=msg)


@router.post("")
def create_purchase_order(body: CreatePOBody, db: Session = Depends(get_db)):
    try:
        po = po_svc.create_draft_po(
            db,
            body.sku,
            body.qty,
            order_date=_parse_date_opt(body.order_date),
            notes=body.notes,
            source=body.source,
        )
        return po_svc.po_to_dict(po)
    except ValueError as e:
        raise _http_from_value_error(e) from e


@router.post("/{po_id}/confirm")
def confirm_purchase_order(po_id: int, db: Session = Depends(get_db)):
    try:
        return po_svc.confirm_po(db, po_id)
    except ValueError as e:
        raise _http_from_value_error(e) from e


@router.post("/{po_id}/receive")
def receive_purchase_order(
    po_id: int,
    body: ReceivePOBody | None = None,
    db: Session = Depends(get_db),
):
    try:
        rq = body.receipt_qty if body else None
        return po_svc.receive_po(db, po_id, receipt_qty=rq)
    except ValueError as e:
        raise _http_from_value_error(e) from e


@router.post("/{po_id}/cancel")
def cancel_purchase_order(po_id: int, db: Session = Depends(get_db)):
    try:
        return po_svc.cancel_po(db, po_id)
    except ValueError as e:
        raise _http_from_value_error(e) from e


@router.get("")
def list_purchase_orders(
    sku: Optional[str] = None,
    status: Optional[str] = None,
    buffer_id: Optional[int] = None,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
):
    po_svc.auto_receive_all_due_pos(db)
    return po_svc.list_pos(
        db,
        sku=sku,
        status=status,
        buffer_id=buffer_id,
        limit=limit,
        offset=offset,
    )


@router.get("/auto-receive-status")
def get_auto_receive_status():
    """Registered before `/{po_id}` — a literal path segment must precede a path param
    route or FastAPI tries to parse "auto-receive-status" as an int po_id and 422s."""
    return {
        "interval_minutes": AUTO_RECEIVE_INTERVAL_MINUTES,
        **auto_receive_state,
    }


@router.post("/auto-receive-due")
def trigger_auto_receive_due(db: Session = Depends(get_db)):
    """Manual trigger for ops/testing — the background loop in main.py runs this periodically."""
    return po_svc.auto_receive_all_due_pos(db)


@router.get("/{po_id}")
def get_purchase_order(po_id: int, db: Session = Depends(get_db)):
    try:
        po_svc.auto_receive_all_due_pos(db)
        return po_svc.get_po(db, po_id)
    except ValueError as e:
        raise _http_from_value_error(e) from e
