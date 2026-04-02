"""
End-to-end forecast + buffer GA (notebook RUN 2 + RUN 3).
"""
from __future__ import annotations

from typing import Any, Dict, Optional

import numpy as np
import pandas as pd

from services.data_loader import get_sku_demand, get_sku_params
from services.hybrid_forecast import build_forecast_series_for_simulation, run_forecast
from services.hybrid_optimizer import GeneticOptimizer, classify_sku, simulate_ddmrp


def _norm_sku(sku) -> str:
    return str(sku).strip()


def run_forecast_for_api(data: Dict[str, Any], sku) -> Dict[str, Any]:
    sku_s = _norm_sku(sku)
    df = get_sku_demand(data, sku_s, verbose=False)
    result = run_forecast(df, sku_s, verbose=False)
    return result


def run_buffer_optimization(
    data: Dict[str, Any],
    sku,
    sl_target: float = 0.95,
    pop_size: int = 24,
    n_gen: int = 40,
    include_baseline: bool = True,
    forecast_result: Optional[Dict[str, Any]] = None,
    return_detail: bool = False,
) -> Dict[str, Any]:
    sku_s = _norm_sku(sku)
    df_raw = get_sku_demand(data, sku_s, verbose=False)
    params = get_sku_params(data, sku_s)

    result_fc = forecast_result or run_forecast(df_raw, sku_s, verbose=False)
    clean = result_fc["series_clean"]

    df_clf = df_raw.copy()
    df_clf["Demand"] = clean
    clf = classify_sku(df_clf, params, verbose=False)
    if not clf:
        raise ValueError("Demand series empty — cannot classify SKU.")

    fc = build_forecast_series_for_simulation(result_fc, clean)
    dates = df_raw["Date"].reset_index(drop=True)
    moq = params["moq"]

    def sim_fn(vf, ltf):
        return simulate_ddmrp(
            clean,
            fc,
            dates,
            vf,
            ltf,
            params["dlt"],
            moq,
            params["price_ea"],
            params["hold_cost_per_unit_day"],
            params["order_cost"],
            params["penalty_per_unit"],
            lt_std=0.0,
            verbose=False,
        )

    kpi_base = None
    if include_baseline:
        kpi_base_raw = sim_fn(clf["vf_init"], clf["ltf_init"])
        kpi_base = _strip_detail(kpi_base_raw)

    ga = GeneticOptimizer(
        (clf["vf_low"], clf["vf_high"]),
        (clf["ltf_low"], clf["ltf_high"]),
        sl_target=sl_target,
        pop_size=pop_size,
        n_gen=n_gen,
        verbose=False,
    )
    gr = ga.run(sim_fn, clf["vf_init"], clf["ltf_init"])
    kpi_opt_raw = gr["kpi"]
    optimized_detail = kpi_opt_raw.get("df_detail") if return_detail else None
    kpi_opt = _strip_detail(kpi_opt_raw)

    hist = gr["history"]
    hist_records = hist.to_dict("records") if isinstance(hist, pd.DataFrame) else []

    return {
        "sku": sku_s,
        "classification": clf,
        "forecast_best_model": result_fc["best_model"],
        "forecast_metrics": result_fc["best_metrics"],
        "baseline": kpi_base,
        "optimized": {
            "fv_opt": gr["vf_opt"],
            "ltf_opt": gr["ltf_opt"],
            "kpi": kpi_opt,
        },
        "ga_history_tail": hist_records[-15:] if len(hist_records) > 15 else hist_records,
        "optimized_detail": optimized_detail.to_dict("records") if return_detail and isinstance(optimized_detail, pd.DataFrame) else None,
    }


def _strip_detail(kpi: Dict[str, Any]) -> Dict[str, Any]:
    out = {k: v for k, v in kpi.items() if k != "df_detail"}
    return out
