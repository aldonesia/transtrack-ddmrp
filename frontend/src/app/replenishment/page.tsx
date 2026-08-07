"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  confirmPurchaseOrder,
  createPurchaseOrder,
  getDashboardSummary,
  getReplenishmentPlan,
  listMasterSkus,
  listSkus,
  recalcOperational,
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

type ScheduleRow = NonNullable<ReplenishmentPlan["recommendations"]>[number];

type PoModalContext = {
  orderDate: string;
  suggestedQty: number;
  zone: string;
  rowDateLabel?: string;
};

function BufferPositionBar({
  tor,
  toy,
  tog,
  nfe,
}: {
  tor: number;
  toy: number;
  tog: number;
  nfe: number;
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
          title={`NFE ${nfe.toFixed(0)}`}
        />
      </div>
      <p className="text-center text-xs text-slate-400">
        Current NFE:{" "}
        <span className="font-mono font-semibold text-amber-300">{nfe.toFixed(0)}</span>
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
  const [poModalOpen, setPoModalOpen] = useState(false);
  const [poModalContext, setPoModalContext] = useState<PoModalContext | null>(null);
  const [poQtyInput, setPoQtyInput] = useState("");
  const [poOrderDate, setPoOrderDate] = useState("");
  const [forceCreatePo, setForceCreatePo] = useState(false);
  const [poSubmitting, setPoSubmitting] = useState(false);

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

  const op = plan?.operational;
  const currentNfe = op?.nfe ?? todayRow?.nfe ?? 0;
  const todayOrderQty = op?.suggested_order_qty ?? todayRow?.order_qty ?? 0;
  const todayZone = normZone(op?.zone ?? todayRow?.zone);

  const tor = plan?.tor ?? 0;
  const toy = plan?.toy ?? 0;
  const tog = plan?.tog ?? 0;

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

  const loadPlan = useCallback(async (sku: string, withRecalc = false) => {
    if (!sku.trim()) return;
    setLoading(true);
    setErr(null);
    try {
      if (withRecalc) {
        await recalcOperational(sku);
      }
      const p = await getReplenishmentPlan(sku);
      setPlan(p);
      setPage(1);
      const d = await getDashboardSummary();
      setDash(d);
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
      "type,sku,date,qty,nfe,zone,unit,po_id,status,expected_receipt",
      ...plan.recommendations
        .filter((r) => Number(r.order_qty) > 0)
        .map(
          (r) =>
            `suggested,${plan.sku},${r.date ?? ""},${r.order_qty},${r.nfe},${r.zone ?? ""},${unit},,,`,
        ),
      ...(plan.operational?.confirmed_pos ?? []).map(
        (p) =>
          `confirmed,${plan.sku},${p.order_date ?? ""},${p.qty},,,${p.unit ?? unit},${p.id},confirmed,${p.expected_receipt_date ?? ""}`,
      ),
    ];
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `po-${plan.sku}-${plan.today_date ?? "export"}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    setPoNotice("PO export downloaded (suggested + confirmed rows).");
  };

  const openCreatePoModal = (ctx?: Partial<PoModalContext>) => {
    if (!plan) return;
    const orderDate =
      ctx?.orderDate ?? plan.today_date ?? new Date().toISOString().slice(0, 10);
    const suggestedQty = ctx?.suggestedQty ?? todayOrderQty;
    const qty = suggestedQty > 0 ? Math.ceil(suggestedQty) : 0;
    setPoQtyInput(qty > 0 ? String(qty) : "");
    setPoOrderDate(orderDate);
    setPoModalContext({
      orderDate,
      suggestedQty,
      zone: ctx?.zone ?? todayZone,
      rowDateLabel: ctx?.rowDateLabel,
    });
    setForceCreatePo(false);
    setPoModalOpen(true);
  };

  const openCreatePoModalFromRow = (row: ScheduleRow) => {
    const zone = normZone(row.zone);
    if (zone !== "RED" && zone !== "YELLOW") return;
    openCreatePoModal({
      orderDate: row.date ?? plan?.today_date ?? "",
      suggestedQty: Number(row.order_qty) || 0,
      zone,
      rowDateLabel: row.date ? fmtDateDdMmYy(row.date) : undefined,
    });
  };

  const modalSuggestedQty = poModalContext?.suggestedQty ?? todayOrderQty;

  const submitCreatePo = async () => {
    if (!plan || poSubmitting) return;
    const qty = Number(poQtyInput);
    if (!Number.isFinite(qty) || qty <= 0) {
      setPoNotice("Enter a valid order quantity greater than zero.");
      return;
    }
    if (modalSuggestedQty <= 0 && !forceCreatePo) {
      setPoNotice("No suggested order for this row. Check “Force create” to proceed anyway.");
      return;
    }

    setPoSubmitting(true);
    setPoNotice(null);
    setErr(null);
    try {
      const draft = await createPurchaseOrder({
        sku: plan.sku,
        qty,
        order_date: poOrderDate || plan.today_date || undefined,
        notes: "Created from Replenishment",
      });
      const result = await confirmPurchaseOrder(draft.id);
      setPoModalOpen(false);
      setPoNotice(
        `PO #${result.po.id} confirmed for ${qty.toFixed(0)}. NFE updated to ${result.recalc.nfe.toFixed(0)} (${result.recalc.zone} zone).`,
      );
      await loadPlan(plan.sku, false);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setPoNotice(msg.includes("already exists") ? `${msg} Cancel or receive the existing PO first.` : msg);
    } finally {
      setPoSubmitting(false);
    }
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
        </div>
      </div>

      {poModalOpen && plan ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="po-modal-title"
        >
          <div className="w-full max-w-md rounded-2xl border border-slate-700 bg-slate-900 p-6 shadow-2xl">
            <h2 id="po-modal-title" className="text-lg font-bold text-white">
              Confirm purchase order
            </h2>
            <p className="mt-2 text-sm text-slate-400">
              SKU <span className="font-mono text-slate-200">{plan.sku}</span>
            </p>
            {poModalContext?.rowDateLabel ? (
              <p className="mt-1 text-sm text-slate-400">
                Schedule row{" "}
                <span className="font-mono text-slate-200">{poModalContext.rowDateLabel}</span>
                {" · "}
                <span
                  className={
                    poModalContext.zone === "RED"
                      ? "font-semibold text-red-300"
                      : "font-semibold text-amber-300"
                  }
                >
                  {poModalContext.zone} zone
                </span>
              </p>
            ) : null}
            <div className="mt-4">
              <label htmlFor="po-order-date" className="block text-xs text-slate-500 mb-1">
                Order date
              </label>
              <input
                id="po-order-date"
                type="date"
                value={poOrderDate}
                onChange={(e) => setPoOrderDate(e.target.value)}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
              />
              {plan.today_date ? (
                <p className="mt-1 text-[11px] text-slate-500">
                  Buffer window starts: {fmtDateDdMmYy(plan.today_date)}
                </p>
              ) : null}
            </div>
            <div className="mt-4">
              <label className="block text-xs text-slate-500 mb-1">Order quantity</label>
              <input
                type="number"
                min={1}
                step={1}
                value={poQtyInput}
                onChange={(e) => setPoQtyInput(e.target.value)}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-white"
              />
              {modalSuggestedQty > 0 ? (
                <p className="mt-1 text-[11px] text-slate-500">
                  Suggested: {modalSuggestedQty.toFixed(0)}
                </p>
              ) : null}
            </div>
            {modalSuggestedQty <= 0 ? (
              <label className="mt-3 flex items-center gap-2 text-xs text-amber-200">
                <input
                  type="checkbox"
                  checked={forceCreatePo}
                  onChange={(e) => setForceCreatePo(e.target.checked)}
                  className="rounded border-slate-600"
                />
                Force create (no suggested qty for this row)
              </label>
            ) : null}
            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                disabled={poSubmitting}
                onClick={() => setPoModalOpen(false)}
                className="rounded-lg border border-slate-600 px-4 py-2 text-sm text-slate-300 hover:bg-slate-800"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={poSubmitting}
                onClick={() => void submitCreatePo()}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-500 disabled:opacity-50"
              >
                {poSubmitting ? "Confirming…" : "Create & confirm PO"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {poNotice ? (
        <div
          className={`rounded-lg border px-4 py-2 text-sm ${
            poNotice.toLowerCase().includes("confirmed")
              ? "border-emerald-500/40 bg-emerald-950/30 text-emerald-200"
              : "border-indigo-500/40 bg-indigo-950/30 text-indigo-200"
          }`}
        >
          {poNotice}
          <button
            type="button"
            className="ml-3 text-xs opacity-70 hover:opacity-100"
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
              ? `${plan.adu.toFixed(2)}/day`
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
              ? Number(selectedSkuMeta.Total_Demand).toLocaleString("en-US", { maximumFractionDigits: 0 })
              : "—"
          }
        />
        <button
          type="button"
          disabled={!selectedSku || loading}
          onClick={() => void loadPlan(selectedSku, true)}
          className="rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-sm text-slate-200 hover:bg-slate-700 disabled:opacity-40"
          title="Recalc NFE and refresh"
        >
          {loading ? "…" : "↻"} Recalc &amp; refresh
        </button>
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
                  <th className="px-5 py-3 font-medium text-right">Order qty</th>
                  <th className="px-5 py-3 font-medium text-right">NFE</th>
                  <th className="px-5 py-3 font-medium text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {!plan ? (
                  <tr>
                    <td colSpan={4} className="px-5 py-10 text-center text-slate-500">
                      {loading ? "Loading plan…" : "No active buffer — run pipeline in Analytics."}
                    </td>
                  </tr>
                ) : pagedRows.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-5 py-10 text-center text-slate-500">
                      No rows for this zone filter.
                    </td>
                  </tr>
                ) : (
                  pagedRows.map((r, idx) => {
                    const isToday = r.date === plan.today_date;
                    const rowZone = normZone(r.zone);
                    const showPoAction = rowZone === "RED" || rowZone === "YELLOW";
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
                            {Number(r.nfe).toFixed(0)}
                            <span
                              className={`rounded border px-1.5 py-0.5 text-[10px] font-bold ${zoneStyle(r.zone ?? "")}`}
                            >
                              {normZone(r.zone) || "—"}
                            </span>
                          </span>
                        </td>
                        <td className="px-5 py-3 text-right">
                          {showPoAction ? (
                            <button
                              type="button"
                              disabled={poSubmitting}
                              onClick={() => openCreatePoModalFromRow(r)}
                              className={`rounded-lg px-2.5 py-1.5 text-[11px] font-semibold text-white shadow-sm disabled:opacity-40 ${
                                rowZone === "RED"
                                  ? "bg-red-600 hover:bg-red-500"
                                  : "bg-amber-600 hover:bg-amber-500"
                              }`}
                              title={`Create PO for ${fmtDateDdMmYy(r.date)} (${rowZone} zone)`}
                            >
                              Create PO
                            </button>
                          ) : (
                            <span className="text-xs text-slate-600">—</span>
                          )}
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
                  <ZoneRangeRow color="emerald" label="Green" from={toy} to={tog} />
                  <ZoneRangeRow color="amber" label="Yellow" from={tor} to={toy} />
                  <ZoneRangeRow color="red" label="Red" from={0} to={tor} />
                </div>

                <BufferPositionBar tor={tor} toy={toy} tog={tog} nfe={currentNfe} />

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
                        {k === "NFE" ? Number(v).toFixed(0) : Number(v).toFixed(2)}
                      </dd>
                    </div>
                  ))}
                </dl>
              </div>
            )}
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

function ZoneRangeRow({
  color,
  label,
  from,
  to,
}: {
  color: "red" | "amber" | "emerald";
  label: string;
  from: number;
  to: number;
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
        {from.toFixed(0)} – {to.toFixed(0)}
      </span>
    </div>
  );
}
