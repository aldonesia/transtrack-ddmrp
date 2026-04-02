"""
Forecast + buffer optimization API (DDMRP_Hybrid_Algorithm.ipynb).
Reads sales + master from database (upload via Master Data).
"""
from __future__ import annotations

from typing import Any, Dict

import numpy as np
import pandas as pd
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import func
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.models import DailyRecord
from backend.services.data_loader import get_sku_list
from backend.services.db_dataset import load_sales_master_frames_from_db
from backend.services.hybrid_pipeline import (
    run_buffer_optimization,
    run_forecast_for_api,
)

router = APIRouter(prefix="/api/analytics", tags=["analytics"])


def _get_data(db: Session):
    return load_sales_master_frames_from_db(db)


def _sanitize(obj: Any) -> Any:
    if obj is None:
        return None
    if isinstance(obj, dict):
        return {k: _sanitize(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_sanitize(x) for x in obj]
    if isinstance(obj, (np.floating, float)):
        x = float(obj)
        if np.isnan(x) or np.isinf(x):
            return None
        return x
    if isinstance(obj, (np.integer, int)):
        return int(obj)
    if isinstance(obj, np.ndarray):
        return obj.tolist()
    if isinstance(obj, pd.DataFrame):
        return _sanitize(obj.where(pd.notnull(obj), None).to_dict("records"))
    if isinstance(obj, pd.Series):
        return obj.where(pd.notnull(obj), None).tolist()
    return obj


def _forecast_to_response(result: Dict[str, Any]) -> Dict[str, Any]:
    cmp_df = result["comparison"].copy()
    cmp_df = cmp_df.replace({np.nan: None})
    test_dates = result["test_dates"]
    if isinstance(test_dates, pd.Series):
        date_list = pd.to_datetime(test_dates).dt.strftime("%Y-%m-%d").tolist()
    else:
        date_list = [str(d) for d in test_dates]

    preds = {k: np.asarray(v, dtype=float).tolist() for k, v in result["predictions"].items()}

    train_size = result["train_size"]
    series_clean = np.asarray(result["series_clean"], dtype=float)

    return {
        "sku": result["sku"],
        "best_model": result["best_model"],
        "best_metrics": _sanitize(result["best_metrics"]),
        "comparison": cmp_df.to_dict("records"),
        "predictions": preds,
        "actual_test": np.asarray(result["actual_test"], dtype=float).tolist(),
        "test_dates": date_list,
        "train_size": int(train_size),
        "adu": result["adu"],
        "series_clean": series_clean.tolist(),
        "n_points": len(series_clean),
    }


class ForecastBody(BaseModel):
    sku: str = Field(..., description="SKU dari master")

    @field_validator("sku", mode="before")
    @classmethod
    def _sku_key(cls, v):
        return str(v).strip()


class OptimizeBody(BaseModel):
    sku: str = Field(..., description="SKU dari master")
    sl_target: float = Field(0.95, ge=0.5, le=0.999)
    pop_size: int = Field(24, ge=6, le=80)
    n_gen: int = Field(40, ge=5, le=120)
    include_baseline: bool = True

    @field_validator("sku", mode="before")
    @classmethod
    def _sku_key_opt(cls, v):
        return str(v).strip()


@router.get("/dataset-status")
def dataset_status(db: Session = Depends(get_db)):
    n_master = db.query(SKUMaster).count()
    n_daily = db.query(func.count(DailyRecord.id)).scalar() or 0
    frames = load_sales_master_frames_from_db(db)
    n_with_sales = 0
    if not frames["sales"].empty and "ID Item" in frames["sales"].columns:
        n_with_sales = int(frames["sales"]["ID Item"].nunique())
    ready = n_with_sales > 0 and n_master > 0
    return {
        "source": "database",
        "master_rows": int(n_master or 0),
        "daily_rows": int(n_daily or 0),
        "skus_with_demand": n_with_sales,
        "ready_for_forecast": ready,
        "message": (
            "Unggah master SKU + demand harian dari menu Master Data."
            if not ready
            else "Data siap untuk forecast."
        ),
    }


@router.get("/skus")
def list_skus(db: Session = Depends(get_db)):
    data = _get_data(db)
    if data["sales"].empty:
        return {"skus": []}
    g = get_sku_list(data, show=False)
    records = g.to_dict("records")
    for r in records:
        if "ID Item" in r and r["ID Item"] is not None:
            r["ID Item"] = str(r["ID Item"]).strip()
    return {"skus": records}


@router.post("/forecast")
def post_forecast(body: ForecastBody, db: Session = Depends(get_db)):
    data = _get_data(db)
    try:
        result = run_forecast_for_api(data, body.sku)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e
    return _forecast_to_response(result)


@router.post("/optimize")
def post_optimize(body: OptimizeBody, db: Session = Depends(get_db)):
    data = _get_data(db)
    try:
        out = run_buffer_optimization(
            data,
            body.sku,
            sl_target=body.sl_target,
            pop_size=body.pop_size,
            n_gen=body.n_gen,
            include_baseline=body.include_baseline,
        )
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e
    return _sanitize(out)
