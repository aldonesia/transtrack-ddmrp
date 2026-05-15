"""
Pure Excel/header parsing for master SKU + demand uploads (no FastAPI / DB).
Column layout matches `sku_master` sheet / Data 2.xlsx.
"""
from __future__ import annotations

import numbers
import re
from datetime import date, datetime, timedelta
from typing import Any, Optional

import pandas as pd

# Excel headers (exact order for template / export)
MASTER_SKU_EXCEL_COLUMNS: tuple[str, ...] = (
    "Material Number",
    "Material Description",
    "Material Group",
    "Unit",
    "Criticality",
    "ABC Class",
    "XYZ Class",
    "Vendor Type",
    "Currency",
    "Lead Time_Days",
    "MOQ",
    "Sales Price",
    "Purchase Price",
    "Holding Cost Rate/day",
    "Holding Cost/day (IDR)",
    "Lost Sale Rate/Each",
    "Penalty/unit (IDR)",
    "Logistic Cost/Order",
)

# Normalized keys (after _normalize_column_map) — must all be present in upload file
MASTER_SKU_NORMALIZED_KEYS: tuple[str, ...] = tuple(
    re.sub(r"\s+", " ", str(h).strip().lower()) for h in MASTER_SKU_EXCEL_COLUMNS
)

MASTER_SKU_ALLOWED_UNITS: frozenset[str] = frozenset(
    {"EA", "SET", "BAG", "PKT", "BOX", "LBS", "KG", "MT", "M", "FT", "IN", "L"}
)

# Excel serial day (OOXML): day count from 1899-12-30; typical business rows are >> 25k (1970+).
_EXCEL_SERIAL_ORIGIN = datetime(1899, 12, 30)
_EXCEL_SERIAL_MIN = 25569  # ~1970-01-01
_EXCEL_SERIAL_MAX = 1_000_000.0  # below Unix-ms range; avoids mis-parsing epoch seconds


def master_sku_template_sample_rows() -> list[dict[str, Any]]:
    return [
        {
            "Material Number": "100004821",
            "Material Description": "HYDRAULIC PUMP ASSY - CAT 740B",
            "Material Group": "Spare Part",
            "Unit": "EA",
            "Criticality": "High",
            "ABC Class": "A",
            "XYZ Class": "Z",
            "Vendor Type": "Import",
            "Currency": "USD",
            "Lead Time_Days": 63,
            "MOQ": 1,
            "Sales Price": 47549019.0,
            "Purchase Price": 47549019.0,
            "Holding Cost Rate/day": 0.0005,
            "Holding Cost/day (IDR)": 23774.51,
            "Lost Sale Rate/Each": 0.3,
            "Penalty/unit (IDR)": 14264706.0,
            "Logistic Cost/Order": 50000.0,
        },
        {
            "Material Number": "100004822",
            "Material Description": "",
            "Material Group": "Spare Part",
            "Unit": "EA",
            "Criticality": "",
            "ABC Class": "",
            "XYZ Class": "",
            "Vendor Type": "",
            "Currency": "",
            "Lead Time_Days": 78,
            "MOQ": 1,
            "Sales Price": 36470588.0,
            "Purchase Price": 36470588.0,
            "Holding Cost Rate/day": 0.0005,
            "Holding Cost/day (IDR)": "",
            "Lost Sale Rate/Each": 0.3,
            "Penalty/unit (IDR)": "",
            "Logistic Cost/Order": 50000.0,
        },
    ]


def sku_master_row_to_excel(r: Any) -> dict[str, Any]:
    """Map ORM `SKUMaster` (or compatible object) to export/template column dict."""
    return {
        "Material Number": r.sku,
        "Material Description": r.nama_item or "",
        "Material Group": r.group or "",
        "Unit": r.unit or "EA",
        "Criticality": getattr(r, "criticality", None) or "",
        "ABC Class": getattr(r, "abc_class", None) or "",
        "XYZ Class": getattr(r, "xyz_class", None) or "",
        "Vendor Type": getattr(r, "vendor_type", None) or "",
        "Currency": getattr(r, "currency", None) or "",
        "Lead Time_Days": r.lead_time,
        "MOQ": r.moq,
        "Sales Price": r.harga,
        "Purchase Price": r.purchase_price,
        "Holding Cost Rate/day": r.holding_cost_rate_day,
        "Holding Cost/day (IDR)": getattr(r, "holding_cost_day_idr", None),
        "Lost Sale Rate/Each": r.lost_sale_rate_each,
        "Penalty/unit (IDR)": getattr(r, "penalty_per_unit_idr", None),
        "Logistic Cost/Order": r.logistic_cost_order,
    }


def _excel_serial_to_date(serial: float) -> date:
    day = int(serial)
    if day < 1:
        raise ValueError("invalid excel serial")
    return (_EXCEL_SERIAL_ORIGIN + timedelta(days=day)).date()


def _coerce_float_maybe_excel_serial(val: Any) -> Optional[float]:
    if isinstance(val, bool):
        return None
    if isinstance(val, numbers.Integral):
        return float(val)
    if isinstance(val, numbers.Real):
        return float(val)
    if isinstance(val, str):
        t = val.strip()
        if not t:
            return None
        try:
            return float(t)
        except ValueError:
            return None
    return None


def _format_date_dd_mm_yy(d: date) -> str:
    """Short date for Excel templates and UI (dd/mm/yy)."""
    return d.strftime("%d/%m/%y")


def _parse_dd_mm_yy_string(s: str) -> Optional[date]:
    m = re.match(r"^(\d{1,2})/(\d{1,2})/(\d{2,4})$", s.strip())
    if not m:
        return None
    day, month, year = int(m.group(1)), int(m.group(2)), int(m.group(3))
    if year < 100:
        year += 2000 if year < 70 else 1900
    return date(year, month, day)


def _parse_date(val: Any) -> date:
    if isinstance(val, datetime):
        return val.date()
    if isinstance(val, date):
        return val
    if pd.isna(val):
        raise ValueError("empty date")
    if isinstance(val, str):
        parsed = _parse_dd_mm_yy_string(val)
        if parsed is not None:
            return parsed
    num = _coerce_float_maybe_excel_serial(val)
    if num is not None and _EXCEL_SERIAL_MIN <= num < _EXCEL_SERIAL_MAX:
        try:
            return _excel_serial_to_date(num)
        except (OverflowError, ValueError, OSError):
            pass
    return pd.to_datetime(val).date()


def _normalize_column_map(df: pd.DataFrame) -> pd.DataFrame:
    mapping = {}
    for c in df.columns:
        key = str(c).strip().lower()
        key = re.sub(r"\s+", " ", key)
        mapping[c] = key
    out = df.rename(columns=mapping)
    return out


def _first_existing_col(dfn: pd.DataFrame, candidates: tuple[str, ...]) -> Optional[str]:
    for c in candidates:
        if c in dfn.columns:
            return c
    return None


def _sku_key_from_excel(val: Any) -> str:
    if val is None or (isinstance(val, float) and pd.isna(val)):
        return ""
    if isinstance(val, str):
        s = val.strip()
        if not s or s.lower() == "nan":
            return ""
        return s
    try:
        n = pd.to_numeric(val, errors="coerce")
        if pd.notna(n) and float(n).is_integer():
            return str(int(float(n)))
    except (ValueError, OverflowError, TypeError):
        pass
    return str(val).strip()


def _str_cell(row: pd.Series, col: str, default: str = "") -> str:
    if col not in row.index:
        return default
    v = row[col]
    if v is None or (isinstance(v, float) and pd.isna(v)):
        return default
    s = str(v).strip()
    return s if s else default


def _float_cell(row: pd.Series, col: str) -> Optional[float]:
    if col not in row.index:
        return None
    x = pd.to_numeric(row[col], errors="coerce")
    if pd.isna(x):
        return None
    return float(x)


def _required_master_column_keys() -> list[str]:
    return list(MASTER_SKU_NORMALIZED_KEYS)


def _missing_master_columns_message(missing: list[str]) -> str:
    norm_to_label = {
        re.sub(r"\s+", " ", h.strip().lower()): h for h in MASTER_SKU_EXCEL_COLUMNS
    }
    labels = [norm_to_label.get(k, k) for k in missing]
    return (
        "Kolom Master SKU tidak lengkap. Wajib header: "
        + "; ".join(MASTER_SKU_EXCEL_COLUMNS)
        + ". Yang hilang: "
        + ", ".join(labels)
    )


def _parse_master_sku_row(row: pd.Series) -> dict[str, Any]:
    """Parse one normalized row; raises ValueError on invalid required values."""
    sku = _sku_key_from_excel(row["material number"])
    if not sku:
        raise ValueError("Material Number kosong")
    material_group = _str_cell(row, "material group")
    if not material_group:
        raise ValueError("Material Group kosong")
    lead_time = int(pd.to_numeric(row["lead time_days"], errors="raise"))
    moq = int(pd.to_numeric(row["moq"], errors="raise"))
    if moq <= 0:
        raise ValueError("MOQ harus > 0")
    sales_price = float(pd.to_numeric(row["sales price"], errors="raise"))
    purchase_price = float(pd.to_numeric(row["purchase price"], errors="raise"))
    holding_cost_rate_day = float(pd.to_numeric(row["holding cost rate/day"], errors="raise"))
    lost_sale_rate_each = float(pd.to_numeric(row["lost sale rate/each"], errors="raise"))
    logistic_cost_order = float(pd.to_numeric(row["logistic cost/order"], errors="raise"))
    desc = _str_cell(row, "material description")
    nama_item = desc if desc else material_group
    unit_raw = _str_cell(row, "unit", "EA") or "EA"
    unit = unit_raw.upper()
    if unit not in MASTER_SKU_ALLOWED_UNITS:
        allowed = ", ".join(sorted(MASTER_SKU_ALLOWED_UNITS))
        raise ValueError(f"Unit '{unit_raw}' invalid. Allowed: {allowed}")
    return {
        "sku": sku,
        "nama_item": nama_item,
        "group": material_group,
        "unit": unit,
        "status": "Active",
        "lead_time": max(0, lead_time),
        "harga": max(0.0, sales_price),
        "purchase_price": max(0.0, purchase_price),
        "holding_cost_rate_day": max(0.0, holding_cost_rate_day),
        "lost_sale_rate_each": max(0.0, lost_sale_rate_each),
        "logistic_cost_order": max(0.0, logistic_cost_order),
        "moq": max(1, moq),
        "criticality": _str_cell(row, "criticality") or None,
        "abc_class": _str_cell(row, "abc class") or None,
        "xyz_class": _str_cell(row, "xyz class") or None,
        "vendor_type": _str_cell(row, "vendor type") or None,
        "currency": _str_cell(row, "currency") or None,
        "holding_cost_day_idr": _float_cell(row, "holding cost/day (idr)"),
        "penalty_per_unit_idr": _float_cell(row, "penalty/unit (idr)"),
    }


# Normalized header names for demand columns (after _normalize_column_map).
# "Demand " (trailing space) normalizes to "demand" — covered by first candidate.
DEMAND_EXCEL_COLUMNS: tuple[str, ...] = (
    "ID Item",
    "Nama Item",
    "Date",
    "Demand ",          # trailing space — exactly as Data 2.xlsx sheet sales
    "Sales Price Price After Discont",
    "Promo Discount",
    "IsPromo",
    "PromoDiscountPct",
    "PromoType",
)

DEMAND_REQUIRED_COLUMNS: tuple[str, str, str] = ("ID Item", "Date", "Demand ")


def demand_template_sample_rows() -> list[dict]:
    return [
        {
            "ID Item": "100004821",
            "Nama Item": "HYDRAULIC PUMP ASSY - CAT 740B",
            "Date": _format_date_dd_mm_yy(date(2026, 1, 1)),
            "Demand ": 1.0,
            "Sales Price Price After Discont": 47549019.0,
            "Promo Discount": 0.0,
            "IsPromo": 0,
            "PromoDiscountPct": 0.0,
            "PromoType": "NONE",
        },
        {
            "ID Item": "100004821",
            "Nama Item": "HYDRAULIC PUMP ASSY - CAT 740B",
            "Date": _format_date_dd_mm_yy(date(2026, 1, 2)),
            "Demand ": 3.0,
            "Sales Price Price After Discont": 47549019.0,
            "Promo Discount": 0.05,
            "IsPromo": 1,
            "PromoDiscountPct": 5.0,
            "PromoType": "PROMO_A",
        },
    ]


def _coerce_demand_upload(df: pd.DataFrame) -> pd.DataFrame:
    dfn = _normalize_column_map(df)
    # Candidate lookups — after normalization (strip + collapse whitespace + lowercase)
    col_date = _first_existing_col(dfn, ("date", "tanggal", "tgl", "periode"))
    col_sku = _first_existing_col(dfn, ("id item", "sku", "id_item", "material number", "material", "kode"))
    # "Demand " (trailing space) → "demand" after normalization
    col_dem = _first_existing_col(dfn, ("demand", "qty", "quantity", "jumlah"))
    # PromoDiscountPct → "promodiscountpct"; "Promo Discount" → "promo discount"
    col_promo = _first_existing_col(
        dfn,
        ("promodiscountpct", "promo discount", "promo_discount", "diskon", "promo"),
    )
    if not col_date or not col_sku or not col_dem:
        missing = [
            lbl
            for lbl, col in (("Date", col_date), ("ID Item", col_sku), ("Demand", col_dem))
            if not col
        ]
        raise ValueError(
            f"Kolom wajib tidak ditemukan: {', '.join(missing)}. "
            "Kolom wajib: ID Item, Date, Demand. "
            f"Kolom terdeteksi: {list(dfn.columns)}"
        )
    rows = []
    for _, row in dfn.iterrows():
        try:
            dt = _parse_date(row[col_date])
            sku = _sku_key_from_excel(row[col_sku])
            if not sku or sku.lower() == "nan":
                continue
            dem = float(pd.to_numeric(row[col_dem], errors="coerce") or 0)
            promo = 0.0
            if col_promo:
                raw_promo = pd.to_numeric(row[col_promo], errors="coerce")
                if pd.notna(raw_promo):
                    promo = float(raw_promo)
                    # If PromoDiscountPct stores percentage (e.g. 5.0 = 5%), normalise to fraction
                    if col_promo == "promodiscountpct" and promo > 1.0:
                        promo = promo / 100.0
        except Exception:
            continue
        rows.append({"date": dt, "sku": sku, "demand": dem, "promo_discount": promo})
    if not rows:
        raise ValueError("Tidak ada baris valid setelah parsing.")
    return pd.DataFrame(rows)


def _coerce_master_sku_upload(df: pd.DataFrame) -> pd.DataFrame:
    dfn = _normalize_column_map(df)
    required = _required_master_column_keys()
    missing = [k for k in required if k not in dfn.columns]
    if missing:
        raise ValueError(_missing_master_columns_message(missing))

    col_status = _first_existing_col(dfn, ("status",))
    rows = []
    for _, row in dfn.iterrows():
        try:
            parsed = _parse_master_sku_row(row)
            if col_status:
                st = _str_cell(row, col_status, "Active") or "Active"
                parsed["status"] = st
            rows.append(parsed)
        except Exception:
            continue
    if not rows:
        raise ValueError("Tidak ada baris valid setelah parsing Master SKU.")
    return pd.DataFrame(rows)
