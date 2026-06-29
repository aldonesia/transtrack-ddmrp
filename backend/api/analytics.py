"""
Forecast + buffer optimization API (DDMRP_Hybrid_Algorithm_Last_Version.ipynb).
Reads sales + master from database (upload via Master Data). Quantities are in PCS (single unit).
"""
from __future__ import annotations

from typing import Any, Dict, Optional
from datetime import datetime, timedelta
import json

import numpy as np
import pandas as pd
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import func
from sqlalchemy.orm import Session

from database import get_db
from models import DailyRecord, SKUMaster, DDMRPBuffer, DDMRPBufferDetail, ForecastRun
from services.data_loader import get_sku_list, get_sku_params
from services.db_dataset import load_sales_master_frames_from_db
from services.hybrid_pipeline import (
    run_buffer_optimization,
    run_forecast_for_api,
)
from services.buffer_v2.pipeline import run_buffer_optimization_v2
from services.buffer_v2.response import build_v2_notebook_json, daily_simulation_csv_response

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


def _forecast_to_response(
    result: Dict[str, Any],
    unit: str = "EA",
    *,
    include_predictions: bool = True,
) -> Dict[str, Any]:
    cmp_df = result["comparison"].copy()
    cmp_df = cmp_df.replace({np.nan: None})
    test_dates = result["test_dates"]
    if isinstance(test_dates, pd.Series):
        date_list = pd.to_datetime(test_dates).dt.strftime("%Y-%m-%d").tolist()
    else:
        date_list = [str(d) for d in test_dates]

    train_size = result["train_size"]
    series_clean = np.asarray(result["series_clean"], dtype=float)

    payload: Dict[str, Any] = {
        "sku": result["sku"],
        "unit": unit,
        "best_model": result["best_model"],
        "best_metrics": _sanitize(result["best_metrics"]),
        "comparison": cmp_df.to_dict("records"),
        "actual_test": np.asarray(result["actual_test"], dtype=float).tolist(),
        "test_dates": date_list,
        "train_size": int(train_size),
        "adu": result["adu"],
        "series_clean": series_clean.tolist(),
        "n_points": len(series_clean),
    }
    if include_predictions:
        preds = {k: np.asarray(v, dtype=float).tolist() for k, v in result["predictions"].items()}
        payload["predictions"] = preds
    return payload


class ForecastBody(BaseModel):
    sku: str = Field(..., description="SKU dari master")

    @field_validator("sku", mode="before")
    @classmethod
    def _sku_key(cls, v):
        return str(v).strip()


class OptimizeBody(BaseModel):
    sku: str = Field(..., description="SKU dari master")
    sl_target: float = Field(0.95, ge=0.5, le=0.999)
    pop_size: int = Field(30, ge=6, le=80)
    n_gen: int = Field(80, ge=5, le=120)
    include_baseline: bool = True

    @field_validator("sku", mode="before")
    @classmethod
    def _sku_key_opt(cls, v):
        return str(v).strip()


class RunBody(OptimizeBody):
    """
    Run forecast selection, then automatically run DDMRP + GA and persist the plan.
    """

    pass


class IntegrationRunBody(BaseModel):
    sku_no: str = Field(..., description="SKU number untuk integrasi sistem eksternal")
    sl_target: float = Field(0.95, ge=0.5, le=0.999)
    pop_size: int = Field(30, ge=6, le=80)
    n_gen: int = Field(80, ge=5, le=120)
    include_baseline: bool = True

    @field_validator("sku_no", mode="before")
    @classmethod
    def _sku_key_run(cls, v):
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
    # Listing: all quantities are in PCS (no carton conversion).
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
        unit = str(get_sku_params(data, body.sku).get("unit") or "EA").upper()
        result = run_forecast_for_api(data, body.sku)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e
    return _forecast_to_response(result, unit=unit)


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


def _ensure_active_buffer_archived(db: Session, sku: str):
    db.query(DDMRPBuffer).filter(
        DDMRPBuffer.sku == sku,
        DDMRPBuffer.status == "Active",
    ).update({DDMRPBuffer.status: "Archived"})


def _save_buffer_plan_and_details(
    db: Session,
    sku: str,
    *,
    classification: Dict[str, Any],
    fv_opt: float,
    ltf_opt: float,
    optimized_kpi: Dict[str, Any],
    optimized_detail_records: list[dict[str, Any]],
    version_prefix: str = "v",
    seed_on_hand: Optional[float] = None,
) -> int:
    """
    Persist DDMRP (DDMRP + GA) result for replenishment lookup.
    We persist only the replenishment window: start_date .. start_date + dlt - 1.
    """
    dlt = int(classification.get("dlt") or 0)
    if not optimized_detail_records:
        raise ValueError("No optimized detail rows to persist.")
    if dlt <= 0:
        raise ValueError("Invalid dlt in classification.")

    # detail_records['date'] comes from simulate_ddmrp as Python datetime.date.
    dates = [r.get("date") for r in optimized_detail_records if r.get("date") is not None]
    if not dates:
        raise ValueError("No dates found in optimized detail rows.")

    start_date = min(dates)
    end_date = start_date + timedelta(days=dlt - 1)

    # Archive older active plans for this SKU.
    _ensure_active_buffer_archived(db, sku)

    version = f"{version_prefix}{datetime.utcnow().strftime('%Y.%m.%d.%H%M%S')}"
    # If GA returned optimized vf/ltf in classification-less place, prefer it later.
    tor = float(optimized_kpi.get("tor") or classification.get("tor") or 0)
    toy = float(optimized_kpi.get("toy") or classification.get("toy") or 0)
    tog = float(optimized_kpi.get("tog") or classification.get("tog") or 0)

    buf = DDMRPBuffer(
        sku=sku,
        version=version,
        start_date=start_date,
        end_date=end_date,
        status="Active",
        dlt=dlt,
        adu=float(classification.get("adu") or 0),
        vf_opt=fv_opt,
        ltf_opt=ltf_opt,
        tor=tor,
        toy=toy,
        tog=tog,
        score=str(optimized_kpi.get("total_cost") or ""),
    )
    db.add(buf)
    db.flush()  # get buf.id

    for r in optimized_detail_records:
        rd = r.get("date")
        if rd is None:
            continue
        if rd < start_date or rd > end_date:
            continue
        db.add(
            DDMRPBufferDetail(
                buffer_id=buf.id,
                date=rd,
                order_qty=float(r.get("order_qty") or 0),
                nfe=float(r.get("nfe") or r.get("NFE") or 0),
                zone=r.get("zone"),
            )
        )

    db.commit()

    from services.operational_nfe import seed_operational_state_for_buffer

    seed_operational_state_for_buffer(db, sku, buf, on_hand=seed_on_hand)

    return int(buf.id)


def _save_latest_run(
    db: Session,
    sku: str,
    forecast_payload: Dict[str, Any],
    optimize_payload: Dict[str, Any],
) -> int:
    db.query(ForecastRun).filter(ForecastRun.sku == sku).delete()
    row = ForecastRun(
        sku=sku,
        run_at=datetime.utcnow(),
        unit="PCS",
        qty_per_carton=1,
        forecast_json=json.dumps(_sanitize(forecast_payload)),
        optimize_json=json.dumps(_sanitize(optimize_payload)),
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return int(row.id)


@router.post("/run")
def post_run(body: RunBody, db: Session = Depends(get_db)):
    data = _get_data(db)
    sku_s = str(body.sku).strip()

    try:
        forecast_result = run_forecast_for_api(data, sku_s)
        out = run_buffer_optimization(
            data,
            sku_s,
            sl_target=body.sl_target,
            pop_size=body.pop_size,
            n_gen=body.n_gen,
            include_baseline=body.include_baseline,
            forecast_result=forecast_result,
            return_detail=True,
        )
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e

    optimized_detail_records = out.pop("optimized_detail", None) or []
    classification = out.get("classification") or {}
    optimized_kpi = (out.get("optimized") or {}).get("kpi") or {}

    # Save to DB for replenishment lookup.
    buffer_id = _save_buffer_plan_and_details(
        db,
        sku_s,
        classification=classification,
        fv_opt=float((out.get("optimized") or {}).get("fv_opt") or 0),
        ltf_opt=float((out.get("optimized") or {}).get("ltf_opt") or 0),
        optimized_kpi=optimized_kpi,
        optimized_detail_records=optimized_detail_records,
    )

    # Don't return large detail payload; keep response small.
    response_opt = _sanitize(out)
    unit = str(get_sku_params(data, sku_s).get("unit") or out.get("unit") or "EA").upper()
    forecast_response = _forecast_to_response(forecast_result, unit=unit)
    latest_run_id = _save_latest_run(db, sku_s, forecast_response, response_opt)
    return {
        "buffer_id": buffer_id,
        "latest_run_id": latest_run_id,
        "forecast": forecast_response,
        "optimize": response_opt,
    }


@router.post("/integration/run")
def integration_run(body: IntegrationRunBody, db: Session = Depends(get_db)):
    """
    Endpoint integrasi: jalankan forecast + optimize berdasarkan sku_no.
    """
    run_body = RunBody(
        sku=body.sku_no,
        sl_target=body.sl_target,
        pop_size=body.pop_size,
        n_gen=body.n_gen,
        include_baseline=body.include_baseline,
    )
    result = post_run(run_body, db)
    return {
        "sku_no": body.sku_no,
        "status": "ok",
        **result,
    }


def _post_run_v2(body: IntegrationRunBody, db: Session) -> Dict[str, Any]:
    data = _get_data(db)
    sku_s = str(body.sku_no).strip()
    params = get_sku_params(data, sku_s)
    if params.get("initial_inventory") is None:
        raise HTTPException(
            status_code=400,
            detail=f"SKU {sku_s}: initial_inventory wajib diisi di master (Data 2 June).",
        )

    try:
        forecast_result = run_forecast_for_api(data, sku_s)
        out = run_buffer_optimization_v2(
            data,
            sku_s,
            sl_target=body.sl_target,
            pop_size=body.pop_size,
            n_gen=body.n_gen,
            include_baseline=body.include_baseline,
            forecast_result=forecast_result,
            return_detail=True,
        )
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e

    optimized_detail_records = out.pop("optimized_detail", None) or []
    classification = out.get("classification") or {}
    optimized_kpi = (out.get("optimized") or {}).get("kpi") or {}
    optimization = out.get("optimization") or {}

    buffer_id = _save_buffer_plan_and_details(
        db,
        sku_s,
        classification=classification,
        fv_opt=float(optimization.get("vf_opt") or 0),
        ltf_opt=float(optimization.get("ltf_opt") or 0),
        optimized_kpi=optimized_kpi,
        optimized_detail_records=optimized_detail_records,
        version_prefix="v2-",
        seed_on_hand=float(params["initial_inventory"]),
    )

    response_opt = _sanitize(out)
    unit = str(params.get("unit") or out.get("unit") or "EA").upper()
    forecast_response = _forecast_to_response(forecast_result, unit=unit, include_predictions=False)
    latest_run_id = _save_latest_run(db, sku_s, forecast_response, response_opt)
    daily_simulation = response_opt.get("daily_simulation") or []
    daily_simulation_csv = response_opt.get("daily_simulation_csv") or ""
    return {
        "buffer_id": buffer_id,
        "latest_run_id": latest_run_id,
        "forecast": forecast_response,
        "optimize": response_opt,
        "daily_simulation": daily_simulation,
        "daily_simulation_csv": daily_simulation_csv,
    }


@router.post("/integration/v2/run")
def integration_v2_run(
    body: IntegrationRunBody,
    csv: bool = Query(
        False,
        description="If true (`?csv` or `?csv=true`), return daily simulation as CSV file instead of JSON.",
    ),
    db: Session = Depends(get_db),
):
    """Integrasi buffer v2 — klasifikasi, method-aware GA, actual demand QD."""
    result = _post_run_v2(body, db)
    sku_s = str(body.sku_no).strip()
    if csv:
        csv_text = result.get("daily_simulation_csv") or ""
        if not csv_text:
            raise HTTPException(status_code=404, detail=f"No daily simulation CSV for SKU {sku_s}.")
        return daily_simulation_csv_response(sku_s, csv_text)
    return _sanitize(
        build_v2_notebook_json(
            sku_s,
            result.get("optimize") or {},
            buffer_id=result.get("buffer_id"),
            latest_run_id=result.get("latest_run_id"),
        )
    )


@router.get("/integration/v2/result")
def integration_v2_result(
    sku_no: Optional[str] = None,
    csv: bool = Query(
        False,
        description="If true (`?csv` or `?csv=true`), return daily simulation as CSV file instead of JSON.",
    ),
    db: Session = Depends(get_db),
):
    if not sku_no or not str(sku_no).strip():
        raise HTTPException(status_code=400, detail="Missing `sku_no` query param.")
    sku_s = str(sku_no).strip()
    row = (
        db.query(ForecastRun)
        .filter(ForecastRun.sku == sku_s)
        .order_by(ForecastRun.run_at.desc(), ForecastRun.id.desc())
        .first()
    )
    if not row:
        if csv:
            raise HTTPException(
                status_code=404,
                detail=f"No v2 integration run found for SKU {sku_s}. Call POST /integration/v2/run first.",
            )
        return {"sku_no": sku_s, "status": "ok", "api_version": "v2", "latest_run": None}
    optimize_payload = json.loads(row.optimize_json or "{}")
    if optimize_payload.get("api_version") != "v2":
        raise HTTPException(
            status_code=404,
            detail=f"No v2 integration run found for SKU {sku_s}. Call POST /integration/v2/run first.",
        )
    if csv:
        csv_text = optimize_payload.get("daily_simulation_csv") or ""
        if not csv_text:
            raise HTTPException(status_code=404, detail=f"No daily simulation CSV for SKU {sku_s}.")
        return daily_simulation_csv_response(sku_s, csv_text)
    payload = build_v2_notebook_json(sku_s, optimize_payload)
    payload["latest_run"] = {
        "id": int(row.id),
        "run_at": row.run_at.isoformat() if row.run_at else None,
        "unit": row.unit or "PCS",
    }
    return _sanitize(payload)


@router.get("/integration/v2/replenishment")
def integration_v2_replenishment(
    sku_no: Optional[str] = None,
    db: Session = Depends(get_db),
):
    if not sku_no or not str(sku_no).strip():
        raise HTTPException(status_code=400, detail="Missing `sku_no` query param.")
    result = get_replenishment(sku=sku_no, db=db)
    version = str(result.get("version") or "")
    if not version.startswith("v2-"):
        raise HTTPException(
            status_code=404,
            detail=f"No active v2 buffer for SKU {sku_no}. Run POST /integration/v2/run first.",
        )
    return {
        "sku_no": str(sku_no).strip(),
        "status": "ok",
        "api_version": "v2",
        **result,
    }


@router.get("/latest-run")
def get_latest_run(
    sku: Optional[str] = None,
    db: Session = Depends(get_db),
):
    if not sku:
        raise HTTPException(status_code=400, detail="Missing `sku` query param.")
    sku_s = str(sku).strip()
    row = (
        db.query(ForecastRun)
        .filter(ForecastRun.sku == sku_s)
        .order_by(ForecastRun.run_at.desc(), ForecastRun.id.desc())
        .first()
    )
    if not row:
        return {"sku": sku_s, "latest_run": None}
    forecast_payload = json.loads(row.forecast_json or "{}")
    optimize_payload = json.loads(row.optimize_json or "{}")
    return {
        "sku": sku_s,
        "latest_run": {
            "id": int(row.id),
            "run_at": row.run_at.isoformat() if row.run_at else None,
            "unit": row.unit or "PCS",
            "forecast": forecast_payload,
            "optimize": optimize_payload,
        },
    }


@router.get("/integration/result")
def integration_result(
    sku_no: Optional[str] = None,
    db: Session = Depends(get_db),
):
    """
    Endpoint integrasi: ambil latest result forecast + optimize berdasarkan sku_no.
    """
    result = get_latest_run(sku=sku_no, db=db)
    return {
        "sku_no": str(sku_no).strip() if sku_no else None,
        "status": "ok",
        **result,
    }


@router.get("/parity-snapshot")
def parity_snapshot(
    sku: Optional[str] = None,
    db: Session = Depends(get_db),
):
    """
    Snapshot angka kunci untuk parity check manual vs notebook.
    """
    if not sku:
        raise HTTPException(status_code=400, detail="Missing `sku` query param.")
    sku_s = str(sku).strip()
    data = _get_data(db)
    try:
        forecast_result = run_forecast_for_api(data, sku_s)
        optimize_result = run_buffer_optimization(
            data,
            sku_s,
            include_baseline=True,
            return_detail=False,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e

    baseline = optimize_result.get("baseline") or {}
    opt = (optimize_result.get("optimized") or {}).get("kpi") or {}
    return {
        "sku": sku_s,
        "unit": "PCS",
        "forecast_best_model": forecast_result.get("best_model"),
        "forecast_mae": (forecast_result.get("best_metrics") or {}).get("MAE"),
        "adu_train": forecast_result.get("adu"),
        "baseline": {
            "fill_rate": baseline.get("fill_rate"),
            "total_cost": baseline.get("total_cost"),
            "tor": baseline.get("tor"),
            "toy": baseline.get("toy"),
            "tog": baseline.get("tog"),
        },
        "optimized": {
            "fv_opt": (optimize_result.get("optimized") or {}).get("fv_opt"),
            "ltf_opt": (optimize_result.get("optimized") or {}).get("ltf_opt"),
            "fill_rate": opt.get("fill_rate"),
            "total_cost": opt.get("total_cost"),
            "tor": opt.get("tor"),
            "toy": opt.get("toy"),
            "tog": opt.get("tog"),
        },
    }


@router.get("/replenishment")
def get_replenishment(
    sku: Optional[str] = None,
    db: Session = Depends(get_db),
):
    if not sku:
        raise HTTPException(status_code=400, detail="Missing `sku` query param.")
    sku_s = str(sku).strip()

    buf = (
        db.query(DDMRPBuffer)
        .filter(DDMRPBuffer.sku == sku_s, DDMRPBuffer.status == "Active")
        .order_by(DDMRPBuffer.id.desc())
        .first()
    )
    if not buf:
        raise HTTPException(
            status_code=404,
            detail=f"No active DDMRP plan found for SKU {sku_s}. Run forecast/optimization first.",
        )

    master = db.query(SKUMaster).filter(SKUMaster.sku == sku_s).first()
    unit = str(master.unit or "EA").strip().upper() if master else "EA"

    if not buf.start_date:
        raise HTTPException(status_code=404, detail="Active buffer missing start_date.")
    today = buf.start_date
    end = today + timedelta(days=int(buf.dlt or 0) - 1)
    rows = (
        db.query(DDMRPBufferDetail)
        .filter(
            DDMRPBufferDetail.buffer_id == buf.id,
            DDMRPBufferDetail.date >= today,
            DDMRPBufferDetail.date <= end,
        )
        .order_by(DDMRPBufferDetail.date.asc())
        .all()
    )

    from services.operational_nfe import get_operational_snapshot

    operational = get_operational_snapshot(db, sku_s, as_of=today)

    return {
        "sku": sku_s,
        "unit": unit,
        "buffer_id": int(buf.id),
        "version": buf.version,
        "today_date": today.isoformat(),
        "end_date": end.isoformat(),
        "leadtime_days": int(buf.dlt or 0),
        "adu": float(buf.adu or 0),
        "vf_opt": float(buf.vf_opt or 0),
        "ltf_opt": float(buf.ltf_opt or 0),
        "tor": float(buf.tor or 0),
        "toy": float(buf.toy or 0),
        "tog": float(buf.tog or 0),
        "operational": operational,
        "recommendations": [
            {
                "date": r.date.isoformat() if r.date else None,
                "order_qty": float(r.order_qty or 0),
                "nfe": float(r.nfe or 0),
                "zone": r.zone,
            }
            for r in rows
        ],
    }


@router.post("/recalc-operational")
def post_recalc_operational(
    sku: Optional[str] = None,
    db: Session = Depends(get_db),
):
    if not sku:
        raise HTTPException(status_code=400, detail="Missing `sku` query param.")
    from services.operational_nfe import recalc_operational_nfe

    try:
        summary = recalc_operational_nfe(db, str(sku).strip())
        db.commit()
        return {"status": "ok", "recalc": summary}
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e


@router.get("/buffer-active")
def get_buffer_active(
    sku: Optional[str] = None,
    db: Session = Depends(get_db),
):
    """
    Detail buffer aktif untuk SKU terpilih, termasuk ringkasan order window.
    """
    if not sku:
        raise HTTPException(status_code=400, detail="Missing `sku` query param.")
    sku_s = str(sku).strip()

    buf = (
        db.query(DDMRPBuffer)
        .filter(DDMRPBuffer.sku == sku_s, DDMRPBuffer.status == "Active")
        .order_by(DDMRPBuffer.id.desc())
        .first()
    )
    if not buf:
        raise HTTPException(
            status_code=404,
            detail=f"No active buffer found for SKU {sku_s}. Run forecast/optimization first.",
        )

    rows = (
        db.query(DDMRPBufferDetail)
        .filter(DDMRPBufferDetail.buffer_id == buf.id)
        .order_by(DDMRPBufferDetail.date.asc())
        .all()
    )
    recommendations = [
        {
            "date": r.date.isoformat() if r.date else None,
            "order_qty": float(r.order_qty or 0),
            "nfe": float(r.nfe or 0),
            "zone": r.zone,
        }
        for r in rows
    ]
    n_order_days = sum(1 for r in recommendations if float(r["order_qty"]) > 0)
    total_order_qty = float(sum(float(r["order_qty"]) for r in recommendations))
    min_nfe = float(min((float(r["nfe"]) for r in recommendations), default=0.0))
    max_nfe = float(max((float(r["nfe"]) for r in recommendations), default=0.0))

    master = db.query(SKUMaster).filter(SKUMaster.sku == sku_s).first()
    unit = str(master.unit or "EA").strip().upper() if master else "EA"

    return {
        "sku": sku_s,
        "unit": unit,
        "buffer_id": int(buf.id),
        "version": buf.version,
        "status": buf.status,
        "start_date": buf.start_date.isoformat() if buf.start_date else None,
        "end_date": buf.end_date.isoformat() if buf.end_date else None,
        "dlt": int(buf.dlt or 0),
        "adu": float(buf.adu or 0),
        "vf_opt": float(buf.vf_opt or 0),
        "ltf_opt": float(buf.ltf_opt or 0),
        "tor": float(buf.tor or 0),
        "toy": float(buf.toy or 0),
        "tog": float(buf.tog or 0),
        "summary": {
            "n_days": len(recommendations),
            "n_order_days": n_order_days,
            "total_order_qty": round(total_order_qty, 2),
            "min_nfe": round(min_nfe, 2),
            "max_nfe": round(max_nfe, 2),
        },
        "recommendations": recommendations,
    }


@router.get("/integration/replenishment")
def integration_replenishment(
    sku_no: Optional[str] = None,
    db: Session = Depends(get_db),
):
    """
    Endpoint integrasi: ambil replenishment berdasarkan sku_no.
    """
    result = get_replenishment(sku=sku_no, db=db)
    return {
        "sku_no": str(sku_no).strip() if sku_no else None,
        "status": "ok",
        **result,
    }
