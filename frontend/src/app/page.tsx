"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { getApiBase } from "@/lib/api";

type DashboardRow = {
  sku: string;
  nfe: number;
  toy: number;
  tog: number;
  action: string;
  status?: string;
};

type DashboardSummary = {
  source?: string;
  total_sku: number;
  zona_merah: number;
  perlu_replenishment: number;
  open_order: number;
  buffer_active: string | null;
  message?: string | null;
  critical_queue_total?: number;
  top_critical?: DashboardRow[];
};

type NightlyStatus = {
  enabled?: boolean;
  last_status?: string | null;
  processed_skus?: number;
  last_run_at?: string | null;
  hour?: number;
  minute?: number;
};

function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleString("en-US", {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function statusLabel(s: string | null | undefined): string {
  const v = (s ?? "").toLowerCase();
  if (v === "success") return "Success";
  if (v === "partial_success") return "Partial success";
  if (v === "failed") return "Failed";
  if (v === "running") return "Running";
  return s ?? "—";
}

function ZoneDistributionMini({
  total,
  zm,
  pr,
}: {
  total: number;
  zm: number;
  pr: number;
}) {
  const t = Math.max(total, 1);
  const wRed = Math.min(100, (zm / t) * 100);
  const wOrange = Math.min(100 - wRed, (Math.max(0, pr - zm) / t) * 100);
  const wGreen = Math.max(0, 100 - wRed - wOrange);
  return (
    <div className="mt-3 flex h-2 w-full overflow-hidden rounded-full bg-slate-800">
      {wRed > 0 ? (
        <div className="h-full bg-red-500 transition-all" style={{ width: `${wRed}%` }} title="Red zone" />
      ) : null}
      {wOrange > 0 ? (
        <div
          className="h-full bg-amber-500 transition-all"
          style={{ width: `${wOrange}%` }}
          title="Needs attention"
        />
      ) : null}
      {wGreen > 0 ? (
        <div className="h-full bg-emerald-600 transition-all" style={{ width: `${wGreen}%` }} title="Other" />
      ) : null}
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="h-14 rounded-xl border border-slate-800 bg-slate-900/80" />
      <div className="h-16 rounded-xl border border-red-900/30 bg-slate-900/80" />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-32 rounded-2xl border border-slate-800 bg-slate-900/80" />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2 h-80 rounded-2xl border border-slate-800 bg-slate-900/80" />
        <div className="h-80 rounded-2xl border border-slate-800 bg-slate-900/80" />
      </div>
    </div>
  );
}

export default function Dashboard() {
  const [data, setData] = useState<DashboardSummary | null>(null);
  const [nightly, setNightly] = useState<NightlyStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadErr(null);

    const base = getApiBase();
    Promise.all([
      fetch(`${base}/api/dashboard-summary`).then(async (r) => {
        if (!r.ok) throw new Error(await r.text());
        return (await r.json()) as DashboardSummary;
      }),
      fetch(`${base}/api/analytics/nightly-status`)
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
    ])
      .then(([d, n]) => {
        if (!cancelled) {
          setData(d);
          setNightly(n as NightlyStatus | null);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setLoadErr(err instanceof Error ? err.message : String(err));
          setData(null);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const topCritical = useMemo(() => {
    const rows = data?.top_critical;
    return Array.isArray(rows) ? rows : [];
  }, [data]);

  const queueTotal = Number(data?.critical_queue_total ?? topCritical.length);
  const moreInQueue = Math.max(0, queueTotal - topCritical.length);

  const processed = nightly?.processed_skus ?? 0;
  const nightlyHour = nightly?.hour ?? 1;
  const nightlyMinute = nightly?.minute ?? 0;
  const mm = String(nightlyMinute).padStart(2, "0");
  const totalSku = data?.total_sku ?? 0;
  const skuRatio =
    totalSku > 0 ? `${processed} / ${totalSku}` : `${processed} / —`;

  const redSkus = topCritical.filter((r) => r.status === "critical");
  const sku1 = redSkus[0]?.sku;
  const sku2 = redSkus[1]?.sku;

  return (
    <div className="space-y-5 animate-in fade-in zoom-in duration-500">
      {/* Header bar */}
      <div className="flex flex-col gap-4 border-b border-slate-800 pb-5 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-bold tracking-tight text-white md:text-3xl">Operational Summary</h1>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-2">
            <span className="relative flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-40" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
            </span>
            <span className="text-xs font-medium text-slate-400">System status</span>
            <span className="text-sm font-semibold text-emerald-400">Active</span>
          </div>
          <Link
            href="/replenishment"
            className="rounded-lg bg-blue-600 px-4 py-2.5 text-center text-sm font-semibold text-white shadow-lg hover:bg-blue-500"
          >
            Execute All Orders
          </Link>
        </div>
      </div>

      {loadErr && (
        <div className="rounded-xl border border-amber-900/50 bg-amber-950/25 px-4 py-3 text-sm text-amber-100">
          <p className="font-medium">API unreachable</p>
          <p className="mt-1 text-xs text-amber-200/90">{loadErr}</p>
        </div>
      )}

      {loading ? <DashboardSkeleton /> : null}

      {!loading && data ? (
        <>
          {/* Alert zona merah */}
          {data.zona_merah > 0 ? (
            <div className="flex gap-3 rounded-xl border border-red-800/60 bg-red-950/40 px-4 py-3 text-red-100">
              <span className="text-xl leading-none" aria-hidden>
                ⚠
              </span>
              <p className="text-sm leading-relaxed">
                <strong>{data.zona_merah} SKU</strong> in the red zone — critical stock, immediate action required.
                Place replenishment orders today to avoid stockouts.
              </p>
            </div>
          ) : null}

          {data.total_sku === 0 && data.message ? (
            <div className="rounded-2xl border border-indigo-500/30 bg-indigo-950/25 p-6">
              <p className="text-sm text-slate-300">{data.message}</p>
              <div className="mt-4 flex flex-wrap gap-2">
                <Link href="/master" className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white">
                  Master Data
                </Link>
                <Link
                  href="/master/demand"
                  className="rounded-lg border border-slate-600 px-3 py-2 text-sm text-slate-200 hover:bg-slate-800"
                >
                  Master Demand
                </Link>
                <Link
                  href="/analytics"
                  className="rounded-lg border border-slate-600 px-3 py-2 text-sm text-slate-200 hover:bg-slate-800"
                >
                  Analytics & Buffer
                </Link>
              </div>
            </div>
          ) : null}

          {/* 4 KPI cards */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5 shadow-lg">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Total SKU</p>
              <p className="mt-1 text-4xl font-bold tabular-nums text-blue-400">{data.total_sku}</p>
              <p className="mt-1 text-xs text-slate-500">active SKUs in the system</p>
              <ZoneDistributionMini total={data.total_sku} zm={data.zona_merah} pr={data.perlu_replenishment} />
            </div>
            <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5 shadow-lg">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Red zone</p>
              <p className="mt-1 text-4xl font-bold tabular-nums text-red-400">{data.zona_merah}</p>
              <p className="mt-1 text-xs text-slate-500">Requires immediate action</p>
            </div>
            <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5 shadow-lg">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Needs replenishment</p>
              <p className="mt-1 text-4xl font-bold tabular-nums text-amber-400">{data.perlu_replenishment}</p>
              <p className="mt-1 text-xs text-slate-500">All SKUs — low stock</p>
            </div>
            <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5 shadow-lg">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Open order</p>
              <p className="mt-1 text-4xl font-bold tabular-nums text-emerald-400">{data.open_order}</p>
              <p className="mt-1 text-xs text-slate-500">Orders placed</p>
            </div>
          </div>

          {/* Two columns */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            {/* Prioritas kritis */}
            <div className="lg:col-span-2 rounded-2xl border border-slate-800 bg-slate-900 p-5 shadow-lg">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-3">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-lg font-bold text-white">Critical Priority SKUs</h2>
                  {data.zona_merah > 0 ? (
                    <span className="rounded-full bg-red-900/50 px-2.5 py-0.5 text-xs font-semibold text-red-300">
                      {data.zona_merah} red zone
                    </span>
                  ) : null}
                </div>
                <span className="text-xs text-slate-500">Sorted by largest deficit (NFE)</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-slate-800 text-xs uppercase tracking-wide text-slate-500">
                      <th className="pb-2 pl-1 font-medium">Priority</th>
                      <th className="pb-2 font-medium">SKU Code</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/80">
                    {topCritical.length === 0 ? (
                      <tr>
                        <td colSpan={2} className="py-10 text-center text-slate-500">
                          No priority SKUs (no active buffer or no red zone / orders).
                        </td>
                      </tr>
                    ) : (
                      topCritical.map((row, i) => (
                        <tr key={`${row.sku}-${i}`} className="hover:bg-slate-800/30">
                          <td className="py-3 pl-1">
                            <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-red-600 text-sm font-bold text-white">
                              {i + 1}
                            </span>
                          </td>
                          <td className="py-3 font-mono text-base font-semibold text-white">{row.sku}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
              {moreInQueue > 0 ? (
                <p className="mt-3 border-t border-slate-800 pt-3 text-sm text-slate-500">
                  +{moreInQueue} more SKUs in the replenishment queue{" "}
                  <Link href="/replenishment" className="font-medium text-blue-400 hover:text-blue-300">
                    View all →
                  </Link>
                </p>
              ) : topCritical.length > 0 ? (
                <p className="mt-3 border-t border-slate-800 pt-3 text-sm text-slate-600">
                  <Link href="/replenishment" className="font-medium text-blue-400 hover:text-blue-300">
                    View replenishment →
                  </Link>
                </p>
              ) : null}
            </div>

            {/* Right column widgets */}
            <div className="space-y-4">
              <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5 shadow-lg">
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="text-sm font-bold text-white">System status</h3>
                  <span className="rounded-full bg-emerald-900/50 px-2 py-0.5 text-[10px] font-bold uppercase text-emerald-300">
                    Online
                  </span>
                </div>
                <ul className="space-y-2.5 text-sm">
                  <li className="flex justify-between gap-2 border-b border-slate-800/80 py-1.5">
                    <span className="text-slate-400">Auto scheduler</span>
                    <span className="font-semibold text-emerald-400">{nightly?.enabled ? "Active" : "Inactive"}</span>
                  </li>
                  <li className="flex justify-between gap-2 border-b border-slate-800/80 py-1.5">
                    <span className="text-slate-400">Daily refresh</span>
                    <span className="font-semibold text-slate-200">
                      {String(nightlyHour).padStart(2, "0")}:{mm} WIB
                    </span>
                  </li>
                  <li className="flex justify-between gap-2 border-b border-slate-800/80 py-1.5">
                    <span className="text-slate-400">Last status</span>
                    <span className="font-semibold text-emerald-400">{statusLabel(nightly?.last_status)}</span>
                  </li>
                  <li className="flex justify-between gap-2 border-b border-slate-800/80 py-1.5">
                    <span className="text-slate-400">SKUs processed</span>
                    <span className="font-semibold text-blue-400">{skuRatio}</span>
                  </li>
                  <li className="flex justify-between gap-2 py-1.5">
                    <span className="text-slate-400">Refresh time</span>
                    <span className="text-right font-mono text-xs text-slate-300">
                      {formatDateTime(nightly?.last_run_at)}
                    </span>
                  </li>
                </ul>
              </div>

              <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5 shadow-lg">
                <h3 className="mb-3 text-sm font-bold text-white">Buffer zone distribution</h3>
                <ul className="space-y-3 text-sm">
                  <li className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="h-3 w-3 shrink-0 rounded-sm bg-red-500" />
                      <div>
                        <p className="font-medium text-slate-200">Red zone</p>
                        <p className="text-xs text-slate-500">Critical stock, order now</p>
                      </div>
                    </div>
                    <span className="shrink-0 font-bold text-red-400">{data.zona_merah} SKU</span>
                  </li>
                  <li className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="h-3 w-3 shrink-0 rounded-sm bg-amber-500" />
                      <div>
                        <p className="font-medium text-slate-200">Yellow zone</p>
                        <p className="text-xs text-slate-500">Low stock, monitor closely</p>
                      </div>
                    </div>
                    <span className="shrink-0 font-bold text-slate-500">—</span>
                  </li>
                  <li className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="h-3 w-3 shrink-0 rounded-sm bg-emerald-500" />
                      <div>
                        <p className="font-medium text-slate-200">Green zone</p>
                        <p className="text-xs text-slate-500">Safe stock, no order needed</p>
                      </div>
                    </div>
                    <span className="shrink-0 font-bold text-slate-500">—</span>
                  </li>
                </ul>
              </div>

              <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5 shadow-lg">
                <h3 className="mb-3 text-sm font-bold text-white">Quick recommendations</h3>
                <ul className="space-y-2.5 text-sm text-slate-300">
                  {sku1 && sku2 ? (
                    <li className="flex gap-2">
                      <span className="text-blue-400">→</span>
                      <span>
                        Execute orders for SKUs {sku1} &amp; {sku2} today.
                      </span>
                    </li>
                  ) : sku1 ? (
                    <li className="flex gap-2">
                      <span className="text-blue-400">→</span>
                      <span>Execute order for SKU {sku1} today.</span>
                    </li>
                  ) : (
                    <li className="flex gap-2 text-slate-500">
                      <span>→</span>
                      <span>Run Analytics to activate buffers and get recommendations.</span>
                    </li>
                  )}
                  <li className="flex gap-2">
                    <span className="text-blue-400">→</span>
                    <span>Contact suppliers to expedite top-priority SKUs.</span>
                  </li>
                  <li className="flex gap-2">
                    <span className="text-blue-400">→</span>
                    <span>
                      Check {moreInQueue > 0 ? `${moreInQueue} more SKUs` : "other SKUs"} in{" "}
                      <Link href="/replenishment" className="text-blue-400 hover:underline">
                        Replenishment
                      </Link>
                      .
                    </span>
                  </li>
                  <li className="flex gap-2">
                    <span className="text-blue-400">→</span>
                    <span>Review buffer parameters if deficits recur.</span>
                  </li>
                </ul>
              </div>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
