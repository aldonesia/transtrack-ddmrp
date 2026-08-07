# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Product

**IDAS** (*Inventory Decision Analytic System*) — a DDMRP (Demand Driven MRP) inventory planning app. UI and docs are largely in Indonesian. Backend: FastAPI + SQLAlchemy. Frontend: Next.js (App Router) + React 19 + Tailwind v4.

## Commands

### Backend tests

```bash
cd backend && python3 -m unittest discover -s tests -p 'test_*.py' -v
```

Run a single test module/case:

```bash
cd backend && python3 -m unittest tests.test_buffer_v2_parity -v
cd backend && python3 -m unittest tests.test_buffer_v2_parity.SomeTestClass.test_method -v
```

Notable suites: `test_buffer_v2_parity` (compares v2 buffer output against the reference notebook, ~2 min), `test_integration_v1_regression` (v1 endpoints still work after v2 changes), `test_master_helpers` / `test_master_sku_columns` (Excel upload parsing, no FastAPI dependency — safe to test in isolation).

Requires `pandas` etc. from `backend/requirements.txt` (`pip install -r backend/requirements.txt`).

### Frontend

```bash
cd frontend && npm run dev     # dev server on port 3001
cd frontend && npm run build
cd frontend && npm run lint
```

### Full stack (Docker)

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build
```

Dev overlay makes the browser call the API at `http://localhost:8000` directly (must open UI at `http://localhost:3001` for CORS to match). Without the dev overlay, `docker-compose.yml` alone builds the frontend against the production API URL — only use that for prod/staging.

- UI: http://localhost:3001
- API + Swagger docs: http://localhost:8000/docs

### Database reset / seed

```bash
./docker-reset-db.sh                 # truncate all operational tables (keeps schema)
./docker-seed-master.sh              # seed master SKU from resources_ext/Data 2 June.csv (must run inside the container, not on host — otherwise it writes to local SQLite instead of Postgres)
docker compose exec backend python scripts/import_data2_xlsx.py [--fresh] [--xlsx PATH]
```

Without `DATABASE_URL` set, the backend falls back to a local SQLite file `backend/sql_app.db`.

See `docs/INSTALLATION.md` for the full setup/reset/troubleshooting walkthrough (Indonesian).

## Architecture

### Two parallel buffer pipelines (v1 and v2)

The codebase runs **two DDMRP calculation pipelines side by side**, both writing to the same `ddmrp_buffer` / `ddmrp_buffer_detail` tables, distinguished by which endpoints produced them:

- **v1** — forecast-driven. `backend/services/hybrid_forecast.py` → `hybrid_optimizer.py` → `hybrid_pipeline.py`, mirrors `resources_ext/DDMRP_Hybrid_Algorithm_Last_Version.ipynb` (RUN 2→3→4 in the notebook). Entry points: `POST /api/analytics/run`, `POST /api/analytics/integration/run`.
- **v2** — actual-demand simulation, forecast optional, classification-driven buffer sizing. Lives entirely under `backend/services/buffer_v2/` (`pipeline.py` orchestrates `classification.py` → `ga_optimizer.py` → `simulate_ddmrp.py` / `simulate_conditional.py` → `response.py`). Entry points: `POST /api/analytics/integration/v2/run`, `GET /api/analytics/integration/v2/result`, `GET /api/analytics/integration/v2/replenishment`. Requires `SKUMaster.initial_inventory` to be set (seeded via `docker-seed-master.sh`), or the run raises a 400.
- Whichever pipeline ran most recently for a SKU determines its "active" buffer; downstream replenishment/PO logic doesn't care which pipeline produced it. `GET /api/analytics/parity-snapshot` exists specifically to numerically compare app output against the notebook for UAT (see "Parity Check" section in the root `README.md`).
- When changing shared math (cost, buffer sizing, zone logic), check whether both `services/hybrid_*` and `services/buffer_v2/*` need the same fix — they're independent implementations, not shared code.

### Operational loop (post-buffer)

Once a buffer is active, day-to-day ordering does **not** re-run forecasting/GA. Instead:

```
NFE = On Hand (OH) + Open Order (OP) − Qualified Demand (QD)
```

- `backend/services/open_order_service.py` + `api/purchase_order.py` — draft → confirm → receive → cancel lifecycle for `PurchaseOrder`. Confirming a PO changes OP and triggers an NFE recalc without touching TOR/TOY/TOG.
- `backend/services/operational_nfe.py` — recalculates NFE/zone from current OH/OP/QD (`POST /api/analytics/recalc-operational`), used by the "Recalc & refresh" button on the Replenishment page.
- `SkuOperationalState` tracks per-SKU on-hand quantity outside of the buffer tables.
- TOR/TOY/TOG only change when the pipeline is re-run (manually, or by the nightly scheduler).

### Nightly scheduler

`backend/main.py` starts a daemon thread on FastAPI startup (`_nightly_scheduler_loop`) that runs the v1 `post_run` pipeline for every active SKU at a configured time (`NIGHTLY_REFRESH_HOUR`/`MINUTE`, default 01:00). Controlled by `NIGHTLY_REFRESH_ENABLED`; state/history exposed via `GET /api/analytics/nightly-status` and `NightlyJobRun` rows, forced manually via `POST /api/analytics/nightly-run-now`.

### Units

Planning unit is **PCS/EA** everywhere (demand, forecast, DDMRP, GA, dashboard). Legacy `pack_size`/carton conversion fields exist in the DB for backward compatibility but are fixed at `1` and unused by API/UI — don't reintroduce carton math without checking `README.md`'s "Unit Standar Perhitungan" section first.

### Master data upload

`backend/services/master_upload_parse.py` (framework-independent, directly unit-testable) parses Excel uploads for both Master SKU and Demand, tolerating the header quirks of the reference workbook `resources_ext/Data 2.xlsx` (e.g. trailing-space `"Demand "` header, `ID Item` vs `SKU`, Excel serial-date cells). Upload is upsert-by-SKU (`api/master.py`). New/optional master columns are auto-added to the `sku_master` table on backend startup via lightweight migration in `schema_migrate.py` (SQLite/Postgres) — for real Postgres production use, prefer a proper Alembic migration instead of relying on this.

### Frontend API base URL

`frontend/src/lib/api.ts` resolves the API origin at runtime/build time (in priority order): `NEXT_PUBLIC_API_URL` build arg → inferred from `window.location.hostname` (localhost → `http://localhost:8000`, prod hostname → prod API) → hardcoded production fallback. `NEXT_PUBLIC_*` vars are inlined at build time, so changing them requires rebuilding the frontend image (`docker compose build --no-cache frontend`), not just restarting the container.

### Docs

`docs/` holds versioned user/integration manuals (`*_V2.md` = buffer v2 / 21-column master, unsuffixed = v1). `docs/gap_analysis.md` tracks product backlog gaps. The root `README.md` is the primary technical reference (API examples, dashboard field semantics, PO business rules) and is kept up to date — check it before `docs/` for anything endpoint-related.
