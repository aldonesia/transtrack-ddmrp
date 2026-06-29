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

export const MASTER_SKU_EXCEL_COLUMNS_SEMICOLON = MASTER_SKU_EXCEL_COLUMNS.join(";");

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
  kind: "text" | "int" | "money" | "rate" | "unit" | "percent";
  required?: boolean;
  step?: number;
  hint?: string;
};

/** Form field order aligned with Excel columns. */
export const MASTER_SKU_FORM_FIELDS: MasterSkuFieldDef[] = [
  { key: "sku", label: "Material Number", kind: "text", required: true },
  { key: "nama_item", label: "Material Description", kind: "text", required: true },
  { key: "group", label: "Material Group", kind: "text", required: true },
  { key: "unit", label: "Unit", kind: "unit", required: true },
  { key: "criticality", label: "Criticality", kind: "text" },
  { key: "abc_class", label: "ABC Class", kind: "text" },
  { key: "xyz_class", label: "XYZ Class", kind: "text" },
  { key: "vendor_type", label: "Vendor Type", kind: "text" },
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
  { key: "holding_cost_day_idr", label: "Holding Cost/day (IDR)", kind: "money" },
  { key: "lost_sale_rate_each", label: "Lost Sale Rate/Each", kind: "rate", required: true, step: 0.01 },
  { key: "penalty_per_unit_idr", label: "Penalty/unit (IDR)", kind: "money" },
  { key: "logistic_cost_order", label: "Logistic Cost/Order", kind: "money", required: true },
  {
    key: "initial_inventory",
    label: "Initial Inventory",
    kind: "int",
    required: true,
    hint: "On-hand quantity at simulation start (required for buffer v2).",
  },
  {
    key: "qmax",
    label: "Qmax",
    kind: "int",
    hint: "Maximum order quantity cap; leave empty if unlimited.",
  },
  {
    key: "target_percentile",
    label: "Target Percentile",
    kind: "percent",
    required: true,
    step: 0.01,
    hint: "LTD percentile for DDMRP conditional (e.g. 0.98 = 98%).",
  },
];
