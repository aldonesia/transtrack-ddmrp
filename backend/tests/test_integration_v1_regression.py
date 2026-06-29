"""Regression tests — integration API v1 unchanged after buffer v2 rollout."""
from __future__ import annotations

import os
import sys
import unittest
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND))
os.chdir(BACKEND)

try:
    from fastapi.testclient import TestClient  # noqa: E402
except ImportError:
    TestClient = None  # type: ignore

from services.hybrid_pipeline import run_buffer_optimization  # noqa: E402
from tests.test_buffer_v2 import _load_data2_june_xlsx, _resolve_june_paths  # noqa: E402

V1_RUN_BODY = {
    "sku_no": "100008503",
    "sl_target": 0.95,
    "pop_size": 8,
    "n_gen": 5,
    "include_baseline": True,
}


class TestV1PipelineRegression(unittest.TestCase):
    """v1 engine output shape (hybrid_pipeline) — contract frozen for ERP."""

    @classmethod
    def setUpClass(cls) -> None:
        if not _resolve_june_paths()[0].is_file():
            raise unittest.SkipTest("Data 2 June workbook not found")
        cls.data = _load_data2_june_xlsx()

    def test_v1_optimized_has_fv_opt_not_vf_opt(self):
        out = run_buffer_optimization(
            self.data,
            "100008503",
            pop_size=8,
            n_gen=5,
            include_baseline=True,
            return_detail=False,
        )
        optimized = out.get("optimized") or {}
        self.assertIn("fv_opt", optimized)
        self.assertIn("ltf_opt", optimized)
        self.assertNotIn("vf_opt", optimized)
        self.assertIn("kpi", optimized)
        kpi = optimized["kpi"]
        for key in ("tor", "toy", "tog", "fill_rate", "total_cost"):
            self.assertIn(key, kpi)

    def test_v1_classification_no_method_field(self):
        out = run_buffer_optimization(self.data, "100008503", pop_size=8, n_gen=5)
        clf = out.get("classification") or {}
        self.assertIn("category", clf)
        self.assertNotIn("method", clf)
        self.assertNotIn("api_version", out)

    def test_v1_no_simulation_summary_fields(self):
        out = run_buffer_optimization(self.data, "100006303", pop_size=8, n_gen=5)
        self.assertNotIn("simulation_summary", out)
        self.assertNotIn("daily_simulation", out)
        self.assertNotIn("daily_simulation_csv", out)
        self.assertNotIn("optimization", out)


class TestIntegrationV1Api(unittest.TestCase):
    """HTTP smoke — POST /integration/run response contract."""

    @classmethod
    def setUpClass(cls) -> None:
        if TestClient is None:
            raise unittest.SkipTest("httpx not installed")
        from main import app  # noqa: WPS433

        cls.client = TestClient(app)

    def test_v1_run_response_contract(self):
        r = self.client.post("/api/analytics/integration/run", json=V1_RUN_BODY)
        if r.status_code == 404:
            self.skipTest(f"SKU or demand not in DB: {r.json()}")
        self.assertEqual(r.status_code, 200, r.text)
        body = r.json()
        self.assertEqual(body["status"], "ok")
        self.assertEqual(body["sku_no"], V1_RUN_BODY["sku_no"])
        self.assertIn("buffer_id", body)
        self.assertIn("latest_run_id", body)
        self.assertIn("forecast", body)
        self.assertIn("optimize", body)
        self.assertNotIn("api_version", body)
        self.assertNotIn("simulation_summary", body)

        optimize = body["optimize"]
        self.assertNotEqual(optimize.get("api_version"), "v2")
        optimized = optimize.get("optimized") or {}
        self.assertIn("fv_opt", optimized)
        self.assertIn("predictions", body.get("forecast", {}))

    def test_v1_result_endpoint(self):
        sku = V1_RUN_BODY["sku_no"]
        r = self.client.get(f"/api/analytics/integration/result?sku_no={sku}")
        self.assertEqual(r.status_code, 200)
        body = r.json()
        self.assertEqual(body["status"], "ok")
        self.assertIn("latest_run", body)
        if body["latest_run"]:
            self.assertIn("forecast", body["latest_run"])
            self.assertIn("optimize", body["latest_run"])

    def test_v1_replenishment_after_run(self):
        sku = V1_RUN_BODY["sku_no"]
        r = self.client.get(f"/api/analytics/integration/replenishment?sku_no={sku}")
        if r.status_code == 404:
            self.skipTest("No active buffer — run v1 first in DB")
        self.assertEqual(r.status_code, 200)
        body = r.json()
        self.assertEqual(body["status"], "ok")
        self.assertIn("tor", body)
        self.assertIn("recommendations", body)
        version = str(body.get("version") or "")
        self.assertFalse(version.startswith("v2-"), "v1 replenishment must not return v2 buffer")


if __name__ == "__main__":
    unittest.main()
