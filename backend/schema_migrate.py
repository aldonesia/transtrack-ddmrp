"""
Lightweight additive schema updates for dev / small deployments.
Production should prefer Alembic; adds missing columns on `sku_master`.
"""
from __future__ import annotations

from sqlalchemy import inspect, text
from sqlalchemy.engine import Engine


def migrate_sku_master_columns(engine: Engine) -> None:
    insp = inspect(engine)
    if not insp.has_table("sku_master"):
        return
    existing = {c["name"] for c in insp.get_columns("sku_master")}
    dialect = engine.dialect.name
    if dialect == "sqlite":
        str_t, float_t, int_t = "TEXT", "REAL", "INTEGER"
    else:
        str_t, float_t, int_t = "VARCHAR(128)", "DOUBLE PRECISION", "INTEGER"
    adds: list[tuple[str, str]] = [
        ("group", str_t),
        ("criticality", str_t),
        ("abc_class", str_t),
        ("xyz_class", str_t),
        ("vendor_type", str_t),
        ("currency", str_t),
        ("holding_cost_day_idr", float_t),
        ("penalty_per_unit_idr", float_t),
        ("purchase_price", float_t),
        ("holding_cost_rate_day", float_t),
        ("lost_sale_rate_each", float_t),
        ("logistic_cost_order", float_t),
        ("pack_size", int_t),
    ]
    for col, sql_type in adds:
        if col in existing:
            continue
        with engine.begin() as conn:
            conn.execute(text(f"ALTER TABLE sku_master ADD COLUMN {col} {sql_type}"))


def migrate_open_order_tables(engine: Engine) -> None:
    """Ensure PO / operational state tables exist (create_all in main.py is primary)."""
    from models import Base

    Base.metadata.create_all(bind=engine, tables=[
        t for name, t in Base.metadata.tables.items()
        if name in ("purchase_order", "sku_operational_state")
    ])
