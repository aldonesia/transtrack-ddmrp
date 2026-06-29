"""Buffer optimization v2 pipeline — forecast optional, actual-demand simulation."""
from __future__ import annotations

from typing import Any, Dict, Optional

import pandas as pd

from services.buffer_v2.classification import classify_sku_v2
from services.buffer_v2.common import VF_GLOBAL_BOUNDS, LTF_GLOBAL_BOUNDS, export_daily_simulation
from services.buffer_v2.ga_optimizer import build_buffer, run_ga_buffer_optimization
from services.buffer_v2.selected_method import simulate_selected_method
from services.data_loader import get_sku_demand, get_sku_params
from services.hybrid_forecast import run_forecast


def _norm_sku(sku) -> str:
    return str(sku).strip()


def _require_initial_inventory(params: Dict[str, Any]) -> float:
    inv = params.get("initial_inventory")
    if inv is None:
        raise ValueError("initial_inventory wajib diisi di master SKU untuk buffer v2.")
    return float(inv)


def _strip_detail(kpi: Dict[str, Any]) -> Dict[str, Any]:
    return {k: v for k, v in kpi.items() if k != "df_detail"}


def run_buffer_optimization_v2(
    data: Dict[str, Any],
    sku,
    sl_target: float = 0.95,
    pop_size: int = 30,
    n_gen: int = 80,
    include_baseline: bool = True,
    forecast_result: Optional[Dict[str, Any]] = None,
    return_detail: bool = False,
) -> Dict[str, Any]:
    sku_s = _norm_sku(sku)
    df_raw = get_sku_demand(data, sku_s, verbose=False)
    params = get_sku_params(data, sku_s)
    params["initial_inventory"] = _require_initial_inventory(params)
    params["target_sl"] = float(sl_target)

    demands = df_raw["Demand"].values.astype(float)
    dates = df_raw["Date"].reset_index(drop=True)
    if len(demands) == 0:
        raise ValueError("Demand series empty — cannot run buffer v2.")

    clf = classify_sku_v2(df_raw, params, verbose=False)
    unit = str(params.get("unit") or "EA").upper()

    result_fc = forecast_result or run_forecast(df_raw, sku_s, verbose=False)

    kpi_base = None
    if include_baseline:
        kpi_base_raw = simulate_selected_method(
            demands=demands,
            dates=dates,
            params=params,
            clf=clf,
            vf=clf["vf_init"],
            ltf=clf["ltf_init"],
            verbose=False,
        )
        kpi_base = {
            "method": clf["method"],
            "vf": clf["vf_init"],
            "ltf": clf["ltf_init"],
            "kpi": _strip_detail(kpi_base_raw),
        }

    ga = run_ga_buffer_optimization(
        demands=demands,
        dates=dates,
        params=params,
        cls=clf,
        pop_size=pop_size,
        n_gen=n_gen,
        verbose=False,
    )

    kpi_opt_raw = simulate_selected_method(
        demands=demands,
        dates=dates,
        params=params,
        clf=clf,
        vf=ga["vf_opt"],
        ltf=ga["ltf_opt"],
        verbose=False,
    )
    buffer = build_buffer(demands, ga["vf_opt"], ga["ltf_opt"], params)
    optimized_detail_df = kpi_opt_raw.get("df_detail") if return_detail else None
    daily_export = (
        export_daily_simulation(optimized_detail_df)
        if return_detail and isinstance(optimized_detail_df, pd.DataFrame)
        else {"daily_simulation": [], "daily_simulation_csv": ""}
    )

    hist = ga["history"]
    hist_records = hist.to_dict("records") if isinstance(hist, pd.DataFrame) else []

    simulation_meta = {
        "method": clf["method"],
        "qd_source": "actual_demand",
        "initial_inventory": params["initial_inventory"],
        "target_percentile": params.get("target_percentile", 0.95),
    }
    if clf["method"] == "DDMRP_CONDITIONAL":
        simulation_meta["target_level"] = kpi_opt_raw.get("target_level")

    return {
        "api_version": "v2",
        "sku": sku_s,
        "unit": unit,
        "classification": clf,
        "optimization": {
            "engine": "GA",
            "pop_size": pop_size,
            "n_gen": n_gen,
            "sl_target": sl_target,
            "vf_opt": ga["vf_opt"],
            "ltf_opt": ga["ltf_opt"],
            "search_bounds": {"vf": list(VF_GLOBAL_BOUNDS), "ltf": list(LTF_GLOBAL_BOUNDS)},
            "ga_history_tail": hist_records[-15:] if len(hist_records) > 15 else hist_records,
        },
        "simulation": simulation_meta,
        "buffer": buffer,
        "forecast_best_model": result_fc.get("best_model"),
        "forecast_metrics": result_fc.get("best_metrics"),
        "baseline": kpi_base,
        "optimized": {
            "method": clf["method"],
            "kpi": _strip_detail(kpi_opt_raw),
        },
        "daily_simulation": daily_export["daily_simulation"],
        "daily_simulation_csv": daily_export["daily_simulation_csv"],
        "optimized_detail": (
            optimized_detail_df.to_dict("records")
            if return_detail and isinstance(optimized_detail_df, pd.DataFrame)
            else None
        ),
    }
