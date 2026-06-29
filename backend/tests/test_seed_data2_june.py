"""Seed Data 2 June.csv — parser and dry-run."""
from __future__ import annotations

import os
import sys
import unittest
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND))
os.chdir(BACKEND)

JUNE_CSV = BACKEND / "resources_ext" / "Data 2 June.csv"
if not JUNE_CSV.is_file():
    JUNE_CSV = BACKEND.parent / "resources_ext" / "Data 2 June.csv"

from services.master_upload_parse import (  # noqa: E402
    _coerce_master_sku_upload,
    _parse_percentile_value,
    _parse_qmax_value,
    read_master_upload_dataframe,
)


class TestSeedData2June(unittest.TestCase):
    def test_parse_percentile_and_qmax(self):
        self.assertAlmostEqual(_parse_percentile_value("98%"), 0.98)
        self.assertAlmostEqual(_parse_percentile_value("100%"), 1.0)
        self.assertIsNone(_parse_qmax_value("None"))
        self.assertIsNone(_parse_qmax_value(None))
        self.assertEqual(_parse_qmax_value(3), 3)

    def test_coerce_june_csv_file(self):
        csv_path = BACKEND.parent / "resources_ext" / "Data 2 June.csv"
        if not csv_path.is_file():
            csv_path = BACKEND / "resources_ext" / "Data 2 June.csv"
        if not csv_path.is_file():
            self.skipTest("Data 2 June.csv not in resources_ext")
        df = read_master_upload_dataframe(str(csv_path))
        tidy = _coerce_master_sku_upload(df)
        self.assertEqual(len(tidy), 45)
        row = tidy[tidy["sku"] == "100008503"].iloc[0]
        self.assertEqual(row["initial_inventory"], 2.0)
        self.assertEqual(row["qmax"], 1)
        self.assertAlmostEqual(row["target_percentile"], 0.98)


if __name__ == "__main__":
    unittest.main()
