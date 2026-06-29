"""Shared constants and MOQ/Qmax helpers for buffer v2."""
from __future__ import annotations

from typing import Any, Optional

import pandas as pd

ADI_THRESHOLD = 1.32
CV2_THRESHOLD = 0.49

VF_GLOBAL_BOUNDS = (0.01, 3.00)
LTF_GLOBAL_BOUNDS = (0.01, 3.00)

VF_SPACE = {
    "SMOOTH": (0.10, 0.30),
    "ERRATIC": (0.25, 0.55),
    "INTERMITTENT": (0.30, 0.65),
    "LUMPY": (0.55, 1.00),
}
LTF_SPACE = {
    "SHORT": (0.61, 1.00),
    "MEDIUM": (0.41, 0.60),
    "LONG": (0.20, 0.40),
}


def is_missing(x: Any) -> bool:
    if x is None:
        return True
    try:
        return bool(pd.isna(x))
    except Exception:
        return False


def normalize_qmax(qmax: Any) -> Optional[float]:
    if is_missing(qmax):
        return None
    val = float(qmax)
    return None if val <= 0 else val


def normalize_moq(moq: Any, default: int = 0) -> int:
    if is_missing(moq):
        return int(default)
    return max(int(float(moq)), 0)


def export_daily_simulation(df: Optional[pd.DataFrame]) -> dict[str, Any]:
    """Serialize optimized daily simulation for API (records + CSV for Excel paste)."""
    if df is None or df.empty:
        return {"daily_simulation": [], "daily_simulation_csv": ""}
    out = df.copy()
    if "date" in out.columns:
        out["date"] = pd.to_datetime(out["date"]).dt.strftime("%Y-%m-%d")
    records = out.where(pd.notnull(out), None).to_dict("records")
    csv_text = out.to_csv(index=False, lineterminator="\n")
    return {"daily_simulation": records, "daily_simulation_csv": csv_text}


def apply_moq_qmax(
    q_raw: float,
    moq: int = 0,
    qmax: Optional[float] = None,
    enforce_moq: bool = True,
) -> float:
    if q_raw is None or q_raw <= 0:
        return 0.0
    moq = 0 if moq is None else moq
    if enforce_moq:
        q = max(q_raw, moq)
        if qmax is not None and qmax >= moq:
            q = min(q, qmax)
        return float(q)
    q = q_raw
    if qmax is not None:
        q = min(q, qmax)
    return float(q)
