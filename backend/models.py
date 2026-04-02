from sqlalchemy import Column, Integer, String, Float, Date, ForeignKey, UniqueConstraint
from sqlalchemy.orm import declarative_base

Base = declarative_base()

class SKUMaster(Base):
    __tablename__ = "sku_master"
    
    sku = Column(String, primary_key=True, index=True)
    nama_item = Column(String)
    unit = Column(String)
    lead_time = Column(Integer)  # Days Lead Time (DLT)
    moq = Column(Integer)
    pack_size = Column(Integer)
    harga = Column(Float)  # sales price (ea) — sync with notebook "Sales Price"
    target_sl = Column(Float)
    status = Column(String)
    group = Column(String, nullable=True)  # material / product group
    lt_category = Column(String, nullable=True)
    category = Column(String, nullable=True)  # Runner, Repeater, Stranger

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
