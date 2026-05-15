"""Unit tests for master upload helpers (Data 2 / Excel parity, no DB)."""
from __future__ import annotations

import unittest
from datetime import date, datetime

import pandas as pd

from services.master_upload_parse import (
    _coerce_demand_upload,
    _normalize_column_map,
    _parse_date,
    _sku_key_from_excel,
)


class TestParseDate(unittest.TestCase):
    def test_iso_string(self):
        self.assertEqual(_parse_date("2026-01-15"), date(2026, 1, 15))

    def test_datetime(self):
        self.assertEqual(_parse_date(datetime(2026, 2, 1, 12, 0)), date(2026, 2, 1))

    def test_excel_serial_in_range(self):
        # 45810 ≈ 2025-06-18 with origin 1899-12-30
        d = _parse_date(45810.0)
        self.assertEqual(d.year, 2025)
        self.assertEqual(d.month, 6)


class TestNormalizeColumns(unittest.TestCase):
    def test_demand_column_with_trailing_space_maps_to_demand(self):
        df = pd.DataFrame([{"Date": "2026-01-01", "ID Item": 100004821, "Demand ": 5}])
        dfn = _normalize_column_map(df)
        self.assertIn("date", dfn.columns)
        self.assertIn("id item", dfn.columns)
        self.assertIn("demand", dfn.columns)


class TestSkuKey(unittest.TestCase):
    def test_float_whole_number(self):
        self.assertEqual(_sku_key_from_excel(100004821.0), "100004821")

    def test_string_trim(self):
        self.assertEqual(_sku_key_from_excel("  ABC-1 "), "ABC-1")


class TestCoerceDemandUpload(unittest.TestCase):
    def test_dd_mm_yy_string(self):
        df = pd.DataFrame(
            [
                {
                    "Date": "01/01/26",
                    "ID Item": 100004821,
                    "Demand ": 2,
                }
            ]
        )
        tidy = _coerce_demand_upload(df)
        self.assertEqual(len(tidy), 1)
        self.assertEqual(tidy.iloc[0]["date"].year, 2026)

    def test_data2_style_row(self):
        df = pd.DataFrame(
            [
                {
                    "Date": "2026-01-01",
                    "ID Item": 100004821,
                    "Demand ": 3,
                    "PromoDiscountPct": 0.1,
                }
            ]
        )
        tidy = _coerce_demand_upload(df)
        self.assertEqual(len(tidy), 1)
        self.assertEqual(tidy.iloc[0]["sku"], "100004821")
        self.assertEqual(tidy.iloc[0]["demand"], 3.0)
        self.assertAlmostEqual(tidy.iloc[0]["promo_discount"], 0.1)


if __name__ == "__main__":
    unittest.main()
