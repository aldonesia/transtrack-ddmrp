"""ADI–CV² classification with simulation method routing."""
from __future__ import annotations

from typing import Any, Dict

import numpy as np
import pandas as pd

from services.buffer_v2.common import ADI_THRESHOLD, CV2_THRESHOLD, LTF_SPACE, VF_SPACE


def classify_sku_v2(
    df_demand: pd.DataFrame,
    params: Dict[str, Any],
    verbose: bool = False,
) -> Dict[str, Any]:
    s = df_demand["Demand"].values.astype(float)
    nz = s[s > 0]
    n = len(s)
    k = len(nz)
    adu = float(np.mean(s)) if n > 0 else 0.0

    if k == 0:
        adi = float("inf")
        cv2 = 0.0
        cv2_all = 0.0
        cat = "INTERMITTENT"
    else:
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

    method = "DDMRP" if cat in ("SMOOTH", "ERRATIC") else "DDMRP_CONDITIONAL"

    dlt = int(params["dlt"])
    lt_cat = "SHORT" if dlt <= 10 else ("MEDIUM" if dlt <= 25 else "LONG")
    vf_lo, vf_hi = VF_SPACE.get(cat, (0.10, 1.00))
    ltf_lo, ltf_hi = LTF_SPACE.get(lt_cat, (0.41, 0.60))
    vf_init = (vf_lo + vf_hi) / 2
    ltf_init = (ltf_lo + ltf_hi) / 2

    result: Dict[str, Any] = {
        "sku": params["sku"],
        "group": params.get("group"),
        "dlt": dlt,
        "lt_category": lt_cat,
        "adu": round(adu, 2),
        "n_days": n,
        "n_nonzero": int(k),
        "n_zero": int((s == 0).sum()),
        "adi": round(adi, 4) if np.isfinite(adi) else float("inf"),
        "cv2": round(cv2, 4),
        "cv2_all": round(cv2_all, 4),
        "category": cat,
        "method": method,
        "qmax": params.get("qmax"),
        "target_percentile": params.get("target_percentile", 0.95),
        "initial_inventory": params.get("initial_inventory"),
        "vf_low": vf_lo,
        "vf_high": vf_hi,
        "ltf_low": ltf_lo,
        "ltf_high": ltf_hi,
        "vf_init": round(vf_init, 4),
        "ltf_init": round(ltf_init, 4),
    }

    if verbose:
        print(f"  KLASIFIKASI SKU {params['sku']} | ADI={adi:.4f} CV²={cv2:.4f} → {cat} | method={method}")

    return result
