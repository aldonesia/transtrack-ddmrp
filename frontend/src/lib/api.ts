/** Public API origin (no trailing slash). Set at build time via NEXT_PUBLIC_API_URL. */
const API_BASE = (
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000"
).replace(/\/+$/, "");

export type DatasetStatus = {
  source: string;
  master_rows: number;
  daily_rows: number;
  skus_with_demand: number;
  ready_for_forecast: boolean;
  message: string;
};

export type SkuRow = {
  "ID Item": string | number;
  Grup?: string;
  Tgl_Mulai?: string;
  Tgl_Akhir?: string;
  Jml_Hari?: number;
  Total_Demand?: number;
  ADU?: number;
};

export type MasterSku = {
  sku: string;
  nama_item: string | null;
  unit: string | null;
  lead_time: number | null;
  moq: number | null;
  pack_size: number | null;
  harga: number | null;
  target_sl: number | null;
  status: string | null;
  group: string | null;
  purchase_price: number | null;
  holding_cost_rate_day: number | null;
  lost_sale_rate_each: number | null;
  logistic_cost_order: number | null;
};

export async function getDatasetStatus(): Promise<DatasetStatus> {
  const r = await fetch(`${API_BASE}/api/analytics/dataset-status`);
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function listSkus(): Promise<{ skus: SkuRow[] }> {
  const r = await fetch(`${API_BASE}/api/analytics/skus`);
  if (!r.ok) {
    const j = await r.json().catch(() => ({}));
    throw new Error((j as { detail?: string }).detail ?? r.statusText);
  }
  return r.json();
}

export async function listMasterSkus(): Promise<{ skus: MasterSku[] }> {
  const r = await fetch(`${API_BASE}/api/master/skus`);
  if (!r.ok) {
    const j = await r.json().catch(() => ({}));
    throw new Error((j as { detail?: string }).detail ?? r.statusText);
  }
  return r.json();
}

export async function saveMasterSku(body: Record<string, unknown>) {
  const r = await fetch(`${API_BASE}/api/master/skus`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const j = await r.json().catch(() => ({}));
    throw new Error((j as { detail?: string }).detail ?? r.statusText);
  }
  return r.json();
}

export function demandTemplateUrl(): string {
  return `${API_BASE}/api/master/template/demand`;
}

export async function uploadDemandExcel(file: File) {
  const fd = new FormData();
  fd.append("file", file);
  const r = await fetch(`${API_BASE}/api/master/upload/demand`, {
    method: "POST",
    body: fd,
  });
  if (!r.ok) {
    const j = await r.json().catch(() => ({}));
    throw new Error((j as { detail?: string }).detail ?? r.statusText);
  }
  return r.json();
}

export async function runForecast(sku: string | number) {
  const r = await fetch(`${API_BASE}/api/analytics/forecast`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sku: String(sku) }),
  });
  if (!r.ok) {
    const j = await r.json().catch(() => ({}));
    throw new Error((j as { detail?: string }).detail ?? r.statusText);
  }
  return r.json();
}

export async function runOptimize(
  sku: string | number,
  opts: { sl_target?: number; pop_size?: number; n_gen?: number; include_baseline?: boolean } = {}
) {
  const r = await fetch(`${API_BASE}/api/analytics/optimize`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sku: String(sku),
      sl_target: opts.sl_target ?? 0.95,
      pop_size: opts.pop_size ?? 24,
      n_gen: opts.n_gen ?? 40,
      include_baseline: opts.include_baseline ?? true,
    }),
  });
  if (!r.ok) {
    const j = await r.json().catch(() => ({}));
    throw new Error((j as { detail?: string }).detail ?? r.statusText);
  }
  return r.json();
}
