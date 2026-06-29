"""Route simulation to DDMRP or DDMRP_CONDITIONAL based on classification."""
from __future__ import annotations

from typing import Any, Dict, Optional

from services.buffer_v2.simulate_conditional import build_target_level, simulate_ddmrp_conditional
from services.buffer_v2.simulate_ddmrp import simulate_ddmrp


def simulate_selected_method(
    demands,
    dates,
    params: Dict[str, Any],
    clf: Dict[str, Any],
    vf: Optional[float] = None,
    ltf: Optional[float] = None,
    verbose: bool = False,
) -> Dict[str, Any]:
    method = clf["method"]
    vf = float(clf["vf_init"] if vf is None else vf)
    ltf = float(clf["ltf_init"] if ltf is None else ltf)

    sim_kw = dict(
        demands=demands,
        dates=dates,
        vf=vf,
        ltf=ltf,
        dlt=int(params["dlt"]),
        pack_size=int(params.get("pack_size", 1)),
        unit_price=float(params.get("price_ea", 0)),
        hold_cost_per_unit_day=float(params["hold_cost_per_unit_day"]),
        order_cost=float(params["order_cost"]),
        penalty_mult=float(params["penalty_per_unit"]),
        qmax=params.get("qmax"),
        initial_inventory=params["initial_inventory"],
        moq=int(params.get("moq", 0)),
        qd_source="actual_demand",
        verbose=verbose,
    )

    if method == "DDMRP":
        return simulate_ddmrp(**sim_kw)

    if method == "DDMRP_CONDITIONAL":
        target_info = build_target_level(demands, params)
        kpi = simulate_ddmrp_conditional(
            **sim_kw,
            target_level=target_info["target_level"],
            target_percentile=target_info["target_percentile"],
            use_qd_next_for_trigger=True,
            target_stock_basis="ip",
        )
        kpi["target_level"] = target_info["target_level"]
        kpi["target_percentile"] = target_info["target_percentile"]
        return kpi

    raise ValueError("Method tidak dikenali. Gunakan 'DDMRP' atau 'DDMRP_CONDITIONAL'.")
