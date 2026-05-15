"""
DDMRP simulator + genetic buffer optimization from DDMRP_Hybrid_Algorithm.ipynb.
"""
from __future__ import annotations

import math
from typing import Any, Callable, Dict, Tuple

import numpy as np
import pandas as pd

ADI_THRESHOLD = 1.32
CV2_THRESHOLD = 0.49

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


def classify_sku(df_demand: pd.DataFrame, params: Dict[str, Any], verbose: bool = False):
    s = df_demand["Demand"].values.astype(float)
    nz = s[s > 0]
    n = len(s)
    k = len(nz)
    adu = float(np.mean(s))

    if k == 0:
        return {}

    adi = n / k
    mean_nz = np.mean(nz)
    cv2 = float((np.std(nz, ddof=1) / mean_nz) ** 2) if k > 1 and mean_nz > 0 else 0.0
    cv2_all = float((np.std(s, ddof=1) / adu) ** 2) if adu > 0 else 0.0

    if adi <= ADI_THRESHOLD and cv2 <= CV2_THRESHOLD:
        cat = "SMOOTH"
    elif adi <= ADI_THRESHOLD and cv2 > CV2_THRESHOLD:
        cat = "ERRATIC"
    elif adi > ADI_THRESHOLD and cv2 <= CV2_THRESHOLD:
        cat = "INTERMITTENT"
    else:
        cat = "LUMPY"

    dlt = params["dlt"]
    lt_cat = "SHORT" if dlt <= 10 else ("MEDIUM" if dlt <= 25 else "LONG")
    vf_lo, vf_hi = VF_SPACE.get(cat, (0.10, 1.00))
    ltf_lo, ltf_hi = LTF_SPACE.get(lt_cat, (0.41, 0.60))
    vf_init = (vf_lo + vf_hi) / 2
    ltf_init = (ltf_lo + ltf_hi) / 2

    bzr = adu * dlt * ltf_init
    tor = bzr * vf_init
    toy = tor + adu * dlt
    _hc = float(params.get("hold_cost_per_unit_day") or 0)
    _oc = float(params.get("order_cost") or 0)
    moq = int(params.get("moq") or params.get("moq_each") or 1)
    doc = math.sqrt(2 * _oc * adu / _hc) if _hc > 0 and adu > 0 else 0.0
    dbo = round(doc / adu, 1) if adu > 0 else 0.0
    tog = toy + max(bzr, doc, moq)

    result = {
        "sku": params["sku"],
        "group": params["group"],
        "dlt": dlt,
        "lt_category": lt_cat,
        "adu": round(adu, 2),
        "n_days": n,
        "n_zero": int((s == 0).sum()),
        "adi": round(adi, 4),
        "cv2": round(cv2, 4),
        "cv2_all": round(cv2_all, 4),
        "category": cat,
        "vf_low": vf_lo,
        "vf_high": vf_hi,
        "ltf_low": ltf_lo,
        "ltf_high": ltf_hi,
        "vf_init": round(vf_init, 4),
        "ltf_init": round(ltf_init, 4),
        "bzr": round(bzr, 1),
        "doc": round(doc, 2),
        "dbo": dbo,
        "moq": moq,
        "tor": round(tor, 1),
        "toy": round(toy, 1),
        "tog": round(tog, 1),
    }

    if verbose:
        print(
            f"  KLASIFIKASI SKU {params['sku']} | ADI={adi:.4f} CV²={cv2:.4f} → {cat}"
        )
    return result


def simulate_ddmrp(
    demands,
    forecast,
    dates,
    vf,
    ltf,
    dlt,
    pack_size,
    unit_price,
    hold_cost_per_unit_day,
    order_cost,
    penalty_mult,
    lt_std: float = 0.0,
    verbose: bool = False,
):
    n = len(demands)
    adu = float(np.mean(demands))
    ost = adu

    bzr = adu * dlt * ltf
    tor = bzr * vf
    toy = tor + adu * dlt
    tog = toy + max(bzr, pack_size)

    oh = toy
    pipeline = {}
    rows = []

    for t in range(n):
        date = pd.Timestamp(dates.iloc[t]).normalize()
        receipt = float(pipeline.pop(date, 0.0))
        oh += receipt

        op = sum(
            float(q)
            for d, q in pipeline.items()
            if 1 <= (pd.Timestamp(d).normalize() - date).days <= dlt
        )

        qd = float(demands[t])
        for k in range(1, dlt + 1):
            j = t + k
            if j < len(forecast) and forecast[j] > ost:
                qd += forecast[j]

        nfe = oh + op - qd
        zone = "RED" if nfe <= tor else ("YELLOW" if nfe <= toy else "GREEN")

        q = 0
        if nfe <= toy:
            q = int(max((tog - nfe, pack_size)))

        if q > 0:
            lt_actual = max(1, int(round(np.random.normal(dlt, lt_std)))) if lt_std > 0 else dlt
            arr = (date + pd.Timedelta(days=lt_actual)).normalize()
            pipeline[arr] = pipeline.get(arr, 0.0) + float(q)

        dem = float(demands[t])
        shipped = min(dem, oh)
        unmet = max(dem - shipped, 0.0)
        oh -= shipped

        rows.append(
            {
                "date": date.date(),
                "demand": round(dem, 2),
                "forecast": round(float(forecast[t]) if t < len(forecast) else 0, 2),
                "receipt": round(receipt, 2),
                "OH_end": round(oh, 2),
                "OP": round(op, 2),
                "QD": round(qd, 2),
                "NFE": round(nfe, 2),
                "zone": zone,
                "order_qty": int(q),
                "shipped": round(shipped, 2),
                "unmet": round(unmet, 2),
                "holding_cost": round(oh * hold_cost_per_unit_day, 2),
                "order_cost": round(order_cost if q > 0 else 0, 2),
                "penalty_cost": round(unmet * penalty_mult, 2),
                "total_cost": round(
                    oh * hold_cost_per_unit_day
                    + (order_cost if q > 0 else 0)
                    + unmet * penalty_mult,
                    2,
                ),
            }
        )

    df = pd.DataFrame(rows)
    td = float(df["demand"].sum())
    ts = float(df["shipped"].sum())
    ns = int((df["unmet"] > 1e-6).sum())
    kpi = {
        "vf": round(vf, 4),
        "ltf": round(ltf, 4),
        "bzr": round(bzr, 1),
        "tor": round(tor, 1),
        "toy": round(toy, 1),
        "tog": round(tog, 1),
        "fill_rate": round(ts / td, 4) if td > 0 else 1.0,
        "csl": round(1 - ns / n, 4),
        "n_stockout": ns,
        "total_cost": round(float(df["total_cost"].sum()), 0),
        "hold_cost": round(float(df["holding_cost"].sum()), 0),
        "order_cost": round(float(df["order_cost"].sum()), 0),
        "penalty_cost": round(float(df["penalty_cost"].sum()), 0),
        "n_orders": int((df["order_qty"] > 0).sum()),
        "avg_oh": round(float(df["OH_end"].mean()), 1),
        "df_detail": df,
    }
    if verbose:
        print(
            f"  VF={vf:.3f} LTF={ltf:.3f} | FR={kpi['fill_rate']*100:.2f}% | "
            f"Cost=Rp{kpi['total_cost']/1e6:.1f}jt | Stockout={ns}hr"
        )
    return kpi


class GeneticOptimizer:
    def __init__(
        self,
        vf_bounds: Tuple[float, float],
        ltf_bounds: Tuple[float, float],
        sl_target: float = 0.95,
        pop_size: int = 30,
        n_gen: int = 40,
        verbose: bool = True,
    ):
        self.vf_b = vf_bounds
        self.ltf_b = ltf_bounds
        self.sl = sl_target
        self.ps = pop_size
        self.ng = n_gen
        self.verbose = verbose
        self.best = None
        self.best_fit = -np.inf
        self.history = []

    def _rand(self):
        return np.array(
            [np.random.uniform(*self.vf_b), np.random.uniform(*self.ltf_b)]
        )

    def _fit(self, ind, sim_fn):
        kpi = sim_fn(vf=ind[0], ltf=ind[1])
        cost = kpi["total_cost"]
        sl = kpi["fill_rate"]
        pen = cost * (self.sl - sl) * 100 * 0.5 if sl < self.sl else 0
        return -(cost + pen)

    def run(self, sim_fn: Callable, vf_init: float, ltf_init: float):
        pop = (
            [
                np.array(
                    [
                        np.clip(np.random.normal(vf_init, 0.05), *self.vf_b),
                        np.clip(np.random.normal(ltf_init, 0.05), *self.ltf_b),
                    ]
                )
                for _ in range(self.ps // 3)
            ]
            + [self._rand() for _ in range(self.ps - self.ps // 3)]
        )
        for gen in range(self.ng):
            scores = [self._fit(ind, sim_fn) for ind in pop]
            bi = int(np.argmax(scores))
            if scores[bi] > self.best_fit:
                self.best_fit = scores[bi]
                self.best = pop[bi].copy()
            self.history.append(
                {
                    "generation": gen + 1,
                    "best_fitness": self.best_fit,
                    "avg_fitness": float(np.mean(scores)),
                    "best_vf": self.best[0],
                    "best_ltf": self.best[1],
                }
            )
            if self.verbose and (gen % 10 == 0 or gen == self.ng - 1):
                kpi = sim_fn(vf=self.best[0], ltf=self.best[1])
                print(
                    f"    Gen {gen+1:3d} | VF={self.best[0]:.3f} LTF={self.best[1]:.3f} | "
                    f"FR={kpi['fill_rate']*100:.1f}% Cost=Rp{kpi['total_cost']/1e6:.1f}jt"
                )
            idx = np.argsort(scores)[::-1]
            parents = [pop[i].copy() for i in idx[: self.ps // 2]]
            new_pop = parents[: max(2, int(self.ps * 0.2))]
            sigma = 0.05 * (1 - gen / self.ng) + 0.01
            while len(new_pop) < self.ps:
                p1 = parents[np.random.randint(len(parents))]
                p2 = parents[np.random.randint(len(parents))]
                c = np.where(np.random.rand(2) < 0.5, p1, p2)
                if np.random.rand() < 0.3:
                    c[0] = np.clip(c[0] + np.random.normal(0, sigma), *self.vf_b)
                if np.random.rand() < 0.3:
                    c[1] = np.clip(c[1] + np.random.normal(0, sigma), *self.ltf_b)
                new_pop.append(c)
            pop = new_pop[: self.ps]

        return {
            "vf_opt": round(float(self.best[0]), 4),
            "ltf_opt": round(float(self.best[1]), 4),
            "kpi": sim_fn(vf=self.best[0], ltf=self.best[1]),
            "history": pd.DataFrame(self.history),
        }
