"""PO service tests with in-memory SQLite."""
from __future__ import annotations

import unittest
from datetime import date, timedelta

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from models import (
    Base,
    DDMRPBuffer,
    DDMRPBufferDetail,
    SKUMaster,
    SkuOperationalState,
)
from services import open_order_service as po_svc
from services.operational_nfe import recalc_operational_nfe


def _seed_session():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(bind=engine)
    Session = sessionmaker(bind=engine)
    db = Session()

    db.add(
        SKUMaster(
            sku="1000001",
            nama_item="Test Item",
            unit="EA",
            lead_time=7,
            moq=1,
            pack_size=1,
            harga=100.0,
            status="Active",
        )
    )
    start = date(2024, 5, 1)
    buf = DDMRPBuffer(
        sku="1000001",
        version="v-test",
        start_date=start,
        end_date=start + timedelta(days=6),
        status="Active",
        dlt=7,
        adu=15.4,
        vf_opt=0.5,
        ltf_opt=1.0,
        tor=58.0,
        toy=196.0,
        tog=340.0,
        score="0",
    )
    db.add(buf)
    db.flush()
    for i in range(7):
        d = start + timedelta(days=i)
        db.add(
            DDMRPBufferDetail(
                buffer_id=buf.id,
                date=d,
                order_qty=171.0 if i == 0 else 0.0,
                nfe=58.45,
                zone="YELLOW",
            )
        )
    db.commit()
    return db, buf


class TestPurchaseOrderService(unittest.TestCase):
    def setUp(self):
        self.db, self.buf = _seed_session()

    def tearDown(self):
        self.db.close()

    def test_create_confirm_list(self):
        po = po_svc.create_draft_po(self.db, "1000001", 171.0)
        self.assertEqual(po.status, "draft")
        self.assertEqual(po.qty, 171.0)
        self.assertEqual(po.expected_receipt_date, date(2024, 5, 8))

        out = po_svc.confirm_po(self.db, po.id)
        self.assertEqual(out["po"]["status"], "confirmed")
        self.assertIn("recalc", out)
        self.assertGreaterEqual(out["recalc"]["open_order"], 171.0)
        self.assertIn(out["recalc"]["zone"], ("RED", "YELLOW", "GREEN"))

        listed = po_svc.list_pos(self.db, sku="1000001", status="confirmed")
        self.assertEqual(listed["total"], 1)

    def test_cancel_draft(self):
        po = po_svc.create_draft_po(self.db, "1000001", 50.0)
        out = po_svc.cancel_po(self.db, po.id)
        self.assertEqual(out["po"]["status"], "cancelled")
        self.assertNotIn("recalc", out)

    def test_receive_increases_on_hand(self):
        po = po_svc.create_draft_po(self.db, "1000001", 100.0)
        po_svc.confirm_po(self.db, po.id)
        out = po_svc.receive_po(self.db, po.id)
        self.assertEqual(out["po"]["status"], "received")

        state = (
            self.db.query(SkuOperationalState)
            .filter(SkuOperationalState.sku == "1000001")
            .first()
        )
        self.assertIsNotNone(state)
        self.assertGreater(state.on_hand, 196.0)

    def test_duplicate_confirm_same_day_fails(self):
        po1 = po_svc.create_draft_po(self.db, "1000001", 10.0)
        po_svc.confirm_po(self.db, po1.id)
        po2 = po_svc.create_draft_po(self.db, "1000001", 20.0)
        with self.assertRaises(ValueError):
            po_svc.confirm_po(self.db, po2.id)

    def test_recalc_without_po(self):
        summary = recalc_operational_nfe(self.db, "1000001")
        self.assertEqual(summary["sku"], "1000001")
        self.assertIn(summary["zone"], ("RED", "YELLOW", "GREEN"))


if __name__ == "__main__":
    unittest.main()
