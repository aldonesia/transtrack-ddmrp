"""Integration v2 API response builders (notebook-style JSON vs CSV export)."""
from __future__ import annotations

from typing import Any, Dict, Optional

from fastapi.responses import Response


def _fmt_decimal(value: Any, places: int = 2) -> Optional[str]:
    if value is None:
        return None
    try:
        return f"{float(value):.{places}f}"
    except (TypeError, ValueError):
        return None


def _fmt_percent(value: Any) -> Optional[str]:
    if value is None:
        return None
    try:
        return f"{float(value) * 100:.2f}%"
    except (TypeError, ValueError):
        return None


def _fmt_rupiah(value: Any) -> Optional[str]:
    if value is None:
        return None
    try:
        return f"Rp{int(round(float(value))):,}"
    except (TypeError, ValueError):
        return None


def _fmt_optional(value: Any) -> Any:
    if value is None:
        return None
    return value


def build_simulation_summary(
    optimize_payload: Dict[str, Any],
) -> Dict[str, Any]:
    """Notebook stdout fields (Hybrid_DDMRP_with_Optimasi_Buffer_Via_GA.ipynb)."""
    clf = optimize_payload.get("classification") or {}
    optimization = optimize_payload.get("optimization") or {}
    kpi = (optimize_payload.get("optimized") or {}).get("kpi") or {}
    simulation = optimize_payload.get("simulation") or {}

    method = kpi.get("method") or simulation.get("method") or clf.get("method")
    vf = optimization.get("vf_opt", kpi.get("vf"))
    ltf = optimization.get("ltf_opt", kpi.get("ltf"))
    initial_inventory = kpi.get("initial_inventory") or simulation.get("initial_inventory")
    target_percentile = kpi.get("target_percentile") or simulation.get("target_percentile")
    target_level = kpi.get("target_level") or simulation.get("target_level")
    ss = kpi.get("ss")

    summary: Dict[str, Any] = {
        "Method": method,
        "VF": _fmt_decimal(vf, 4),
        "LTF": _fmt_decimal(ltf, 4),
        "Initial Inventory": _fmt_decimal(initial_inventory, 1),
        "ADU": _fmt_decimal(kpi.get("adu"), 4),
        "TOR": _fmt_decimal(kpi.get("tor"), 2),
        "TOY": _fmt_decimal(kpi.get("toy"), 2),
        "TOG": _fmt_decimal(kpi.get("tog"), 2),
        "Target Percentile": _fmt_decimal(target_percentile, 2),
        "Target Level": _fmt_decimal(target_level, 2),
        "Safety Stock": _fmt_optional(ss),
        "Fill Rate": _fmt_percent(kpi.get("fill_rate")),
        "CSL": _fmt_percent(kpi.get("csl")),
        "Stockout Days": kpi.get("n_stockout"),
        "Jumlah Order": kpi.get("n_orders"),
        "Total Qty Order": kpi.get("total_order_qty"),
        "Total Cost": _fmt_rupiah(kpi.get("total_cost")),
    }
    return summary


def build_simulation_summary_text(summary: Dict[str, Any]) -> str:
    """Multiline text matching notebook print layout."""
    lines = [
        f"Method : {summary.get('Method')}",
        f"VF     : {summary.get('VF')}",
        f"LTF    : {summary.get('LTF')}",
        f"Initial Inventory = {summary.get('Initial Inventory')}",
        f"ADU               = {summary.get('ADU')}",
        f"VF                = {summary.get('VF')}",
        f"LTF               = {summary.get('LTF')}",
        f"TOR               = {summary.get('TOR')}",
        f"TOY               = {summary.get('TOY')}",
        f"TOG               = {summary.get('TOG')}",
        f"Target Percentile = {summary.get('Target Percentile')}",
        f"Target Level      = {summary.get('Target Level')}",
        f"Safety Stock      = {summary.get('Safety Stock')}",
        f"Fill Rate         = {summary.get('Fill Rate')}",
        f"CSL               = {summary.get('CSL')}",
        f"Stockout Days     = {summary.get('Stockout Days')}",
        f"Jumlah Order      = {summary.get('Jumlah Order')}",
        f"Total Qty Order   = {summary.get('Total Qty Order')}",
        f"Total Cost        = {summary.get('Total Cost')}",
    ]
    return "\n".join(lines)


def build_v2_notebook_json(
    sku_no: str,
    optimize_payload: Dict[str, Any],
    *,
    buffer_id: Optional[int] = None,
    latest_run_id: Optional[int] = None,
) -> Dict[str, Any]:
    """JSON with notebook summary labels + daily simulation table."""
    simulation_summary = build_simulation_summary(optimize_payload)

    payload: Dict[str, Any] = {
        "sku_no": sku_no,
        "status": "ok",
        "api_version": "v2",
        "unit": optimize_payload.get("unit"),
        "simulation_summary": simulation_summary,
        "simulation_summary_text": build_simulation_summary_text(simulation_summary),
        "daily_simulation": optimize_payload.get("daily_simulation") or [],
    }
    if buffer_id is not None:
        payload["buffer_id"] = buffer_id
    if latest_run_id is not None:
        payload["latest_run_id"] = latest_run_id
    return payload


def daily_simulation_csv_response(sku_no: str, csv_text: str) -> Response:
    """Plain CSV body for copy-paste or download."""
    filename = f"daily_simulation_{sku_no}.csv"
    return Response(
        content=csv_text or "",
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
