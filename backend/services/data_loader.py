"""
Load preprocessed Excel (sales + sku_master) — same schema as DDMRP_Hybrid_Algorithm.ipynb.
Set DDMRP_DATASET_PATH or place dataset_after_preprocessing.xlsx under resources_ext/.
"""
from __future__ import annotations

import os
import math
from typing import Any, Dict, Optional, Union

import pandas as pd

_SKU_KEY = Union[int, str]


def _build_carton_mapping(df_master: pd.DataFrame) -> Dict[str, int]:
    candidate_cols = [
        "Qty Per Carton",
        "Qty_per_Carton",
        "Qty per Carton",
        "Pcs per CTN",
        "Pcs/CTN",
        "Each per Carton",
        "Carton Size",
        "Pack Size",
    ]
    qty_col = next((c for c in candidate_cols if c in df_master.columns), None)
    if qty_col is None:
        return {}

    out: Dict[str, int] = {}
    base = df_master[["Material Number", qty_col]].copy()
    base["Material Number"] = base["Material Number"].astype(str).str.strip()
    base[qty_col] = pd.to_numeric(base[qty_col], errors="coerce")
    for _, row in base.iterrows():
        sku = str(row["Material Number"]).strip()
        qty = row[qty_col]
        if not sku or pd.isna(qty):
            continue
        qty_i = int(qty)
        if qty_i > 0:
            out[sku] = qty_i
    return out


def _qty_per_carton_for_sku(data: Dict[str, pd.DataFrame], sku_val: str) -> int:
    """
    Resolve qty_per_carton with DB/master-first strategy.
    Priority:
    1) master row columns (Qty Per Carton / Pack Size aliases)
    2) prebuilt carton_mapping dict
    """
    df_m = data.get("master")
    candidate_cols = [
        "Qty Per Carton",
        "Qty_per_Carton",
        "Qty per Carton",
        "Pcs per CTN",
        "Pcs/CTN",
        "Each per Carton",
        "Carton Size",
        "Pack Size",
        "pack_size",
    ]
    if isinstance(df_m, pd.DataFrame) and not df_m.empty and "Material Number" in df_m.columns:
        m = df_m.copy()
        m["Material Number"] = m["Material Number"].astype(str).str.strip()
        row = m[m["Material Number"] == sku_val]
        if not row.empty:
            r = row.iloc[0]
            for col in candidate_cols:
                if col in m.columns:
                    q = pd.to_numeric(r.get(col), errors="coerce")
                    if pd.notna(q) and float(q) > 0:
                        return int(q)

    carton_mapping = data.get("carton_mapping", {})
    q = carton_mapping.get(sku_val)
    if q is not None and int(q) > 0:
        return int(q)
    raise ValueError(f"Qty Per Carton wajib diisi untuk SKU {sku_val}.")


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

    carton_mapping = _build_carton_mapping(df_m)
    return {"sales": df_s, "master": df_m, "carton_mapping": carton_mapping}


def get_sku_list(
    data: Dict[str, pd.DataFrame],
    show: bool = False,
    strict_carton_mapping: bool = True,
) -> pd.DataFrame:
    df_s = data["sales"].copy()
    df_m = data["master"].copy()
    carton_mapping = data.get("carton_mapping", {})
    df_s["ID Item"] = df_s["ID Item"].astype(str)
    df_m["Material Number"] = df_m["Material Number"].astype(str)
    missing = sorted(set(df_s["ID Item"].unique()) - set(carton_mapping.keys()))
    if missing and strict_carton_mapping:
        raise ValueError(
            "Qty Per Carton wajib tersedia untuk semua SKU. "
            f"SKU tanpa mapping: {', '.join(missing[:10])}"
            + (" ..." if len(missing) > 10 else "")
        )
    default_qty = 1
    df_s["qty_per_carton"] = (
        df_s["ID Item"].map(lambda x: carton_mapping.get(str(x).strip(), default_qty)).astype(float)
    )
    df_s["qty_per_carton"] = df_s["qty_per_carton"].replace(0, 1)
    # Listing metrics should follow carton unit (CTN) consistently.
    df_s["Demand "] = pd.to_numeric(df_s["Demand "], errors="coerce").fillna(0) / df_s["qty_per_carton"]
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
    qty_per_carton = _qty_per_carton_for_sku(data, sku_val)
    if qty_per_carton <= 0:
        raise ValueError(f"Qty Per Carton tidak valid untuk SKU {sku}: {qty_per_carton}")
    d["Demand"] = d["Demand"].astype(float) / qty_per_carton

    if verbose:
        print(
            f"✅ SKU {sku} | {d['Date'].min().date()} s/d {d['Date'].max().date()} | "
            f"{len(d)} hari | demand total: {d['Demand'].sum():,.3f} CTN "
            f"({qty_per_carton} Pcs/CTN)"
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
    qty_per_carton = _qty_per_carton_for_sku(data, sku_val)
    if qty_per_carton <= 0:
        raise ValueError(f"Qty Per Carton tidak valid untuk SKU {sku}: {qty_per_carton}")

    price_ea = float(row["Sales Price"])
    buy_ea = float(row["Purchase Price"])
    price_ctn = price_ea * qty_per_carton
    buy_ctn = buy_ea * qty_per_carton
    hold_day_ctn = float(row["Holding Cost Rate/day"]) * price_ctn
    penalty_ctn = float(row["Lost Sale Rate/Each"]) * price_ctn
    moq_each = int(row["MOQ"]) if "MOQ" in row and not pd.isna(row["MOQ"]) else 1
    moq_ctn = max(1, int(math.ceil(moq_each / qty_per_carton)))

    return {
        "sku": int(sku_val) if str(sku_val).isdigit() else sku_val,
        "group": str(row["Material Group"]),
        "dlt": dlt,
        "lt_std": round(dlt * 0.10, 2),
        "qty_per_carton": qty_per_carton,
        "pack_size": 1,
        "moq_each": moq_each,
        "price_ea": round(price_ea, 2),
        "price_ctn": round(price_ctn, 2),
        "purchase_price": round(buy_ctn, 2),
        "margin_pct": round((price_ea - buy_ea) / price_ea * 100, 1) if price_ea > 0 else 0.0,
        "hold_rate_annual": round(float(row["Holding Cost Rate/day"]) * 365, 4),
        "hold_cost_per_unit_day": round(hold_day_ctn, 6),
        "lost_sale_rate": float(row["Lost Sale Rate/Each"]),
        "penalty_per_unit": round(penalty_ctn, 2),
        "order_cost": float(row["Logistic Cost/Order"]),
        "moq": moq_ctn,
    }
