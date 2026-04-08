/** Production API — never use localhost from an HTTPS public page (browser blocks private-network access). */
declare const process: { env: { NEXT_PUBLIC_API_URL?: string } };

const PRODUCTION_API = "https://transtrack-ddmrp-api.skom.my.id";
const LOCAL_DEV_API = "http://localhost:8000";

/**
 * Public API origin (no trailing slash).
 * - Prefer `NEXT_PUBLIC_API_URL` from `.env.development` / `.env.production` / Docker build.
 * - If missing in the bundle (old cache), infer from `window.location` on the client.
 */
export function getApiBase(): string {
  const env = process.env.NEXT_PUBLIC_API_URL;
  if (typeof env === "string" && env.trim().length > 0) {
    return env.trim().replace(/\/+$/, "");
  }
  if (typeof window !== "undefined") {
    const h = window.location.hostname;
    if (h === "localhost" || h === "127.0.0.1") return LOCAL_DEV_API;
    if (h === "transtrack-ddmrp.skom.my.id") return PRODUCTION_API;
  }
  return PRODUCTION_API;
}

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
  const r = await fetch(`${getApiBase()}/api/analytics/dataset-status`);
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function listSkus(): Promise<{ skus: SkuRow[] }> {
  const r = await fetch(`${getApiBase()}/api/analytics/skus`);
  if (!r.ok) {
    const j = await r.json().catch(() => ({}));
    throw new Error((j as { detail?: string }).detail ?? r.statusText);
  }
  return r.json();
}

export async function listMasterSkus(): Promise<{ skus: MasterSku[] }> {
  const r = await fetch(`${getApiBase()}/api/master/skus`);
  if (!r.ok) {
    const j = await r.json().catch(() => ({}));
    throw new Error((j as { detail?: string }).detail ?? r.statusText);
  }
  return r.json();
}

export async function saveMasterSku(body: Record<string, unknown>) {
  const r = await fetch(`${getApiBase()}/api/master/skus`, {
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
  return `${getApiBase()}/api/master/template/demand`;
}

export function masterSkuTemplateUrl(): string {
  return `${getApiBase()}/api/master/template/master-sku`;
}

export function exportMasterSkuUrl(): string {
  return `${getApiBase()}/api/master/export/master-sku`;
}

export function exportDemandUrl(): string {
  return `${getApiBase()}/api/master/export/demand`;
}

export async function uploadMasterSkuExcel(file: File) {
  const fd = new FormData();
  fd.append("file", file);
  const r = await fetch(`${getApiBase()}/api/master/upload/master-sku`, {
    method: "POST",
    body: fd,
  });
  if (!r.ok) {
    const j = await r.json().catch(() => ({}));
    throw new Error((j as { detail?: string }).detail ?? r.statusText);
  }
  return r.json();
}

export async function validateMasterSkuExcel(file: File) {
  const fd = new FormData();
  fd.append("file", file);
  const r = await fetch(`${getApiBase()}/api/master/validate/master-sku`, {
    method: "POST",
    body: fd,
  });
  if (!r.ok) {
    const j = await r.json().catch(() => ({}));
    throw new Error((j as { detail?: string }).detail ?? r.statusText);
  }
  return r.json();
}

export async function uploadDemandExcel(file: File) {
  const fd = new FormData();
  fd.append("file", file);
  const r = await fetch(`${getApiBase()}/api/master/upload/demand`, {
    method: "POST",
    body: fd,
  });
  if (!r.ok) {
    const j = await r.json().catch(() => ({}));
    throw new Error((j as { detail?: string }).detail ?? r.statusText);
  }
  return r.json();
}

export async function validateDemandExcel(file: File) {
  const fd = new FormData();
  fd.append("file", file);
  const r = await fetch(`${getApiBase()}/api/master/validate/demand`, {
    method: "POST",
    body: fd,
  });
  if (!r.ok) {
    const j = await r.json().catch(() => ({}));
    throw new Error((j as { detail?: string }).detail ?? r.statusText);
  }
  return r.json();
}

export type DemandRow = {
  id: number;
  date: string | null;
  sku: string;
  nama_item?: string | null;
  group?: string | null;
  demand: number;
  promo_discount: number;
};

export async function listDemandRows(opts: { limit?: number; sku?: string } = {}) {
  const limit = opts.limit ?? 100;
  const params = new URLSearchParams();
  params.set("limit", String(limit));
  if (opts.sku) params.set("sku", opts.sku);
  const r = await fetch(`${getApiBase()}/api/master/demand?${params.toString()}`);
  if (!r.ok) {
    const j = await r.json().catch(() => ({}));
    throw new Error((j as { detail?: string }).detail ?? r.statusText);
  }
  return r.json() as Promise<{ rows: DemandRow[] }>;
}

export async function runForecast(sku: string | number) {
  const r = await fetch(`${getApiBase()}/api/analytics/forecast`, {
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

export type ForecastAndOptimizeResponse = {
  buffer_id: number;
  latest_run_id?: number;
  forecast: {
    sku: string;
    unit?: string;
    qty_per_carton?: number;
    best_model?: string;
    best_metrics?: Record<string, unknown>;
    comparison?: Array<Record<string, unknown>>;
    predictions?: Record<string, number[]>;
    actual_test?: number[];
    test_dates?: string[];
    train_size?: number;
    adu?: number;
    series_clean?: number[];
    n_points?: number;
  };
  optimize: Record<string, unknown> & {
    unit?: string;
    qty_per_carton?: number;
  };
};

export async function getLatestRun(sku: string | number) {
  const r = await fetch(
    `${getApiBase()}/api/analytics/latest-run?sku=${encodeURIComponent(String(sku))}`,
  );
  if (!r.ok) {
    const j = await r.json().catch(() => ({}));
    throw new Error((j as { detail?: string }).detail ?? r.statusText);
  }
  return (await r.json()) as {
    sku: string;
    latest_run: {
      id: number;
      run_at: string | null;
      unit: string;
      qty_per_carton: number;
      forecast: ForecastAndOptimizeResponse["forecast"];
      optimize: ForecastAndOptimizeResponse["optimize"];
    } | null;
  };
}

export async function getParitySnapshot(sku: string | number) {
  const r = await fetch(
    `${getApiBase()}/api/analytics/parity-snapshot?sku=${encodeURIComponent(String(sku))}`,
  );
  if (!r.ok) {
    const j = await r.json().catch(() => ({}));
    throw new Error((j as { detail?: string }).detail ?? r.statusText);
  }
  return r.json() as Promise<Record<string, unknown>>;
}

export async function runForecastAndOptimize(
  sku: string | number,
  opts: { sl_target?: number; pop_size?: number; n_gen?: number; include_baseline?: boolean } = {}
): Promise<ForecastAndOptimizeResponse> {
  const r = await fetch(`${getApiBase()}/api/analytics/run`, {
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
  return r.json() as Promise<ForecastAndOptimizeResponse>;
}

export async function runOptimize(
  sku: string | number,
  opts: { sl_target?: number; pop_size?: number; n_gen?: number; include_baseline?: boolean } = {}
) {
  const r = await fetch(`${getApiBase()}/api/analytics/optimize`, {
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

export type ReplenishmentRecommendation = {
  date: string | null;
  order_qty: number;
  nfe: number;
  zone?: string | null;
};

export async function getReplenishmentPlan(sku: string | number) {
  const r = await fetch(
    `${getApiBase()}/api/analytics/replenishment?sku=${encodeURIComponent(String(sku))}`,
  );
  if (!r.ok) {
    const j = await r.json().catch(() => ({}));
    throw new Error((j as { detail?: string }).detail ?? r.statusText);
  }
  return (await r.json()) as {
    sku: string;
    unit?: string;
    qty_per_carton?: number;
    buffer_id: number;
    today_date: string | null;
    leadtime_days: number;
    recommendations: ReplenishmentRecommendation[];
  };
}

export async function getActiveBufferDetail(sku: string | number) {
  const r = await fetch(
    `${getApiBase()}/api/analytics/buffer-active?sku=${encodeURIComponent(String(sku))}`,
  );
  if (!r.ok) {
    const j = await r.json().catch(() => ({}));
    throw new Error((j as { detail?: string }).detail ?? r.statusText);
  }
  return (await r.json()) as {
    sku: string;
    unit: string;
    qty_per_carton: number;
    buffer_id: number;
    version: string;
    status: string;
    start_date: string | null;
    end_date: string | null;
    dlt: number;
    adu: number;
    vf_opt: number;
    ltf_opt: number;
    tor: number;
    toy: number;
    tog: number;
    summary: {
      n_days: number;
      n_order_days: number;
      total_order_qty: number;
      min_nfe: number;
      max_nfe: number;
    };
    recommendations: Array<{
      date: string | null;
      order_qty: number;
      nfe: number;
      zone?: string | null;
    }>;
  };
}
