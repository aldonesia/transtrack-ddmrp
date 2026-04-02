import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import pandas as pd
from database import engine, get_db
from models import Base, DDMRPBuffer, DDMRPBufferDetail
from sqlalchemy.orm import Session
from fastapi import Depends
from services.ddmrp_logic import optimize_buffer
from api.analytics import router as analytics_router
from api.master import router as master_router
from datetime import timedelta
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

@app.get("/")
def read_root():
    return {"message": "Welcome to DDMRP API"}

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
