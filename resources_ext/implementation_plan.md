# Phase 4 API Migration: Jupyter Algorithms to FastAPI

The goal of this phase is to migrate the comprehensive Data Science pipeline from `DDMRP_Hybrid_Algorithm.ipynb` into our `backend` container so the React app can trigger Forecasting and Buffer Optimization algorithms natively.

## Proposed Changes

Currently, the backend has placeholders for the algorithms. We will replace these with the actual logic from the notebook.

### 1. Database Abstraction Layer
Instead of loading from Excel (`pd.read_excel(FILE_PATH)`), the ML algorithms must read from our PostgreSQL database schemas.
#### [MODIFY] `backend/services/ddmrp_logic.py`
- Create wrapper functions that query `DailyRecord` and `SKUMaster` into Pandas DataFrames, matching the structure what `load_all_data()` outputted.

### 2. Time Series Forecasting Module
Port the statistical and machine-learning models into a dedicated module that returns forecasted arrays.
#### [NEW] `backend/services/forecasting.py`
- Port `clean_demand_adaptive`, `make_features`, `split_xy`.
- Port the models: `forecast_ma`, `forecast_ses`, `forecast_holt`, `forecast_holtwinters`, `forecast_croston`.
- Port the ML models (`run_elasticnet`, `run_hgb`, `run_rf`, `run_mlp`, `run_dow_en`, `run_ensemble_ga`).
- Build `run_forecast(sku)` that queries historical demand, executes the ensemble, and saves forecasts to the database.

### 3. Buffer Optimization (Genetic Algorithm)
Port the buffer simulation and GA optimization.
#### [NEW] `backend/services/optimization.py`
- Port `classify_sku()` defining VF and LTF bounds.
- Port `simulate_ddmrp()` and `GeneticOptimizer` class.
- Expose a `run_buffer_optimization(sku, ...)` method which searches for optimal FV and LTF parameters.

### 4. API Endpoints
Create the execution triggers via REST routes.
#### [MODIFY] `backend/main.py`
- Add `POST /api/forecast/{sku}` to run machine learning pipelines.
- Modify `POST /api/optimize-buffer` to run the active Genetic Algorithm parameters and update `DDMRPBuffer` tables.

## User Review Required

> [!WARNING]  
> The `DDMRP_Hybrid_Algorithm.ipynb` utilizes a hefty ensemble of CPU-intensive Machine Learning computations per SKU (Gradient Boost, Elastic Nets, RandomForest, and a Genetic Algorithm running 80 generations).
> 
> **Question 1:** Should the API process this synchronously (which might take 10-30 seconds per SKU and block the UI), or should I queue this in a background task (using FastAPI `BackgroundTasks`) and return a "Processing" status to the frontend? 
> 
> **Question 2:** The notebook uses `Promo Discount` fields which aren't currently stored in the base `DailyRecord` schema explicitly requested earlier. Should I keep the ML models that require `PromoDiscountPct` and add them to the database, or strip out the promo features for the API?

## Verification Plan
1. **Endpoint Testing:** Manually trigger `/api/forecast/{sku}` using test queries and ensure it does not crash FastAPI.
2. **Algorithm Consistency:** Ensure the resulting `FV_opt` and `LTF_opt` from the endpoint loosely match the Excel expectations for similar inputs.
