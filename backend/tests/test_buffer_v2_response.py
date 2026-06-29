"""Buffer v2 response builder tests."""
from __future__ import annotations

import os
import sys
import unittest
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND))
os.chdir(BACKEND)

from services.buffer_v2.response import (  # noqa: E402
    build_simulation_summary,
    build_simulation_summary_text,
    build_v2_notebook_json,
)


class TestBufferV2Response(unittest.TestCase):
    def _sample_optimize(self) -> dict:
        return {
            "api_version": "v2",
            "unit": "EA",
            "classification": {"category": "INTERMITTENT", "method": "DDMRP_CONDITIONAL"},
            "optimization": {"vf_opt": 0.475, "ltf_opt": 0.3},
            "simulation": {"qd_source": "actual_demand", "target_percentile": 0.98},
            "optimized": {
                "method": "DDMRP_CONDITIONAL",
                "kpi": {
                    "method": "DDMRP_CONDITIONAL",
                    "initial_inventory": 2.0,
                    "adu": 0.0132,
                    "tor": 0.09,
                    "toy": 0.71,
                    "tog": 1.71,
                    "fill_rate": 1.0,
                    "csl": 1.0,
                    "n_stockout": 0,
                    "n_orders": 3,
                    "total_order_qty": 3,
                    "total_cost": 3682598,
                    "target_percentile": 0.98,
                    "target_level": 2.0,
                    "ss": None,
                },
            },
            "daily_simulation": [{"date": "2025-01-01", "demand": 0.0, "nfe": 1.0}],
            "daily_simulation_csv": "date,demand\n2025-01-01,0.0\n",
        }

    def test_simulation_summary_notebook_labels(self):
        summary = build_simulation_summary(self._sample_optimize())
        self.assertEqual(summary["Method"], "DDMRP_CONDITIONAL")
        self.assertEqual(summary["VF"], "0.4750")
        self.assertEqual(summary["LTF"], "0.3000")
        self.assertEqual(summary["Initial Inventory"], "2.0")
        self.assertEqual(summary["ADU"], "0.0132")
        self.assertEqual(summary["TOR"], "0.09")
        self.assertEqual(summary["TOY"], "0.71")
        self.assertEqual(summary["TOG"], "1.71")
        self.assertEqual(summary["Target Percentile"], "0.98")
        self.assertEqual(summary["Target Level"], "2.00")
        self.assertIsNone(summary["Safety Stock"])
        self.assertEqual(summary["Fill Rate"], "100.00%")
        self.assertEqual(summary["CSL"], "100.00%")
        self.assertEqual(summary["Stockout Days"], 0)
        self.assertEqual(summary["Jumlah Order"], 3)
        self.assertEqual(summary["Total Qty Order"], 3)
        self.assertEqual(summary["Total Cost"], "Rp3,682,598")

    def test_simulation_summary_text_matches_notebook(self):
        summary = build_simulation_summary(self._sample_optimize())
        text = build_simulation_summary_text(summary)
        self.assertIn("Method : DDMRP_CONDITIONAL", text)
        self.assertIn("VF     : 0.4750", text)
        self.assertIn("Total Cost        = Rp3,682,598", text)

    def test_notebook_json_shape(self):
        out = build_v2_notebook_json("100008503", self._sample_optimize(), buffer_id=1, latest_run_id=2)
        self.assertEqual(out["sku_no"], "100008503")
        self.assertEqual(out["api_version"], "v2")
        self.assertEqual(out["simulation_summary"]["Total Cost"], "Rp3,682,598")
        self.assertIn("simulation_summary_text", out)
        self.assertIn("daily_simulation", out)
        self.assertNotIn("daily_simulation_csv", out)
        self.assertNotIn("classification", out)
        self.assertNotIn("optimize", out)


if __name__ == "__main__":
    unittest.main()
