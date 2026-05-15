#!/usr/bin/env python3
"""
Hapus semua baris data operasional di database (SKU master, demand, buffer, forecast, nightly).

Gunakan sebelum uji impor Excel dari aplikasi. Mendukung PostgreSQL (Docker) dan SQLite (lokal).

Contoh (Docker, dari host di folder proyek):
  ./docker-reset-db.sh
atau:
  docker compose exec backend python scripts/reset_database.py --yes
"""
from __future__ import annotations

import argparse
import os
import sys

# Allow running as `python scripts/reset_database.py` from /app
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import text
from sqlalchemy.schema import sort_tables

from database import engine
from models import Base  # noqa: F401 — metadata
from models import (  # noqa: F401 — register tables on Base.metadata
    DDMRPBuffer,
    DDMRPBufferDetail,
    DailyRecord,
    ForecastRun,
    NightlyJobRun,
    PurchaseOrder,
    SKUMaster,
    SkuOperationalState,
)


def _table_names_in_delete_order() -> list[str]:
    """Anak dulu, lalu induk (aman untuk DELETE tanpa CASCADE)."""
    tables = list(sort_tables(Base.metadata.tables.values()))
    return [t.name for t in reversed(tables)]


def reset_postgres() -> None:
    names = ", ".join(_table_names_in_delete_order())
    sql = f"TRUNCATE TABLE {names} RESTART IDENTITY CASCADE"
    with engine.begin() as conn:
        conn.execute(text(sql))


def reset_sqlite() -> None:
    with engine.begin() as conn:
        for name in _table_names_in_delete_order():
            conn.execute(text(f"DELETE FROM {name}"))
        try:
            conn.execute(text("DELETE FROM sqlite_sequence"))
        except Exception:
            pass


def main() -> int:
    parser = argparse.ArgumentParser(description="Kosongkan database DDMRP (semua tabel operasional).")
    parser.add_argument(
        "-y",
        "--yes",
        action="store_true",
        help="Jalankan tanpa konfirmasi (wajib untuk CI / script).",
    )
    args = parser.parse_args()

    url = os.getenv("DATABASE_URL", "sqlite:///./sql_app.db")
    if not args.yes:
        print("Database URL:", url.split("@")[-1] if "@" in url else url)
        print("Tabel yang akan dikosongkan:", ", ".join(_table_names_in_delete_order()))
        try:
            confirm = input("Ketik YES untuk melanjutkan: ").strip()
        except EOFError:
            print("Gunakan --yes untuk mode non-interaktif.", file=sys.stderr)
            return 2
        if confirm != "YES":
            print("Dibatalkan.")
            return 1

    dialect = engine.dialect.name
    print(f"Dialect: {dialect}")
    if dialect == "postgresql":
        reset_postgres()
    elif dialect == "sqlite":
        reset_sqlite()
    else:
        print(f"Dialect {dialect!r} tidak didukung; gunakan DELETE per tabel.", file=sys.stderr)
        with engine.begin() as conn:
            for name in _table_names_in_delete_order():
                conn.execute(text(f"DELETE FROM {name}"))
    print("Selesai: semua baris pada tabel metadata telah dihapus.")
    print("Langkah berikut: unggah Master SKU lalu Demand dari aplikasi (Excel).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
