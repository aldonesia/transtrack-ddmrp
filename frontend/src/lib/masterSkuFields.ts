/** Excel `sku_master` headers — must match backend `MASTER_SKU_EXCEL_COLUMNS`. */
export const MASTER_SKU_EXCEL_COLUMNS = [
  "Material Number",
  "Material Description",
  "Material Group",
  "Unit",
  "Criticality",
  "ABC Class",
  "XYZ Class",
  "Vendor Type",
  "Currency",
  "Lead Time_Days",
  "MOQ",
  "Sales Price",
  "Purchase Price",
  "Holding Cost Rate/day",
  "Holding Cost/day (IDR)",
  "Lost Sale Rate/Each",
  "Penalty/unit (IDR)",
  "Logistic Cost/Order",
  "Initial Inventory",
  "Qmax",
  "Target Percentile",
] as const;

/**
 * Columns that must have a value on every row (per README "Kolom wajib").
 * All 21 `MASTER_SKU_EXCEL_COLUMNS` headers must still be present in the file —
 * this subset is about per-row value validation, not header presence.
 */
export const MASTER_SKU_REQUIRED_COLUMNS = [
  "Material Number",
  "Material Group",
  "Lead Time_Days",
  "Sales Price",
  "Purchase Price",
  "Holding Cost Rate/day",
  "Lost Sale Rate/Each",
  "Logistic Cost/Order",
  "MOQ",
] as const;

/** Allowed Unit values (must match backend `MASTER_SKU_ALLOWED_UNITS`). */
export const MASTER_SKU_ALLOWED_UNITS = [
  "EA",
  "SET",
  "BAG",
  "PKT",
  "BOX",
  "PR",
  "LBS",
  "KG",
  "MT",
  "M",
  "FT",
  "IN",
  "L",
] as const;

/** Vendor Type choices for the manual Add/Edit SKU modal. */
export const MASTER_SKU_VENDOR_TYPES = ["Local", "Import"] as const;

export type MasterSkuFormKey =
  | "sku"
  | "nama_item"
  | "group"
  | "unit"
  | "criticality"
  | "abc_class"
  | "xyz_class"
  | "vendor_type"
  | "currency"
  | "lead_time"
  | "moq"
  | "harga"
  | "purchase_price"
  | "holding_cost_rate_day"
  | "holding_cost_day_idr"
  | "lost_sale_rate_each"
  | "penalty_per_unit_idr"
  | "logistic_cost_order"
  | "initial_inventory"
  | "qmax"
  | "target_percentile";

export type MasterSkuFieldDef = {
  key: MasterSkuFormKey;
  label: string;
  kind: "text" | "int" | "money" | "rate" | "unit" | "percent" | "select";
  required?: boolean;
  step?: number;
  hint?: string;
  options?: readonly string[];
};

/**
 * Fields rendered in the manual Add/Edit SKU modal.
 * Criticality / ABC Class / XYZ Class and Qmax are intentionally omitted here —
 * they're still stored (round-tripped from the loaded row on save) and still part
 * of the Excel bulk-upload template (`MASTER_SKU_EXCEL_COLUMNS`), just not manually
 * editable from this form. Holding Cost/day (IDR) and Penalty/unit (IDR) are also
 * omitted — they're auto-computed (rate × price) and shown read-only instead.
 */
export const MASTER_SKU_FORM_FIELDS: MasterSkuFieldDef[] = [
  { key: "sku", label: "Material Number", kind: "text", required: true },
  { key: "nama_item", label: "Material Description", kind: "text", required: true },
  { key: "group", label: "Material Group", kind: "text", required: true },
  { key: "unit", label: "Unit", kind: "unit", required: true },
  { key: "vendor_type", label: "Vendor Type", kind: "select", options: MASTER_SKU_VENDOR_TYPES },
  { key: "currency", label: "Currency", kind: "text" },
  {
    key: "lead_time",
    label: "Lead Time_Days",
    kind: "int",
    required: true,
    hint: "Supplier working days to warehouse (DLT).",
  },
  { key: "moq", label: "MOQ", kind: "int", required: true, hint: "Minimum order quantity per PO." },
  { key: "harga", label: "Sales Price", kind: "money", required: true },
  { key: "purchase_price", label: "Purchase Price", kind: "money", required: true },
  {
    key: "holding_cost_rate_day",
    label: "Holding Cost Rate/day",
    kind: "rate",
    required: true,
    step: 0.000001,
  },
  { key: "lost_sale_rate_each", label: "Lost Sale Rate/Each", kind: "rate", required: true, step: 0.01 },
  { key: "logistic_cost_order", label: "Order Cost", kind: "money", required: true },
  {
    key: "initial_inventory",
    label: "Initial Inventory",
    kind: "int",
    required: true,
    hint: "On-hand quantity at simulation start (required for buffer v2).",
  },
  {
    key: "target_percentile",
    label: "Target Service Level",
    kind: "percent",
    required: true,
    step: 0.01,
    hint: "LTD percentile for DDMRP conditional (e.g. 0.98 = 98%).",
  },
];
