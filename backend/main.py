import os
import time
import threading
from datetime import datetime, timedelta

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import pandas as pd
from database import engine, get_db, SessionLocal
from models import Base, DDMRPBuffer, DDMRPBufferDetail, SKUMaster
from sqlalchemy.orm import Session
from fastapi import Depends
from services.ddmrp_logic import optimize_buffer
from api.analytics import router as analytics_router
from api.analytics import post_run, RunBody
from api.master import router as master_router
import math

# Automatically create tables (in production use Alembic)
Base.metadata.create_all(bind=engine)

app = FastAPI(title="DDMRP API")
app.include_router(analytics_router)
app.include_router(master_router)

_cors = os.getenv(
    "CORS_ORIGINS",
    "http://localhost:3001,https://transtrack-ddmrp.skom.my.id",
)
_allow_origins = [o.strip() for o in _cors.split(",") if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_allow_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

NIGHTLY_REFRESH_HOUR = int(os.getenv("NIGHTLY_REFRESH_HOUR", "1"))
NIGHTLY_REFRESH_MINUTE = int(os.getenv("NIGHTLY_REFRESH_MINUTE", "0"))
NIGHTLY_REFRESH_ENABLED = os.getenv("NIGHTLY_REFRESH_ENABLED", "1") == "1"
NIGHTLY_RUN_PARAMS = {
    "sl_target": float(os.getenv("NIGHTLY_SL_TARGET", "0.95")),
    "pop_size": int(os.getenv("NIGHTLY_POP_SIZE", "24")),
    "n_gen": int(os.getenv("NIGHTLY_N_GEN", "40")),
    "include_baseline": True,
}

_nightly_state = {
    "enabled": NIGHTLY_REFRESH_ENABLED,
    "running": False,
    "last_run_at": None,
    "last_status": None,
    "last_message": None,
    "processed_skus": 0,
}


def _run_all_sku_refresh_job() -> dict:
    db = SessionLocal()
    processed = 0
    failed = 0
    failures: list[dict] = []
    started_at = datetime.now()
    try:
        sku_rows = (
            db.query(SKUMaster.sku)
            .filter(
                (SKUMaster.status == "Active")
                | (SKUMaster.status.is_(None))
                | (SKUMaster.status == "")
            )
            .order_by(SKUMaster.sku.asc())
            .all()
        )
        skus = [str(r[0]).strip() for r in sku_rows if r and r[0] is not None]
        for sku in skus:
            try:
                body = RunBody(sku=sku, **NIGHTLY_RUN_PARAMS)
                post_run(body, db)
                processed += 1
            except Exception as e:
                failed += 1
                failures.append({"sku": sku, "error": str(e)})
        status = "success" if failed == 0 else "partial_success"
        msg = f"Processed={processed}, Failed={failed}"
        return {
            "status": status,
            "message": msg,
            "processed": processed,
            "failed": failed,
            "failures": failures[:20],
            "started_at": started_at.isoformat(),
            "finished_at": datetime.now().isoformat(),
        }
    finally:
        db.close()


def _nightly_scheduler_loop():
    while True:
        now = datetime.now()
        next_run = now.replace(
            hour=NIGHTLY_REFRESH_HOUR,
            minute=NIGHTLY_REFRESH_MINUTE,
            second=0,
            microsecond=0,
        )
        if next_run <= now:
            next_run = next_run + timedelta(days=1)
        wait_seconds = max((next_run - now).total_seconds(), 1)
        time.sleep(wait_seconds)
        if not NIGHTLY_REFRESH_ENABLED:
            continue
        _nightly_state["running"] = True
        _nightly_state["last_run_at"] = datetime.now().isoformat()
        try:
            result = _run_all_sku_refresh_job()
            _nightly_state["last_status"] = result["status"]
            _nightly_state["last_message"] = result["message"]
            _nightly_state["processed_skus"] = result["processed"]
        except Exception as e:
            _nightly_state["last_status"] = "failed"
            _nightly_state["last_message"] = str(e)
            _nightly_state["processed_skus"] = 0
        finally:
            _nightly_state["running"] = False


@app.on_event("startup")
def startup_nightly_scheduler():
    if not NIGHTLY_REFRESH_ENABLED:
        return
    t = threading.Thread(target=_nightly_scheduler_loop, daemon=True)
    t.start()

@app.get("/")
def read_root():
    return {"message": "Welcome to DDMRP API"}


@app.get("/api/analytics/nightly-status")
def nightly_status():
    return {
        **_nightly_state,
        "hour": NIGHTLY_REFRESH_HOUR,
        "minute": NIGHTLY_REFRESH_MINUTE,
        "params": NIGHTLY_RUN_PARAMS,
    }


@app.post("/api/analytics/nightly-run-now")
def nightly_run_now():
    _nightly_state["running"] = True
    _nightly_state["last_run_at"] = datetime.now().isoformat()
    try:
        result = _run_all_sku_refresh_job()
        _nightly_state["last_status"] = result["status"]
        _nightly_state["last_message"] = result["message"]
        _nightly_state["processed_skus"] = result["processed"]
        return {"status": "ok", "result": result}
    except Exception as e:
        _nightly_state["last_status"] = "failed"
        _nightly_state["last_message"] = str(e)
        _nightly_state["processed_skus"] = 0
        return {"status": "failed", "message": str(e)}
    finally:
        _nightly_state["running"] = False

@app.get("/api/dashboard-summary")
def get_dashboard_summary(db: Session = Depends(get_db)):
    active_buffers = (
        db.query(DDMRPBuffer)
        .filter(DDMRPBuffer.status == "Active")
        .order_by(DDMRPBuffer.id.desc())
        .all()
    )

    total_sku = int(len(active_buffers))
    if total_sku == 0:
        return {
            "source": "database",
            "total_sku": 0,
            "zona_merah": 0,
            "perlu_replenishment": 0,
            "open_order": 0,
            "buffer_active": None,
            "fill_rate": None,
            "csl": None,
            "total_cost": None,
            "message": "Belum ada buffer aktif. Jalankan forecast + DDMRP + GA di tab Analytics.",
            "top_critical": [],
        }

    zona_merah = 0
    perlu_replenishment = 0
    open_order = 0

    top_critical: list[dict] = []

    for buf in active_buffers:
        if not buf.start_date or not buf.dlt:
            continue
        start = buf.start_date
        end = start + timedelta(days=int(buf.dlt) - 1)

        today_detail = (
            db.query(DDMRPBufferDetail)
            .filter(
                DDMRPBufferDetail.buffer_id == buf.id,
                DDMRPBufferDetail.date == start,
            )
            .first()
        )

        zone_today = getattr(today_detail, "zone", None) if today_detail else None
        order_today = float(getattr(today_detail, "order_qty", 0) or 0) if today_detail else 0.0
        nfe_today = float(getattr(today_detail, "nfe", 0) or 0) if today_detail else 0.0

        any_order = (
            db.query(DDMRPBufferDetail.id)
            .filter(
                DDMRPBufferDetail.buffer_id == buf.id,
                DDMRPBufferDetail.date >= start,
                DDMRPBufferDetail.date <= end,
                DDMRPBufferDetail.order_qty > 0,
            )
            .first()
            is not None
        )

        if zone_today == "RED":
            zona_merah += 1
        if order_today > 0:
            perlu_replenishment += 1
        if any_order:
            open_order += 1

        if zone_today == "RED" or order_today > 0:
            priority_status = "critical" if zone_today == "RED" else "warning"
            action = f"Order {math.ceil(order_today)}" if order_today > 0 else "—"
            top_critical.append(
                {
                    "sku": buf.sku,
                    "nfe": nfe_today,
                    "toy": float(buf.toy or 0),
                    "tog": float(buf.tog or 0),
                    "action": action,
                    "status": priority_status,
                }
            )

    top_critical.sort(
        key=lambda r: (0 if r.get("status") == "critical" else 1, float(r.get("nfe") or 0))
    )

    latest = active_buffers[0].version if active_buffers else None

    return {
        "source": "database",
        "total_sku": total_sku,
        "zona_merah": int(zona_merah),
        "perlu_replenishment": int(perlu_replenishment),
        "open_order": int(open_order),
        "buffer_active": latest,
        "fill_rate": None,
        "csl": None,
        "total_cost": None,
        "message": None,
        "top_critical": top_critical[:5],
    }

@app.get("/api/replenishment-recommendation")
def get_replenishment():
    # Attempting to load sample data if available
    try:
        df = pd.read_excel("resources_ext/DDMRP_SKU1000001_Results.xlsx")
        # Example processing: 
        # normally we apply DDMRP_Hybrid_Algorithm.ipynb logic here.
        # Returning mock data mapped from Blueprint for now.
        return {
            "data": [
                {"sku": "A001", "stock": 20, "open_order": 10, "nfe": 15, "toy": 80, "tog": 115, "oh": 100, "moq": 100, "final_qty": 100, "status": "Order"},
                {"sku": "A002", "stock": 55, "open_order": 0, "nfe": 45, "toy": 60, "tog": 90, "oh": 45, "moq": 50, "final_qty": 50, "status": "Order"},
                {"sku": "A003", "stock": 120, "open_order": 40, "nfe": 130, "toy": 88, "tog": 108, "oh": 0, "moq": 20, "final_qty": 0, "status": "Aman"},
                {"sku": "A008", "stock": 18, "open_order": 0, "nfe": 6, "toy": 55, "tog": 80, "oh": 74, "moq": 20, "final_qty": 80, "status": "Order"}
            ]
        }
    except Exception as e:
        return {"error": str(e)}

@app.post("/api/optimize-buffer")
def optimize_buffer_endpoint(sku: str, adu: float, dlt: int, db: Session = Depends(get_db)):
    # This invokes our skeleton DDMRP Logic algorithm
    # fv_space and ltf_space normally come from sku classification
    result = optimize_buffer(sku, adu, dlt, (0.0, 1.0), (0.0, 1.0))
    return {
        "status": "Optimization Complete",
        "data": result
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
