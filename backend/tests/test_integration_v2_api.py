"""Integration API v2 endpoint smoke (requires DB with demand + master)."""
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

from main import app  # noqa: E402


class TestIntegrationV2Api(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        if TestClient is None:
            raise unittest.SkipTest("httpx not installed — use curl smoke test instead")
        cls.client = TestClient(app)

    def test_v2_result_missing_sku_no(self):
        r = self.client.get("/api/analytics/integration/v2/result")
        self.assertEqual(r.status_code, 400)

    def test_v2_replenishment_missing_sku_no(self):
        r = self.client.get("/api/analytics/integration/v2/replenishment")
        self.assertEqual(r.status_code, 400)

    def test_v2_run_and_result_smoke(self):
        sku = "100008503"
        r = self.client.post(
            "/api/analytics/integration/v2/run",
            json={
                "sku_no": sku,
                "sl_target": 0.95,
                "pop_size": 8,
                "n_gen": 5,
                "include_baseline": True,
            },
        )
        if r.status_code == 404:
            self.skipTest(f"SKU {sku} or demand not in DB: {r.json()}")
        self.assertEqual(r.status_code, 200, r.text)
        body = r.json()
        self.assertEqual(body["status"], "ok")
        self.assertEqual(body["api_version"], "v2")
        self.assertIn("simulation_summary", body)
        self.assertEqual(body["simulation_summary"]["Method"], body["simulation_summary"].get("Method"))
        self.assertIn("VF", body["simulation_summary"])
        self.assertIn("Total Cost", body["simulation_summary"])
        self.assertIn("simulation_summary_text", body)
        self.assertIn("daily_simulation", body)
        self.assertNotIn("daily_simulation_csv", body)
        self.assertNotIn("optimize", body)
        self.assertNotIn("classification", body)

        r_csv = self.client.post(
            f"/api/analytics/integration/v2/run?csv=true",
            json={
                "sku_no": sku,
                "sl_target": 0.95,
                "pop_size": 8,
                "n_gen": 5,
                "include_baseline": True,
            },
        )
        if r_csv.status_code == 404:
            self.skipTest(f"SKU {sku} or demand not in DB: {r_csv.text}")
        self.assertEqual(r_csv.status_code, 200, r_csv.text)
        self.assertIn("text/csv", r_csv.headers.get("content-type", ""))
        self.assertTrue(r_csv.text.startswith("date,"))

        r2 = self.client.get(f"/api/analytics/integration/v2/result?sku_no={sku}")
        self.assertEqual(r2.status_code, 200)
        self.assertEqual(r2.json()["api_version"], "v2")
        self.assertIn("simulation_summary", r2.json())
        self.assertNotIn("daily_simulation_csv", r2.json())

        r2_csv = self.client.get(f"/api/analytics/integration/v2/result?sku_no={sku}&csv=true")
        self.assertEqual(r2_csv.status_code, 200)
        self.assertIn("text/csv", r2_csv.headers.get("content-type", ""))
        self.assertTrue(r2_csv.text.startswith("date,"))

        r3 = self.client.get(f"/api/analytics/integration/v2/replenishment?sku_no={sku}")
        self.assertEqual(r3.status_code, 200)
        self.assertEqual(r3.json()["api_version"], "v2")
        self.assertTrue(str(r3.json().get("version", "")).startswith("v2-"))


if __name__ == "__main__":
    unittest.main()
