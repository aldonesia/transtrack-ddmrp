"""
Load preprocessed Excel (sales + sku_master) — same schema as DDMRP_Hybrid_Algorithm.ipynb.
Set DDMRP_DATASET_PATH or place dataset_after_preprocessing.xlsx under resources_ext/.
"""
from __future__ import annotations

import os
from typing import Any, Dict, Optional, Union

import pandas as pd

_SKU_KEY = Union[int, str]


def _backend_root() -> str:
    return os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))


def get_dataset_path() -> str:
    env = os.getenv("DDMRP_DATASET_PATH")
    if env:
        return env
    return os.path.join(_backend_root(), "resources_ext", "dataset_after_preprocessing.xlsx")


def load_all_data(file_path: Optional[str] = None) -> Dict[str, pd.DataFrame]:
    path = file_path or get_dataset_path()
    if not os.path.isfile(path):
        raise FileNotFoundError(
            f"Dataset not found: {path}. Copy 'dataset after preprocessing.xlsx' "
            "from the notebook bundle or set DDMRP_DATASET_PATH."
        )
    df_s = pd.read_excel(path, sheet_name="sales")
    df_m = pd.read_excel(path, sheet_name="sku_master")

    df_s["Date"] = pd.to_datetime(df_s["Date"])
    df_s["Demand "] = pd.to_numeric(df_s["Demand "], errors="coerce").fillna(0)
    df_s["Promo Discount"] = pd.to_numeric(df_s["Promo Discount"], errors="coerce").fillna(0)

    df_s["IsPromo"] = df_s["Promo Discount"] > 0
    df_s["PromoType"] = "NONE"
    df_s["PromoDiscountPct"] = df_s["Promo Discount"]

    return {"sales": df_s, "master": df_m}


def get_sku_list(data: Dict[str, pd.DataFrame], show: bool = False) -> pd.DataFrame:
    df_s = data["sales"].copy()
    df_m = data["master"].copy()
    df_s["ID Item"] = df_s["ID Item"].astype(str)
    df_m["Material Number"] = df_m["Material Number"].astype(str)
    grp = df_s.groupby("ID Item", as_index=False).agg(
        Grup=("Nama Item", "first"),
        Tgl_Mulai=("Date", "min"),
        Tgl_Akhir=("Date", "max"),
        Jml_Hari=("Date", "count"),
        Total_Demand=("Demand ", "sum"),
        ADU=("Demand ", "mean"),
    )
    grp = grp.merge(
        df_m[["Material Number", "Lead Time_Days", "Logistic Cost/Order"]],
        left_on="ID Item",
        right_on="Material Number",
        how="left",
    )
    grp = grp.drop(columns=["Material Number"])
    grp["ADU"] = grp["ADU"].round(1)
    grp["Tgl_Mulai"] = grp["Tgl_Mulai"].dt.date
    grp["Tgl_Akhir"] = grp["Tgl_Akhir"].dt.date
    if show:
        print(grp.to_string(index=False))
    return grp


def get_sku_demand(
    data: Dict[str, pd.DataFrame],
    sku: _SKU_KEY,
    start_date=None,
    end_date=None,
    verbose: bool = False,
) -> pd.DataFrame:
    df = data["sales"].copy()
    if "ID Item" in df.columns:
        df["ID Item"] = df["ID Item"].astype(str)
    sku_val = str(sku).strip()
    d = df[df["ID Item"] == sku_val].copy()
    if d.empty:
        raise ValueError(f"SKU {sku} tidak ditemukan.")
    if start_date is not None:
        d = d[d["Date"] >= pd.to_datetime(start_date)]
    if end_date is not None:
        d = d[d["Date"] <= pd.to_datetime(end_date)]

    d = d[
        [
            "Date",
            "Demand ",
            "Sales Price Price After Discont",
            "IsPromo",
            "PromoDiscountPct",
            "PromoType",
        ]
    ].copy()
    d.columns = ["Date", "Demand", "Price", "IsPromo", "PromoDiscountPct", "PromoType"]
    d = d.sort_values("Date").reset_index(drop=True)

    dr = pd.date_range(d["Date"].min(), d["Date"].max(), freq="D")
    d = pd.DataFrame({"Date": dr}).merge(d, on="Date", how="left")
    d["Demand"] = d["Demand"].fillna(0)
    d["IsPromo"] = d["IsPromo"].fillna(False)
    d["PromoDiscountPct"] = d["PromoDiscountPct"].fillna(0.0)
    d["PromoType"] = d["PromoType"].fillna("NONE")
    d["Price"] = d["Price"].ffill()

    if verbose:
        print(
            f"✅ SKU {sku} | {d['Date'].min().date()} s/d {d['Date'].max().date()} | "
            f"{len(d)} hari | demand total: {d['Demand'].sum():,.0f}"
        )
    return d.reset_index(drop=True)


def get_sku_params(data: Dict[str, pd.DataFrame], sku: _SKU_KEY) -> Dict[str, Any]:
    df_m = data["master"].copy()
    df_m["Material Number"] = df_m["Material Number"].astype(str)
    sku_val = str(sku).strip()
    row = df_m[df_m["Material Number"] == sku_val]
    if row.empty:
        raise ValueError(f"SKU {sku} tidak ditemukan di master.")
    row = row.iloc[0]

    dlt = int(row["Lead Time_Days"])
    price = float(row["Sales Price"])
    buy = float(row["Purchase Price"])
    hold_day = float(row["Holding Cost Rate/day"]) * price

    return {
        "sku": int(sku_val) if str(sku_val).isdigit() else sku_val,
        "group": str(row["Material Group"]),
        "dlt": dlt,
        "lt_std": round(dlt * 0.10, 2),
        "pack_size": int(row["MOQ"]),
        "price_ea": round(price, 2),
        "purchase_price": round(buy, 2),
        "margin_pct": round((price - buy) / price * 100, 1),
        "hold_rate_annual": round(float(row["Holding Cost Rate/day"]) * 365, 4),
        "hold_cost_per_unit_day": round(hold_day, 6),
        "lost_sale_rate": float(row["Lost Sale Rate/Each"]),
        "penalty_per_unit": round(float(row["Lost Sale Rate/Each"]) * price, 2),
        "order_cost": float(row["Logistic Cost/Order"]),
        "moq": int(row["MOQ"]),
    }
