"""Buffer optimization v2 — classification → method-aware GA → simulation."""
from services.buffer_v2.classification import classify_sku_v2
from services.buffer_v2.pipeline import run_buffer_optimization_v2

__all__ = ["classify_sku_v2", "run_buffer_optimization_v2"]
