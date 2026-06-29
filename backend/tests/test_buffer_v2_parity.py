"""Parity tests — buffer v2 vs notebook (Data 2 June, GA seed=42)."""
from __future__ import annotations

import os
import sys
import unittest
from pathlib import Path
from typing import Any, Dict

BACKEND = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND))
os.chdir(BACKEND)

from services.buffer_v2.pipeline import run_buffer_optimization_v2  # noqa: E402
from services.buffer_v2.response import build_simulation_summary  # noqa: E402
from tests.test_buffer_v2 import _load_data2_june_xlsx, _resolve_june_paths  # noqa: E402

# Golden values: pipeline pop_size=30, n_gen=80, random_state=42 (ga_optimizer).
# SKU 100008503 matches notebook stdout (Hybrid_DDMRP_with_Optimasi_Buffer_Via_GA.ipynb).
PARITY_GOLDEN: Dict[str, Dict[str, Any]] = {
    "100006303": {
        "category": "SMOOTH",
        "method": "DDMRP",
        "tor": 0.73,
        "toy": 54.94,
        "tog": 127.98,
    },
    "100008503": {
        "category": "INTERMITTENT",
        "method": "DDMRP_CONDITIONAL",
        "vf_opt": 0.475,
        "ltf_opt": 0.3,
        "tor": 0.09,
        "toy": 0.71,
        "tog": 1.71,
        "total_cost": 3682598,
        "fill_rate": 1.0,
        "summary_total_cost": "Rp3,682,598",
    },
    "100005106": {
        "category": "LUMPY",
        "method": "DDMRP_CONDITIONAL",
        "tor": 0.03,
        "toy": 3.83,
        "tog": 7.83,
    },
}

TOLERANCE_REL = 0.01  # 1%


def _rel_err(actual: float, expected: float) -> float:
    if expected == 0:
        return abs(actual - expected)
    return abs(actual - expected) / abs(expected)


class TestBufferV2Parity(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        if not _resolve_june_paths()[0].is_file():
            raise unittest.SkipTest("Data 2 June workbook not found")
        cls.data = _load_data2_june_xlsx()

    def _run(self, sku: str) -> dict:
        return run_buffer_optimization_v2(
            self.data,
            sku,
            sl_target=0.95,
            pop_size=30,
            n_gen=80,
            include_baseline=True,
            return_detail=True,
        )

    def test_tor_toy_tog_within_tolerance_all_skus(self):
        for sku, golden in PARITY_GOLDEN.items():
            with self.subTest(sku=sku):
                out = self._run(sku)
                kpi = out["optimized"]["kpi"]
                self.assertEqual(out["classification"]["category"], golden["category"])
                self.assertEqual(out["classification"]["method"], golden["method"])
                for key in ("tor", "toy", "tog"):
                    self.assertLessEqual(
                        _rel_err(float(kpi[key]), float(golden[key])),
                        TOLERANCE_REL,
                        msg=f"{sku} {key}: {kpi[key]} vs {golden[key]}",
                    )

    def test_intermittent_notebook_summary_100008503(self):
        sku = "100008503"
        golden = PARITY_GOLDEN[sku]
        out = self._run(sku)
        opt = out["optimization"]
        kpi = out["optimized"]["kpi"]
        summary = build_simulation_summary(out)

        self.assertAlmostEqual(opt["vf_opt"], golden["vf_opt"], places=4)
        self.assertAlmostEqual(opt["ltf_opt"], golden["ltf_opt"], places=4)
        self.assertAlmostEqual(kpi["fill_rate"], golden["fill_rate"], places=4)
        self.assertEqual(int(kpi["total_cost"]), golden["total_cost"])
        self.assertEqual(summary["Total Cost"], golden["summary_total_cost"])
        self.assertEqual(summary["Method"], "DDMRP_CONDITIONAL")
        self.assertEqual(summary["VF"], "0.4750")
        self.assertEqual(summary["LTF"], "0.3000")
        self.assertGreater(len(out["daily_simulation"]), 0)
        first = out["daily_simulation"][0]
        self.assertIn("date", first)
        self.assertIn("nfe", first)


if __name__ == "__main__":
    unittest.main()
