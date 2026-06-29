"""Buffer v2 — synthetic + Data 2 June integration tests."""
from __future__ import annotations

import os
import sys
import unittest
from pathlib import Path
from typing import Any, Dict, Optional

import numpy as np
import pandas as pd

BACKEND = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND))
os.chdir(BACKEND)


def _resolve_june_paths() -> tuple[Path, Path]:
    """Locate Data 2 June files (local repo or Docker /app/resources_ext)."""
    candidates = [
        BACKEND / "resources_ext",
        BACKEND.parent / "resources_ext",
    ]
    for base in candidates:
        xlsx = base / "Data 2 June.xlsx"
        csv = base / "Data 2 June.csv"
        if xlsx.is_file() and csv.is_file():
            return xlsx, csv
    # fallback paths for skip messages
    return candidates[0] / "Data 2 June.xlsx", candidates[0] / "Data 2 June.csv"


JUNE_XLSX, JUNE_CSV = _resolve_june_paths()

from services.buffer_v2.classification import classify_sku_v2  # noqa: E402
from services.buffer_v2.pipeline import run_buffer_optimization_v2  # noqa: E402
from services.buffer_v2.selected_method import simulate_selected_method  # noqa: E402
from services.data_loader import get_sku_demand, get_sku_params  # noqa: E402
from services.master_upload_parse import (  # noqa: E402
    _coerce_master_sku_upload,
    read_master_upload_dataframe,
)


def _params_base() -> Dict[str, Any]:
    return {
        "sku": "TEST",
        "group": "Spare Part",
        "dlt": 7,
        "moq": 1,
        "pack_size": 1,
        "price_ea": 100.0,
        "hold_cost_per_unit_day": 0.5,
        "order_cost": 50.0,
        "penalty_per_unit": 30.0,
        "initial_inventory": 10.0,
        "qmax": None,
        "target_percentile": 0.95,
    }


def _load_data2_june_xlsx() -> Dict[str, pd.DataFrame]:
    if not JUNE_XLSX.is_file():
        raise FileNotFoundError(f"Data 2 June workbook not found: {JUNE_XLSX}")
    df_s = pd.read_excel(JUNE_XLSX, sheet_name="sales")
    df_m = pd.read_excel(JUNE_XLSX, sheet_name="sku_master")
    df_s["Date"] = pd.to_datetime(df_s["Date"])
    df_s["Demand "] = pd.to_numeric(df_s["Demand "], errors="coerce").fillna(0)
    if "Promo Discount" in df_s.columns:
        df_s["Promo Discount"] = pd.to_numeric(df_s["Promo Discount"], errors="coerce").fillna(0)
        df_s["IsPromo"] = df_s["Promo Discount"] > 0
        df_s["PromoType"] = "NONE"
        df_s["PromoDiscountPct"] = df_s["Promo Discount"]
    return {"sales": df_s, "master": df_m, "carton_mapping": {}}


def _load_data2_june_csv_master() -> pd.DataFrame:
    if not JUNE_CSV.is_file():
        raise FileNotFoundError(f"Data 2 June CSV not found: {JUNE_CSV}")
    return _coerce_master_sku_upload(read_master_upload_dataframe(str(JUNE_CSV)))


class TestBufferV2Synthetic(unittest.TestCase):
    def test_smooth_routes_ddmrp(self):
        n = 60
        demands = np.random.default_rng(1).integers(5, 15, size=n).astype(float)
        df = pd.DataFrame({"Date": pd.date_range("2025-01-01", periods=n), "Demand": demands})
        clf = classify_sku_v2(df, _params_base())
        self.assertEqual(clf["category"], "SMOOTH")
        self.assertEqual(clf["method"], "DDMRP")

    def test_intermittent_routes_conditional(self):
        demands = np.array([0.0] * 50 + [20.0] * 5 + [0.0] * 45)
        df = pd.DataFrame({"Date": pd.date_range("2025-01-01", periods=len(demands)), "Demand": demands})
        clf = classify_sku_v2(df, _params_base())
        self.assertEqual(clf["method"], "DDMRP_CONDITIONAL")

    def test_simulate_selected_method_runs(self):
        demands = np.array([2.0, 3.0, 1.0, 4.0, 2.0] * 20)
        dates = pd.date_range("2025-01-01", periods=len(demands))
        df = pd.DataFrame({"Date": dates, "Demand": demands})
        params = _params_base()
        clf = classify_sku_v2(df, params)
        kpi = simulate_selected_method(demands, dates, params, clf, verbose=False)
        self.assertIn("fill_rate", kpi)
        self.assertEqual(kpi["qd_source"], "actual_demand")
        self.assertIn("tor", kpi)


class TestBufferV2Data2June(unittest.TestCase):
    """Integration tests against resources_ext/Data 2 June.csv + .xlsx."""

    @classmethod
    def setUpClass(cls) -> None:
        if not JUNE_XLSX.is_file():
            raise unittest.SkipTest(f"Missing {JUNE_XLSX}")
        if not JUNE_CSV.is_file():
            raise unittest.SkipTest(f"Missing {JUNE_CSV}")
        cls.data = _load_data2_june_xlsx()
        cls.master_csv = _load_data2_june_csv_master()

    def test_csv_master_45_rows_with_initial_inventory(self):
        self.assertEqual(len(self.master_csv), 45)
        for _, row in self.master_csv.iterrows():
            self.assertIsNotNone(row.get("initial_inventory"))
            self.assertGreaterEqual(float(row["initial_inventory"]), 0)
            self.assertIsNotNone(row.get("target_percentile"))
            self.assertGreater(row["target_percentile"], 0)
            self.assertLessEqual(row["target_percentile"], 1.0)

    def test_xlsx_master_matches_csv_sku_set(self):
        xlsx_skus = set(self.data["master"]["Material Number"].astype(str))
        csv_skus = set(self.master_csv["sku"].astype(str))
        self.assertEqual(xlsx_skus, csv_skus)
        self.assertEqual(len(xlsx_skus), 45)

    def test_june_master_params_include_buffer_v2_fields(self):
        sku = "100008503"
        params = get_sku_params(self.data, sku)
        self.assertEqual(params["initial_inventory"], 2.0)
        self.assertEqual(params["qmax"], 1)
        self.assertAlmostEqual(params["target_percentile"], 0.98)

    def test_june_classification_representative_skus(self):
        cases = [
            ("100006303", "SMOOTH", "DDMRP"),
            ("100008503", "INTERMITTENT", "DDMRP_CONDITIONAL"),
            ("100005106", "LUMPY", "DDMRP_CONDITIONAL"),
        ]
        for sku, exp_cat, exp_method in cases:
            with self.subTest(sku=sku):
                df = get_sku_demand(self.data, sku)
                params = get_sku_params(self.data, sku)
                clf = classify_sku_v2(df, params)
                self.assertEqual(clf["category"], exp_cat)
                self.assertEqual(clf["method"], exp_method)
                self.assertIsNotNone(clf.get("initial_inventory"))

    def _run_pipeline(self, sku: str, expected_method: str) -> Dict[str, Any]:
        out = run_buffer_optimization_v2(
            self.data,
            sku,
            sl_target=0.95,
            pop_size=8,
            n_gen=4,
            include_baseline=True,
            return_detail=False,
        )
        self.assertEqual(out["api_version"], "v2")
        self.assertEqual(out["classification"]["method"], expected_method)
        self.assertIn("vf_opt", out["optimization"])
        self.assertNotIn("fv_opt", out.get("optimized", {}))
        self.assertEqual(out["simulation"]["qd_source"], "actual_demand")
        self.assertIn("tor", out["optimized"]["kpi"])
        self.assertIn("toy", out["optimized"]["kpi"])
        self.assertIn("tog", out["optimized"]["kpi"])
        return out

    def test_june_pipeline_smooth(self):
        out = self._run_pipeline("100006303", "DDMRP")
        self.assertEqual(out["optimized"]["method"], "DDMRP")
        self.assertNotIn("target_level", out["simulation"])

    def test_june_pipeline_daily_simulation_export(self):
        out = run_buffer_optimization_v2(
            self.data,
            "100008503",
            sl_target=0.95,
            pop_size=8,
            n_gen=4,
            include_baseline=True,
            return_detail=True,
        )
        self.assertIn("daily_simulation", out)
        self.assertIn("daily_simulation_csv", out)
        self.assertGreater(len(out["daily_simulation"]), 0)
        csv_text = out["daily_simulation_csv"]
        self.assertTrue(csv_text.startswith("date,"))
        self.assertIn("nfe", csv_text)
        self.assertIn("order_qty", csv_text)
        first = out["daily_simulation"][0]
        self.assertIn("date", first)
        self.assertIn("demand", first)
        self.assertIn("zone", first)

    def test_june_pipeline_intermittent(self):
        out = self._run_pipeline("100008503", "DDMRP_CONDITIONAL")
        self.assertEqual(out["optimized"]["method"], "DDMRP_CONDITIONAL")
        self.assertIn("target_level", out["simulation"])
        self.assertAlmostEqual(out["simulation"]["target_percentile"], 0.98)

    def test_june_pipeline_lumpy(self):
        out = self._run_pipeline("100005106", "DDMRP_CONDITIONAL")
        self.assertEqual(out["classification"]["category"], "LUMPY")


if __name__ == "__main__":
    unittest.main()
