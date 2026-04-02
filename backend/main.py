from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import pandas as pd
from backend.database import engine, get_db
from backend.models import Base
from sqlalchemy.orm import Session
from fastapi import Depends
from backend.services.ddmrp_logic import optimize_buffer
from backend.api.analytics import router as analytics_router
from backend.api.master import router as master_router

# Automatically create tables (in production use Alembic)
Base.metadata.create_all(bind=engine)

app = FastAPI(title="DDMRP API")
app.include_router(analytics_router)
app.include_router(master_router)

# Configure CORS for local development with Next.js
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3001"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/")
def read_root():
    return {"message": "Welcome to DDMRP API"}

@app.get("/api/dashboard-summary")
def get_dashboard_summary():
    # Mock summary based on Blueprint
    return {
        "total_sku": 250,
        "zona_merah": 18,
        "perlu_replenishment": 22,
        "open_order": 15,
        "buffer_active": "v2026.03",
        "fill_rate": 96.1,
        "csl": 94.8,
        "total_cost": 74500000
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
