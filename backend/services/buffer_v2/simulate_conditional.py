"""DDMRP conditional simulation + LTD target level."""
from __future__ import annotations

import math
from typing import Any, Dict, Optional

import numpy as np
import pandas as pd

from services.buffer_v2.common import apply_moq_qmax


def compute_ltd_stats(demands, dlt: int, target_percentile: float = 0.95) -> Dict[str, Any]:
    s = np.asarray(demands, dtype=float)
    n = len(s)
    dlt = int(dlt)
    if n == 0:
        ltd = np.array([0.0])
    elif n < dlt:
        ltd = np.array([s.sum()])
    else:
        ltd = np.array([s[i : i + dlt].sum() for i in range(n - dlt + 1)])

    avg_ltd = float(np.mean(ltd)) if len(ltd) > 0 else 0.0
    p75_ltd = float(np.percentile(ltd, 75)) if len(ltd) > 0 else 0.0
    p90_ltd = float(np.percentile(ltd, 90)) if len(ltd) > 0 else 0.0
    p95_ltd = float(np.percentile(ltd, 95)) if len(ltd) > 0 else 0.0
    target_ltd = float(np.percentile(ltd, target_percentile * 100)) if len(ltd) > 0 else 0.0
    prob_ltd_pos = float(np.mean(ltd > 0)) if len(ltd) > 0 else 0.0

    return {
        "ltd_values": ltd,
        "avg_ltd": avg_ltd,
        "p75_ltd": p75_ltd,
        "p90_ltd": p90_ltd,
        "p95_ltd": p95_ltd,
        "target_ltd": target_ltd,
        "prob_ltd_pos": prob_ltd_pos,
        "ss_target": math.ceil(max(0, target_ltd - avg_ltd)),
    }


def build_target_level(demands, params: Dict[str, Any]) -> Dict[str, Any]:
    demands = np.asarray(demands, dtype=float)
    dlt = max(int(params["dlt"]), 1)
    target_percentile = float(params.get("target_percentile", 0.95))
    if target_percentile > 1:
        target_percentile = target_percentile / 100.0
    target_percentile = min(max(target_percentile, 0.01), 0.999)

    ltd_stats = compute_ltd_stats(demands, dlt, target_percentile)
    target_level = math.ceil(ltd_stats["target_ltd"])
    return {
        "target_percentile": target_percentile,
        "target_level": float(target_level),
        "avg_ltd": float(ltd_stats["avg_ltd"]),
        "p75_ltd": float(ltd_stats["p75_ltd"]),
        "p90_ltd": float(ltd_stats["p90_ltd"]),
        "p95_ltd": float(ltd_stats["p95_ltd"]),
        "target_ltd": float(ltd_stats["target_ltd"]),
        "ss": float(ltd_stats["ss_target"]),
    }


def simulate_ddmrp_conditional(
    demands,
    dates,
    vf: float,
    ltf: float,
    dlt: int,
    pack_size: int,
    unit_price: float,
    hold_cost_per_unit_day: float,
    order_cost: float,
    penalty_mult: float,
    verbose: bool = False,
    forecast=None,
    target_level: Optional[float] = None,
    qmax: Optional[float] = None,
    initial_inventory: Optional[float] = None,
    moq: int = 0,
    target_percentile: float = 0.95,
    use_qd_next_for_trigger: bool = True,
    qd_source: str = "actual_demand",
    target_stock_basis: str = "ip",
) -> Dict[str, Any]:
    demands = np.asarray(demands, dtype=float)
    dates = pd.Series(dates).reset_index(drop=True)
    n = len(demands)
    dlt = int(dlt)
    moq = max(int(moq), 0)
    _ = pack_size, unit_price

    if forecast is None:
        forecast_arr = np.zeros(n)
    else:
        forecast_arr = np.asarray(forecast, dtype=float)
        if len(forecast_arr) < n:
            forecast_arr = np.pad(forecast_arr, (0, n - len(forecast_arr)), mode="constant")

    if initial_inventory is None or pd.isna(initial_inventory):
        raise ValueError("Initial Inventory wajib diisi.")

    adu = float(np.mean(demands)) if n > 0 else 0.0
    ost = adu
    bzr = adu * dlt * ltf
    tor = bzr * vf
    yellow = adu * dlt
    toy = tor + yellow
    green = max(bzr, moq)
    tog = toy + green

    ltd_stats = compute_ltd_stats(demands, dlt, target_percentile)
    if target_level is None:
        target_level = float(math.ceil(ltd_stats["target_ltd"]))
        ss_value: Optional[float] = float(ltd_stats["ss_target"])
    else:
        target_level = float(target_level)
        ss_value = None

    oh = float(initial_inventory)
    pipeline: Dict[Any, float] = {}
    rows = []

    def compute_qd_at(t_index: int) -> float:
        if t_index >= n:
            return 0.0
        qd_val = float(demands[t_index])
        if qd_source == "actual_demand":
            for kk in range(1, dlt + 1):
                j = t_index + kk
                if j < len(demands) and demands[j] > ost:
                    qd_val += float(demands[j])
        elif qd_source == "forecast":
            for kk in range(1, dlt + 1):
                j = t_index + kk
                if j < len(forecast_arr) and forecast_arr[j] > ost:
                    qd_val += float(forecast_arr[j])
        else:
            raise ValueError("qd_source harus 'actual_demand' atau 'forecast'.")
        return qd_val

    for t in range(n):
        date = pd.Timestamp(dates.iloc[t]).normalize()
        receipt = float(pipeline.pop(date, 0.0))
        oh += receipt
        op = sum(
            float(q)
            for d, q in pipeline.items()
            if 1 <= (pd.Timestamp(d).normalize() - date).days <= dlt
        )
        ip = oh + op
        qd = compute_qd_at(t)
        nfe = oh + op - qd
        zone = "RED" if nfe <= tor else ("YELLOW" if nfe <= toy else "GREEN")

        dem = float(demands[t])
        oh_before_demand = oh
        oh_after_preview = max(0.0, oh - min(dem, oh))

        if target_stock_basis == "ip":
            target_stock = ip
        elif target_stock_basis == "oh_before":
            target_stock = oh_before_demand
        elif target_stock_basis == "oh_after":
            target_stock = oh_after_preview
        else:
            raise ValueError("target_stock_basis harus 'ip', 'oh_before', atau 'oh_after'.")

        q = 0.0
        q_raw = 0.0
        q_raw_target = 0.0
        order_reason = "NO_TRIGGER"
        candidate_trigger = nfe <= toy and ip < target_level
        qd_for_trigger = compute_qd_at(t) if use_qd_next_for_trigger else qd
        qd_trigger = candidate_trigger and qd_for_trigger > 0

        if qd_trigger:
            q_raw_target = target_level - target_stock
            q_raw = max(0.0, q_raw_target)
            q = apply_moq_qmax(q_raw=q_raw, moq=moq, qmax=qmax, enforce_moq=True)
            if q > 0:
                order_reason = "CONDITIONAL_TARGET"
            else:
                order_reason = "NO_ORDER_TARGET_REACHED"

        if q > 0:
            arr = (date + pd.Timedelta(days=dlt)).normalize()
            pipeline[arr] = pipeline.get(arr, 0.0) + float(q)

        shipped = min(dem, oh)
        unmet = max(dem - shipped, 0.0)
        oh_end = oh - shipped
        oh = oh_end

        holding_cost = oh_end * hold_cost_per_unit_day
        order_cost_day = order_cost if q > 0 else 0.0
        penalty_cost = unmet * penalty_mult
        total_cost = holding_cost + order_cost_day + penalty_cost

        rows.append(
            {
                "date": date.date(),
                "method": "DDMRP_CONDITIONAL",
                "demand": round(dem, 2),
                "receipt": round(receipt, 2),
                "oh_end": round(oh_end, 2),
                "open_order": round(op, 2),
                "qualified_demand": round(qd, 2),
                "nfe": round(nfe, 2),
                "zone": zone,
                "order_qty": int(q),
                "shipped": round(shipped, 2),
                "unmet": round(unmet, 2),
                "holding_cost": round(holding_cost, 2),
                "order_cost": round(order_cost_day, 2),
                "penalty_cost": round(penalty_cost, 2),
                "total_cost": round(total_cost, 2),
                "TOR": round(tor, 2),
                "TOY": round(toy, 2),
                "TOG": round(tog, 2),
                "target_level": round(target_level, 2),
                "order_reason": order_reason,
            }
        )

    df = pd.DataFrame(rows)
    td = float(df["demand"].sum())
    ts = float(df["shipped"].sum())
    ns = int((df["unmet"] > 1e-6).sum())

    kpi: Dict[str, Any] = {
        "method": "DDMRP_CONDITIONAL",
        "vf": round(vf, 4),
        "ltf": round(ltf, 4),
        "adu": round(adu, 4),
        "bzr": round(bzr, 2),
        "tor": round(tor, 2),
        "yellow": round(yellow, 2),
        "green": round(green, 2),
        "toy": round(toy, 2),
        "tog": round(tog, 2),
        "avg_ltd": round(ltd_stats["avg_ltd"], 4),
        "p95_ltd": round(ltd_stats["p95_ltd"], 4),
        "target_ltd": round(ltd_stats["target_ltd"], 4),
        "target_percentile": target_percentile,
        "target_level": round(target_level, 4),
        "ss": ss_value,
        "initial_inventory": round(float(initial_inventory), 4),
        "qd_source": qd_source,
        "fill_rate": round(ts / td, 4) if td > 0 else 1.0,
        "csl": round(1 - ns / n, 4) if n > 0 else 1.0,
        "n_stockout": ns,
        "total_cost": round(float(df["total_cost"].sum()), 0),
        "hold_cost": round(float(df["holding_cost"].sum()), 0),
        "order_cost": round(float(df["order_cost"].sum()), 0),
        "penalty_cost": round(float(df["penalty_cost"].sum()), 0),
        "n_orders": int((df["order_qty"] > 0).sum()),
        "total_order_qty": int(df["order_qty"].sum()),
        "avg_oh": round(float(df["oh_end"].mean()), 2),
        "df_detail": df,
    }

    if verbose:
        print(f"CONDITIONAL fill_rate={kpi['fill_rate']:.2%} target_level={target_level}")

    return kpi
