"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  getDashboardSummary,
  getReplenishmentPlan,
  listMasterSkus,
  listSkus,
  type DashboardSummary,
  type MasterSku,
  type SkuRow,
} from "@/lib/api";

const PAGE_SIZE = 8;

function fmtDateDdMmYy(iso: string | null | undefined): string {
  if (!iso) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (m) return `${m[3]}/${m[2]}/${m[1].slice(-2)}`;
  return iso;
}

function addDaysIso(iso: string, days: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function normZone(z: string | null | undefined): string {
  return String(z ?? "").toUpperCase();
}

function zoneStyle(zone: string): string {
  const z = normZone(zone);
  if (z === "RED") return "bg-red-500/20 text-red-300 border-red-500/40";
  if (z === "YELLOW") return "bg-amber-500/20 text-amber-200 border-amber-500/40";
  if (z === "GREEN") return "bg-emerald-500/20 text-emerald-300 border-emerald-500/40";
  return "bg-slate-800/40 text-slate-400 border-slate-700";
}

type ReplenishmentPlan = Awaited<ReturnType<typeof getReplenishmentPlan>>;

function BufferPositionBar({
  tor,
  toy,
  tog,
  nfe,
  unit,
}: {
  tor: number;
  toy: number;
  tog: number;
  nfe: number;
  unit: string;
}) {
  const max = Math.max(tog, 1);
  const pct = (v: number) => `${Math.min(100, Math.max(0, (v / max) * 100))}%`;
  const nfePct = Math.min(100, Math.max(0, (nfe / max) * 100));

  return (
    <div className="space-y-3">
      <div className="relative h-8 w-full overflow-hidden rounded-lg border border-slate-700 bg-slate-950">
        <div className="absolute inset-y-0 left-0 bg-red-600/80" style={{ width: pct(tor) }} />
        <div
          className="absolute inset-y-0 bg-amber-500/80"
          style={{ left: pct(tor), width: `calc(${pct(toy)} - ${pct(tor)})` }}
        />
        <div
          className="absolute inset-y-0 bg-emerald-600/70"
          style={{ left: pct(toy), width: `calc(100% - ${pct(toy)})` }}
        />
        <div
          className="absolute top-0 bottom-0 w-0.5 bg-white shadow-[0_0_8px_rgba(255,255,255,0.8)]"
          style={{ left: `calc(${nfePct}% - 1px)` }}
          title={`NFE ${nfe.toFixed(2)} ${unit}`}
        />
      </div>
      <p className="text-center text-xs text-slate-400">
        Current NFE:{" "}
        <span className="font-mono font-semibold text-amber-300">
          {nfe.toFixed(2)} {unit}
        </span>
      </p>
    </div>
  );
}

function ScheduleQtyBar({ qty, maxQty, zone }: { qty: number; maxQty: number; zone: string }) {
  const w = maxQty > 0 ? Math.min(100, (qty / maxQty) * 100) : 0;
  const barColor =
    normZone(zone) === "RED"
      ? "bg-red-500"
      : normZone(zone) === "YELLOW"
        ? "bg-amber-500"
        : qty > 0
          ? "bg-indigo-500"
          : "bg-slate-700";
  return (
    <div className="flex items-center justify-end gap-2">
      <span className="font-mono text-sm tabular-nums text-white">{qty > 0 ? qty.toFixed(0) : "—"}</span>
      <div className="h-2 w-24 overflow-hidden rounded-full bg-slate-800">
        {qty > 0 ? <div className={`h-full ${barColor}`} style={{ width: `${w}%` }} /> : null}
      </div>
    </div>
  );
}

export default function Replenishment() {
  const [skuList, setSkuList] = useState<SkuRow[]>([]);
  const [masterBySku, setMasterBySku] = useState<Record<string, MasterSku>>({});
  const [dash, setDash] = useState<DashboardSummary | null>(null);
  const [selectedSku, setSelectedSku] = useState<string>("");
  const [plan, setPlan] = useState<ReplenishmentPlan | null>(null);
  const [loading, setLoading] = useState(false);
  const [dashLoading, setDashLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [zoneFilter, setZoneFilter] = useState<"ALL" | "RED" | "YELLOW" | "GREEN">("ALL");
  const [page, setPage] = useState(1);
  const [poNotice, setPoNotice] = useState<string | null>(null);

  const unit = (plan?.unit ?? "EA").toUpperCase();
  const selectedSkuMeta = useMemo(
    () => skuList.find((s) => String(s["ID Item"]) === String(selectedSku)),
    [skuList, selectedSku],
  );
  const masterSku = masterBySku[selectedSku];
  const skuLabel = masterSku?.nama_item
    ? `${selectedSku} — ${masterSku.nama_item}`
    : selectedSkuMeta?.Grup
      ? `${selectedSku} — ${selectedSkuMeta.Grup}`
      : selectedSku;

  const todayRow = useMemo(() => {
    if (!plan?.today_date || !plan.recommendations?.length) return null;
    return (
      plan.recommendations.find((r) => r.date === plan.today_date) ?? plan.recommendations[0]
    );
  }, [plan]);

  const currentNfe = todayRow?.nfe ?? 0;
  const todayOrderQty = todayRow?.order_qty ?? 0;
  const todayZone = normZone(todayRow?.zone);

  const tor = plan?.tor ?? 0;
  const toy = plan?.toy ?? 0;
  const tog = plan?.tog ?? 0;

  const skuZoneCounts = useMemo(() => {
    const rows = plan?.recommendations ?? [];
    let red = 0;
    let yellow = 0;
    let green = 0;
    for (const r of rows) {
      const z = normZone(r.zone);
      const hasOrder = Number(r.order_qty) > 0;
      if (z === "RED" && hasOrder) red += 1;
      else if (z === "YELLOW" && hasOrder) yellow += 1;
      else if (z === "GREEN" && !hasOrder) green += 1;
    }
    return { red, yellow, green };
  }, [plan]);

  const filteredRows = useMemo(() => {
    const rows = plan?.recommendations ?? [];
    if (zoneFilter === "ALL") return rows;
    return rows.filter((r) => normZone(r.zone) === zoneFilter);
  }, [plan, zoneFilter]);

  const maxOrderInTable = useMemo(
    () => Math.max(...filteredRows.map((r) => Number(r.order_qty) || 0), 1),
    [filteredRows],
  );

  const pageCount = Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE));
  const pagedRows = filteredRows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const etaDate = plan?.today_date
    ? fmtDateDdMmYy(addDaysIso(plan.today_date, plan.leadtime_days))
    : "—";

  const loadInitial = useCallback(async () => {
    setDashLoading(true);
    try {
      const [skusRes, dashRes, masterRes] = await Promise.all([
        listSkus(),
        getDashboardSummary(),
        listMasterSkus().catch(() => ({ skus: [] as MasterSku[] })),
      ]);
      setSkuList(skusRes.skus ?? []);
      setDash(dashRes);
      const map: Record<string, MasterSku> = {};
      for (const m of masterRes.skus ?? []) map[m.sku] = m;
      setMasterBySku(map);

      const critical = dashRes.top_critical?.[0]?.sku;
      const first = skusRes.skus?.[0] ? String(skusRes.skus[0]["ID Item"]) : "";
      setSelectedSku((prev) => prev || critical || first);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setDashLoading(false);
    }
  }, []);

  const loadPlan = useCallback(async (sku: string) => {
    if (!sku.trim()) return;
    setLoading(true);
    setErr(null);
    try {
      const p = await getReplenishmentPlan(sku);
      setPlan(p);
      setPage(1);
    } catch (e: unknown) {
      setPlan(null);
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadInitial();
  }, [loadInitial]);

  useEffect(() => {
    if (!selectedSku) return;
    void loadPlan(selectedSku);
  }, [selectedSku, loadPlan]);

  useEffect(() => {
    setPage(1);
  }, [zoneFilter, selectedSku]);

  const exportPoCsv = () => {
    if (!plan) return;
    const lines = [
      "sku,date,order_qty,nfe,zone,unit",
      ...plan.recommendations
        .filter((r) => Number(r.order_qty) > 0)
        .map(
          (r) =>
            `${plan.sku},${r.date ?? ""},${r.order_qty},${r.nfe},${r.zone ?? ""},${unit}`,
        ),
    ];
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `po-${plan.sku}-${plan.today_date ?? "export"}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    setPoNotice("PO export downloaded.");
  };

  const createPoToday = () => {
    if (!plan || todayOrderQty <= 0) {
      setPoNotice("No order quantity recommended for today.");
      return;
    }
    setPoNotice(
      `PO draft: SKU ${plan.sku} — ${todayOrderQty.toFixed(2)} ${unit} (order date ${fmtDateDdMmYy(plan.today_date)}).`,
    );
  };

  const totalNeed = dash?.perlu_replenishment ?? 0;
  const redGlobal = dash?.zona_merah ?? 0;
  const yellowGlobal = dash?.zona_kuning ?? Math.max(0, totalNeed - redGlobal);
  const refDate = plan?.today_date ? fmtDateDdMmYy(plan.today_date) : "—";

  return (
    <div className="space-y-5 animate-in fade-in duration-500">
      {/* Header */}
      <div className="flex flex-col gap-4 border-b border-slate-800 pb-5 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white md:text-3xl">
            Replenishment recommendation
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-400">
            Buffers are calculated from forecast + DDMRP + GA (notebook RUN 4). Review order
            quantities and confirm purchase orders manually.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={!plan}
            onClick={exportPoCsv}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-600 bg-slate-900 px-4 py-2.5 text-sm font-semibold text-slate-200 hover:bg-slate-800 disabled:opacity-40"
          >
            <span aria-hidden>↓</span> Export PO
          </button>
          <Link
            href="/"
            className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-red-900/30 hover:bg-red-500"
          >
            <span aria-hidden>⚡</span>
            Execute all ({totalNeed} SKU)
          </Link>
        </div>
      </div>

      {poNotice ? (
        <div className="rounded-lg border border-indigo-500/40 bg-indigo-950/30 px-4 py-2 text-sm text-indigo-200">
          {poNotice}
          <button
            type="button"
            className="ml-3 text-xs text-indigo-400 hover:text-white"
            onClick={() => setPoNotice(null)}
          >
            Dismiss
          </button>
        </div>
      ) : null}

      {err ? (
        <div className="rounded-xl border border-red-900/50 bg-red-950/30 px-4 py-3 text-sm text-red-200">
          {err}
          {err.includes("No active") ? (
            <p className="mt-2">
              Run{" "}
              <Link href="/analytics" className="font-medium text-red-100 underline">
                Analytics &amp; Buffer → Run full pipeline
              </Link>{" "}
              for this SKU first.
            </p>
          ) : null}
        </div>
      ) : null}

      {/* Alert banner */}
      {!dashLoading && totalNeed > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-800/60 bg-gradient-to-r from-red-950/80 to-red-900/30 px-4 py-3">
          <div className="flex items-start gap-3">
            <span className="text-xl text-red-400" aria-hidden>
              ⚠
            </span>
            <p className="text-sm text-red-100">
              <strong className="text-white">{totalNeed} SKU</strong> require replenishment today
              <span className="text-red-300/90">
                {" "}
                ({redGlobal} in red zone, {yellowGlobal} in yellow zone)
              </span>
            </p>
          </div>
          <div className="flex items-center gap-3 text-xs text-red-200/80">
            <span>
              Server reference date:{" "}
              <span className="font-mono font-semibold text-white">{refDate}</span>
            </span>
            <Link href="/" className="font-semibold text-red-200 hover:text-white underline">
              View all
            </Link>
          </div>
        </div>
      ) : null}

      {/* SKU toolbar */}
      <div className="flex flex-wrap items-end gap-4 rounded-xl border border-slate-800 bg-slate-900/60 p-4">
        <div>
          <label className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-slate-500">
            SKU
          </label>
          <select
            value={selectedSku}
            onChange={(e) => setSelectedSku(e.target.value)}
            className="min-w-[220px] rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
          >
            {skuList.length === 0 && <option value="">—</option>}
            {skuList.map((s) => (
              <option key={String(s["ID Item"])} value={String(s["ID Item"])}>
                {String(s["ID Item"])}
                {s.Grup ? ` — ${s.Grup}` : ""}
              </option>
            ))}
          </select>
        </div>
        <MetricChip
          label="ADU"
          value={
            plan?.adu != null
              ? `${plan.adu.toFixed(2)} ${unit}/day`
              : selectedSkuMeta?.ADU != null
                ? `${Number(selectedSkuMeta.ADU).toFixed(2)}`
                : "—"
          }
        />
        <MetricChip label="Lead time" value={plan ? `${plan.leadtime_days} days` : "—"} />
        <MetricChip
          label="Total demand"
          value={
            selectedSkuMeta?.Total_Demand != null
              ? `${Number(selectedSkuMeta.Total_Demand).toLocaleString("en-US", { maximumFractionDigits: 0 })} ${unit}`
              : "—"
          }
        />
        <MetricChip label="Unit" value={unit} />
        <button
          type="button"
          disabled={!selectedSku || loading}
          onClick={() => void loadPlan(selectedSku)}
          className="rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-sm text-slate-200 hover:bg-slate-700 disabled:opacity-40"
          title="Refresh"
        >
          {loading ? "…" : "↻"} Refresh
        </button>
      </div>

      {/* Zone summary cards */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <SummaryCard
          title="Red zone"
          value={String(dash?.zona_merah ?? skuZoneCounts.red)}
          subtitle="order urgently"
          accent="red"
        />
        <SummaryCard
          title="Yellow zone"
          value={String(dash?.zona_kuning ?? skuZoneCounts.yellow)}
          subtitle="needs ordering"
          accent="amber"
        />
        <SummaryCard
          title="Green zone"
          value={String(dash?.zona_hijau ?? skuZoneCounts.green)}
          subtitle="safe, skip order"
          accent="emerald"
        />
        <SummaryCard
          title="Total order today"
          value={todayOrderQty > 0 ? `${todayOrderQty.toFixed(0)} ${unit}` : "—"}
          subtitle="for this SKU"
          accent="white"
        />
        <SummaryCard
          title="Open order"
          value={String(dash?.open_order ?? 0)}
          subtitle="already created"
          accent="slate"
        />
      </div>

      {/* Two columns */}
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        {/* Schedule table */}
        <div className="xl:col-span-2 rounded-2xl border border-slate-800 bg-slate-900 shadow-xl overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 bg-slate-900/80 px-5 py-4">
            <div>
              <h2 className="text-base font-bold text-white">Order quantity schedule</h2>
              <p className="text-xs text-slate-500 font-mono mt-0.5">{skuLabel || "—"}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <select
                value={zoneFilter}
                onChange={(e) => setZoneFilter(e.target.value as typeof zoneFilter)}
                className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-white"
              >
                <option value="ALL">All zones</option>
                <option value="RED">Red</option>
                <option value="YELLOW">Yellow</option>
                <option value="GREEN">Green</option>
              </select>
              <button
                type="button"
                disabled={!plan}
                onClick={exportPoCsv}
                className="rounded-lg border border-slate-600 px-3 py-1.5 text-xs font-medium text-slate-300 hover:bg-slate-800 disabled:opacity-40"
              >
                Export
              </button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-800 bg-slate-950 text-xs uppercase tracking-wide text-slate-500">
                  <th className="px-5 py-3 font-medium">Date</th>
                  <th className="px-5 py-3 font-medium text-right">Order qty ({unit})</th>
                  <th className="px-5 py-3 font-medium text-right">NFE ({unit})</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {!plan ? (
                  <tr>
                    <td colSpan={3} className="px-5 py-10 text-center text-slate-500">
                      {loading ? "Loading plan…" : "No active buffer — run pipeline in Analytics."}
                    </td>
                  </tr>
                ) : pagedRows.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="px-5 py-10 text-center text-slate-500">
                      No rows for this zone filter.
                    </td>
                  </tr>
                ) : (
                  pagedRows.map((r, idx) => {
                    const isToday = r.date === plan.today_date;
                    return (
                      <tr
                        key={`${r.date}-${idx}`}
                        className={
                          isToday
                            ? "bg-amber-950/25 hover:bg-amber-950/35"
                            : "hover:bg-slate-800/30"
                        }
                      >
                        <td className="px-5 py-3">
                          <div className="flex items-center gap-2">
                            {isToday ? (
                              <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-bold uppercase text-amber-300">
                                Today
                              </span>
                            ) : null}
                            <span className={isToday ? "font-semibold text-amber-100" : "text-slate-300"}>
                              {fmtDateDdMmYy(r.date)}
                            </span>
                          </div>
                        </td>
                        <td className="px-5 py-3">
                          <ScheduleQtyBar
                            qty={Number(r.order_qty)}
                            maxQty={maxOrderInTable}
                            zone={normZone(r.zone)}
                          />
                        </td>
                        <td className="px-5 py-3 text-right">
                          <span
                            className={`inline-flex items-center gap-2 font-mono tabular-nums ${isToday ? "text-amber-200 font-semibold" : "text-slate-400"}`}
                          >
                            {Number(r.nfe).toFixed(2)}
                            <span
                              className={`rounded border px-1.5 py-0.5 text-[10px] font-bold ${zoneStyle(r.zone ?? "")}`}
                            >
                              {normZone(r.zone) || "—"}
                            </span>
                          </span>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {plan && pageCount > 1 ? (
            <div className="flex items-center justify-center gap-1 border-t border-slate-800 px-4 py-3">
              {Array.from({ length: Math.min(pageCount, 6) }, (_, i) => i + 1).map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPage(p)}
                  className={`min-w-[2rem] rounded-lg px-2 py-1 text-xs font-semibold ${
                    page === p
                      ? "bg-red-600 text-white"
                      : "text-slate-400 hover:bg-slate-800 hover:text-white"
                  }`}
                >
                  {p}
                </button>
              ))}
            </div>
          ) : null}
        </div>

        {/* Buffer position + actions */}
        <div className="space-y-4">
          <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5 shadow-xl">
            <h2 className="text-base font-bold text-white">Current buffer position</h2>
            <p className="text-xs text-slate-500 mt-0.5">Net flow vs TOR / TOY / TOG</p>

            {!plan ? (
              <p className="mt-6 text-sm text-slate-500">Select a SKU with an active buffer.</p>
            ) : (
              <div className="mt-5 space-y-4">
                <div className="space-y-2 text-xs">
                  <ZoneRangeRow color="emerald" label="Green" from={toy} to={tog} unit={unit} />
                  <ZoneRangeRow color="amber" label="Yellow" from={tor} to={toy} unit={unit} />
                  <ZoneRangeRow color="red" label="Red" from={0} to={tor} unit={unit} />
                </div>

                <BufferPositionBar tor={tor} toy={toy} tog={tog} nfe={currentNfe} unit={unit} />

                <dl className="grid grid-cols-2 gap-2 text-xs">
                  {[
                    ["TOG", tog],
                    ["TOY", toy],
                    ["TOR", tor],
                    ["NFE", currentNfe],
                  ].map(([k, v]) => (
                    <div key={k} className="rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2">
                      <dt className="text-slate-500">{k}</dt>
                      <dd className="font-mono font-semibold text-white">
                        {Number(v).toFixed(2)} {unit}
                      </dd>
                    </div>
                  ))}
                </dl>
              </div>
            )}
          </div>

          <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5 shadow-xl space-y-3">
            <h2 className="text-base font-bold text-white">Quick actions</h2>

            {plan && todayOrderQty > 0 ? (
              <div className="rounded-lg border border-amber-700/50 bg-amber-950/30 px-3 py-2.5 text-xs text-amber-100 leading-relaxed">
                NFE is at the <strong>{todayZone || "buffer"}</strong> boundary. Recommended order
                today: <strong>{todayOrderQty.toFixed(0)} {unit}</strong>.
              </div>
            ) : plan ? (
              <div className="rounded-lg border border-emerald-800/40 bg-emerald-950/20 px-3 py-2.5 text-xs text-emerald-200">
                No order required today for this SKU in the active window.
              </div>
            ) : null}

            {plan ? (
              <div className="rounded-lg border border-blue-800/40 bg-blue-950/25 px-3 py-2.5 text-xs text-blue-200 leading-relaxed">
                Lead time <strong>{plan.leadtime_days} days</strong>. If ordered today (
                {fmtDateDdMmYy(plan.today_date)}), stock is expected around{" "}
                <strong>{etaDate}</strong>.
              </div>
            ) : null}

            <button
              type="button"
              disabled={!plan || todayOrderQty <= 0}
              onClick={createPoToday}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-red-600 py-3.5 text-sm font-bold text-white shadow-lg shadow-red-900/40 hover:bg-red-500 disabled:opacity-40"
            >
              <span aria-hidden>⚡</span>
              Create PO {todayOrderQty > 0 ? `${todayOrderQty.toFixed(0)} ${unit}` : ""} now
            </button>

            <Link
              href="/analytics"
              className="block text-center text-xs text-slate-500 hover:text-indigo-400 underline"
            >
              Re-run buffer in Analytics
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

function MetricChip({ label, value }: { label: string; value: string }) {
  return (
    <div className="pb-0.5">
      <p className="text-[10px] uppercase tracking-wide text-slate-500">{label}</p>
      <p className="text-sm font-mono font-medium text-slate-200">{value}</p>
    </div>
  );
}

function SummaryCard({
  title,
  value,
  subtitle,
  accent,
}: {
  title: string;
  value: string;
  subtitle: string;
  accent: "red" | "amber" | "emerald" | "white" | "slate";
}) {
  const valueColor =
    accent === "red"
      ? "text-red-400"
      : accent === "amber"
        ? "text-amber-400"
        : accent === "emerald"
          ? "text-emerald-400"
          : "text-white";
  const border =
    accent === "red"
      ? "border-red-900/40"
      : accent === "amber"
        ? "border-amber-900/30"
        : accent === "emerald"
          ? "border-emerald-900/30"
          : "border-slate-800";

  return (
    <div className={`rounded-xl border ${border} bg-slate-900/80 p-4`}>
      <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">{title}</p>
      <p className={`mt-1 text-2xl font-bold tabular-nums ${valueColor}`}>{value}</p>
      <p className="mt-0.5 text-[11px] text-slate-500">{subtitle}</p>
    </div>
  );
}

function ZoneRangeRow({
  color,
  label,
  from,
  to,
  unit,
}: {
  color: "red" | "amber" | "emerald";
  label: string;
  from: number;
  to: number;
  unit: string;
}) {
  const dot =
    color === "red" ? "bg-red-500" : color === "amber" ? "bg-amber-500" : "bg-emerald-500";
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="flex items-center gap-2 text-slate-400">
        <span className={`h-2 w-2 rounded-full ${dot}`} />
        {label}
      </span>
      <span className="font-mono text-slate-300">
        {from.toFixed(0)} – {to.toFixed(0)} {unit}
      </span>
    </div>
  );
}
