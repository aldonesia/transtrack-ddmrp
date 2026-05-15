"""Master SKU Excel column parity (18 headers)."""
from __future__ import annotations

import unittest

import pandas as pd

from services.master_upload_parse import (
    MASTER_SKU_EXCEL_COLUMNS,
    MASTER_SKU_NORMALIZED_KEYS,
    _coerce_master_sku_upload,
    _normalize_column_map,
    _parse_date,
    _required_master_column_keys,
    demand_template_sample_rows,
    master_sku_template_sample_rows,
)


class TestMasterSkuColumns(unittest.TestCase):
    def test_template_has_18_columns(self):
        self.assertEqual(len(MASTER_SKU_EXCEL_COLUMNS), 18)
        row = master_sku_template_sample_rows()[0]
        for h in MASTER_SKU_EXCEL_COLUMNS:
            self.assertIn(h, row)

    def test_required_keys_match_excel_headers(self):
        self.assertEqual(_required_master_column_keys(), list(MASTER_SKU_NORMALIZED_KEYS))
        self.assertEqual(len(MASTER_SKU_NORMALIZED_KEYS), 18)

    def test_coerce_full_header_row(self):
        row = master_sku_template_sample_rows()[0]
        df = pd.DataFrame([row], columns=list(MASTER_SKU_EXCEL_COLUMNS))
        tidy = _coerce_master_sku_upload(df)
        self.assertEqual(len(tidy), 1)
        self.assertEqual(tidy.iloc[0]["sku"], "100004821")
        self.assertEqual(tidy.iloc[0]["group"], "Spare Part")
        self.assertEqual(tidy.iloc[0]["harga"], 47549019.0)
        self.assertEqual(tidy.iloc[0]["moq"], 1)

    def test_lead_time_days_header_normalizes(self):
        df = pd.DataFrame([{"Lead Time_Days": 7}])
        dfn = _normalize_column_map(df)
        self.assertIn("lead time_days", dfn.columns)

    def test_invalid_unit_rejected(self):
        row = dict(master_sku_template_sample_rows()[0])
        row["Unit"] = "CTN"
        df = pd.DataFrame([row], columns=list(MASTER_SKU_EXCEL_COLUMNS))
        with self.assertRaises(ValueError):
            _coerce_master_sku_upload(df)

    def test_unit_pr_accepted(self):
        row = dict(master_sku_template_sample_rows()[0])
        row["Unit"] = "PR"
        df = pd.DataFrame([row], columns=list(MASTER_SKU_EXCEL_COLUMNS))
        tidy = _coerce_master_sku_upload(df)
        self.assertEqual(len(tidy), 1)
        self.assertEqual(tidy.iloc[0]["unit"], "PR")

    def test_demand_template_dates_dd_mm_yy(self):
        row = demand_template_sample_rows()[0]
        self.assertRegex(str(row["Date"]), r"^\d{2}/\d{2}/\d{2}$")
        self.assertEqual(_parse_date(row["Date"]).year, 2026)


if __name__ == "__main__":
    unittest.main()
