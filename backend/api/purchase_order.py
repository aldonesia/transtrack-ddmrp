"""
Purchase order API — operational loop (P1).
"""
from __future__ import annotations

from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from database import get_db
from services import open_order_service as po_svc

router = APIRouter(prefix="/api/purchase-orders", tags=["purchase-orders"])


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
    return po_svc.list_pos(
        db,
        sku=sku,
        status=status,
        buffer_id=buffer_id,
        limit=limit,
        offset=offset,
    )


@router.get("/{po_id}")
def get_purchase_order(po_id: int, db: Session = Depends(get_db)):
    try:
        return po_svc.get_po(db, po_id)
    except ValueError as e:
        raise _http_from_value_error(e) from e
