"""Unit tests for operational NFE helpers (P2)."""
from __future__ import annotations

import unittest

from services.operational_nfe import (
    compute_nfe,
    qualified_demand_at_index,
    suggested_order_qty,
    zone_from_nfe,
)
import numpy as np


class TestOperationalNfeHelpers(unittest.TestCase):
    def test_zone_boundaries(self):
        self.assertEqual(zone_from_nfe(50, 58, 196), "RED")
        self.assertEqual(zone_from_nfe(58, 58, 196), "RED")
        self.assertEqual(zone_from_nfe(100, 58, 196), "YELLOW")
        self.assertEqual(zone_from_nfe(196, 58, 196), "YELLOW")
        self.assertEqual(zone_from_nfe(250, 58, 196), "GREEN")

    def test_compute_nfe(self):
        self.assertAlmostEqual(compute_nfe(196, 171, 15.4), 351.6)

    def test_qualified_demand_with_forecast_horizon(self):
        demands = np.array([10.0, 12.0, 8.0, 20.0])
        forecast = np.array([10.0, 12.0, 8.0, 25.0, 30.0, 5.0])
        ost = 9.0
        qd = qualified_demand_at_index(0, demands, forecast, dlt=2, ost=ost)
        self.assertEqual(qd, 22.0)
        qd1 = qualified_demand_at_index(0, demands, forecast, dlt=3, ost=ost)
        self.assertEqual(qd1, 47.0)

    def test_suggested_order_when_below_toy(self):
        sug = suggested_order_qty(nfe=100, toy=196, tog=340, pack_size=1)
        self.assertEqual(sug, 240.0)


if __name__ == "__main__":
    unittest.main()
