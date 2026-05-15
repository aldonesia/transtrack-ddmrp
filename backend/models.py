from sqlalchemy import Column, Integer, String, Float, Date, DateTime, Text, ForeignKey, UniqueConstraint, Index
from sqlalchemy.orm import declarative_base

Base = declarative_base()

class SKUMaster(Base):
    """
  Excel `sku_master` column → DB field:
    Material Number → sku
    Material Description → nama_item
    Material Group → group
    Unit → unit
    Criticality → criticality
    ABC Class → abc_class
    XYZ Class → xyz_class
    Vendor Type → vendor_type
    Currency → currency
    Lead Time_Days → lead_time
    MOQ → moq
    Sales Price → harga
    Purchase Price → purchase_price
    Holding Cost Rate/day → holding_cost_rate_day
    Holding Cost/day (IDR) → holding_cost_day_idr
    Lost Sale Rate/Each → lost_sale_rate_each
    Penalty/unit (IDR) → penalty_per_unit_idr
    Logistic Cost/Order → logistic_cost_order
    (Status is UI-only default Active, not in standard import template.)
    """
    __tablename__ = "sku_master"

    sku = Column(String, primary_key=True, index=True)
    nama_item = Column(String)
    unit = Column(String, default="pcs")
    lead_time = Column(Integer)
    moq = Column(Integer)
    pack_size = Column(Integer, default=1)
    harga = Column(Float)
    target_sl = Column(Float)
    status = Column(String)
    group = Column(String, nullable=True)  # material / product group
    lt_category = Column(String, nullable=True)
    category = Column(String, nullable=True)  # Runner, Repeater, Stranger

    criticality = Column(String, nullable=True)
    abc_class = Column(String, nullable=True)
    xyz_class = Column(String, nullable=True)
    vendor_type = Column(String, nullable=True)
    currency = Column(String, nullable=True)
    holding_cost_day_idr = Column(Float, nullable=True)
    penalty_per_unit_idr = Column(Float, nullable=True)

    purchase_price = Column(Float, nullable=True)
    holding_cost_rate_day = Column(Float, nullable=True)  # fraction × harga = hold cost / unit / day
    lost_sale_rate_each = Column(Float, nullable=True)
    logistic_cost_order = Column(Float, nullable=True)

class DDMRPBuffer(Base):
    __tablename__ = "ddmrp_buffer"
    
    id = Column(Integer, primary_key=True, autoincrement=True)
    sku = Column(String, ForeignKey("sku_master.sku"), index=True)
    version = Column(String, index=True)
    start_date = Column(Date)
    end_date = Column(Date)
    status = Column(String)  # Active, Draft, Archived
    
    dlt = Column(Integer)
    adu = Column(Float)
    vf_opt = Column(Float)
    ltf_opt = Column(Float)
    
    tor = Column(Float)
    toy = Column(Float)
    tog = Column(Float)
    score = Column(String)

class DailyRecord(Base):
    __tablename__ = "daily_record"
    
    __table_args__ = (UniqueConstraint("date", "sku", name="uq_daily_record_date_sku"),)

    id = Column(Integer, primary_key=True, autoincrement=True)
    date = Column(Date, index=True)
    sku = Column(String, ForeignKey("sku_master.sku"), index=True)
    
    demand = Column(Float, default=0)
    promo_discount = Column(Float, nullable=True)
    forecast = Column(Float, default=0)
    receipt = Column(Float, default=0)
    oh_end = Column(Float, default=0)
    open_order = Column(Float, default=0)
    qualified_demand = Column(Float, default=0)
    nfe = Column(Float, default=0)
    zone = Column(String, nullable=True)  # Red, Yellow, Green
    order_qty = Column(Float, default=0)
    holding_cost = Column(Float, default=0)
    order_cost = Column(Float, default=0)
    penalty_cost = Column(Float, default=0)
    total_cost = Column(Float, default=0)


class DDMRPBufferDetail(Base):
    __tablename__ = "ddmrp_buffer_detail"

    __table_args__ = (
        UniqueConstraint(
            "buffer_id", "date", name="uq_ddmrp_buffer_detail_buffer_id_date"
        ),
    )

    id = Column(Integer, primary_key=True, autoincrement=True)
    buffer_id = Column(Integer, ForeignKey("ddmrp_buffer.id"), index=True)
    date = Column(Date, index=True)
    order_qty = Column(Float, default=0)
    nfe = Column(Float, default=0)
    zone = Column(String, nullable=True)  # Red, Yellow, Green


class ForecastRun(Base):
    __tablename__ = "forecast_run"

    id = Column(Integer, primary_key=True, autoincrement=True)
    sku = Column(String, ForeignKey("sku_master.sku"), index=True)
    run_at = Column(DateTime, index=True)
    unit = Column(String, default="PCS")
    qty_per_carton = Column(Integer, default=1)
    forecast_json = Column(Text)  # serialized JSON payload
    optimize_json = Column(Text)  # serialized JSON payload


class NightlyJobRun(Base):
    __tablename__ = "nightly_job_run"

    id = Column(Integer, primary_key=True, autoincrement=True)
    started_at = Column(DateTime, index=True)
    finished_at = Column(DateTime, index=True, nullable=True)
    status = Column(String, index=True)  # running | success | partial_success | failed
    processed_skus = Column(Integer, default=0)
    failed_skus = Column(Integer, default=0)
    message = Column(String, nullable=True)
    details_json = Column(Text, nullable=True)


class PurchaseOrder(Base):
    __tablename__ = "purchase_order"

    __table_args__ = (Index("ix_purchase_order_sku_status", "sku", "status"),)

    id = Column(Integer, primary_key=True, autoincrement=True)
    sku = Column(String, ForeignKey("sku_master.sku"), index=True, nullable=False)
    buffer_id = Column(Integer, ForeignKey("ddmrp_buffer.id"), index=True, nullable=False)
    order_date = Column(Date, nullable=False)
    qty = Column(Float, nullable=False)
    unit = Column(String, nullable=False)
    expected_receipt_date = Column(Date, nullable=False, index=True)
    status = Column(String, nullable=False, default="draft")  # draft | confirmed | received | cancelled
    source = Column(String, nullable=False, default="replenishment")
    created_at = Column(DateTime, nullable=False)
    confirmed_at = Column(DateTime, nullable=True)
    received_at = Column(DateTime, nullable=True)
    notes = Column(Text, nullable=True)


class SkuOperationalState(Base):
    __tablename__ = "sku_operational_state"

    sku = Column(String, ForeignKey("sku_master.sku"), primary_key=True)
    as_of_date = Column(Date, nullable=False)
    on_hand = Column(Float, nullable=False, default=0.0)
    buffer_id = Column(Integer, ForeignKey("ddmrp_buffer.id"), nullable=False)
    updated_at = Column(DateTime, nullable=False)
