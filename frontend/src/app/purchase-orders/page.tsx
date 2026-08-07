"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  cancelPurchaseOrder,
  confirmPurchaseOrder,
  getAutoReceiveStatus,
  listPurchaseOrders,
  listSkus,
  receivePurchaseOrder,
  triggerAutoReceiveDue,
  type AutoReceiveStatus,
  type PurchaseOrder,
  type SkuRow,
} from "@/lib/api";

const PAGE_SIZE = 10;

type StatusFilter = "ALL" | "draft" | "confirmed" | "received" | "cancelled";

const STATUS_TABS: { key: StatusFilter; label: string }[] = [
  { key: "ALL", label: "All" },
  { key: "draft", label: "Draft" },
  { key: "confirmed", label: "Confirmed (on order)" },
  { key: "received", label: "Received (stock)" },
  { key: "cancelled", label: "Cancelled" },
];

function fmtDateDdMmYy(iso: string | null | undefined): string {
  if (!iso) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (m) return `${m[3]}/${m[2]}/${m[1].slice(-2)}`;
  return iso;
}

function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-US", {
    day: "2-digit",
    month: "short",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function statusBadgeClass(status: string): string {
  switch (status) {
    case "draft":
      return "bg-slate-700/40 text-slate-300 border-slate-600";
    case "confirmed":
      return "bg-amber-500/20 text-amber-200 border-amber-500/40";
    case "received":
      return "bg-emerald-500/20 text-emerald-300 border-emerald-500/40";
    case "cancelled":
      return "bg-red-500/10 text-red-300/80 border-red-500/30";
    default:
      return "bg-slate-800/40 text-slate-400 border-slate-700";
  }
}

export default function PurchaseOrdersPage() {
  const [skuList, setSkuList] = useState<SkuRow[]>([]);
  const [skuFilter, setSkuFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("ALL");
  const [rows, setRows] = useState<PurchaseOrder[]>([]);
  const [total, setTotal] = useState(0);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [autoStatus, setAutoStatus] = useState<AutoReceiveStatus | null>(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const skuFilterTrimmed = skuFilter.trim();

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const offset = (page - 1) * PAGE_SIZE;
      const status = statusFilter === "ALL" ? undefined : statusFilter;
      const [listRes, draftC, confirmedC, receivedC, cancelledC, autoRes] = await Promise.all([
        listPurchaseOrders(skuFilterTrimmed || undefined, status, PAGE_SIZE, offset),
        listPurchaseOrders(skuFilterTrimmed || undefined, "draft", 1, 0),
        listPurchaseOrders(skuFilterTrimmed || undefined, "confirmed", 1, 0),
        listPurchaseOrders(skuFilterTrimmed || undefined, "received", 1, 0),
        listPurchaseOrders(skuFilterTrimmed || undefined, "cancelled", 1, 0),
        getAutoReceiveStatus().catch(() => null),
      ]);
      setRows(listRes.rows ?? []);
      setTotal(listRes.total ?? 0);
      setCounts({
        draft: draftC.total ?? 0,
        confirmed: confirmedC.total ?? 0,
        received: receivedC.total ?? 0,
        cancelled: cancelledC.total ?? 0,
      });
      setAutoStatus(autoRes);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [page, statusFilter, skuFilterTrimmed]);

  useEffect(() => {
    listSkus()
      .then((r) => setSkuList(r.skus ?? []))
      .catch(() => setSkuList([]));
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setPage(1);
  }, [statusFilter, skuFilterTrimmed]);

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const onOrderQtyForSku = useMemo(() => {
    if (!skuFilterTrimmed) return null;
    const confirmedRows = rows.filter((r) => r.status === "confirmed");
    if (confirmedRows.length === 0) return null;
    const unit = confirmedRows[0].unit;
    const sameUnit = confirmedRows.every((r) => r.unit === unit);
    const sum = confirmedRows.reduce((acc, r) => acc + Number(r.qty || 0), 0);
    return sameUnit ? `${sum.toFixed(0)} ${unit}` : `${sum.toFixed(0)} (mixed units)`;
  }, [rows, skuFilterTrimmed]);

  const runAction = async (fn: () => Promise<unknown>, successMsg: string, poId: number) => {
    setBusyId(poId);
    setErr(null);
    setNotice(null);
    try {
      await fn();
      setNotice(successMsg);
      await load();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  };

  const checkAutoReceiveNow = async () => {
    setChecking(true);
    setErr(null);
    setNotice(null);
    try {
      const result = await triggerAutoReceiveDue();
      setNotice(
        result.received > 0
          ? `Auto-receive: ${result.received} of ${result.checked} due PO(s) moved to stock.`
          : `Auto-receive: checked ${result.checked} due PO(s), none ready yet.`,
      );
      await load();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="space-y-5 animate-in fade-in duration-500">
      <div className="flex flex-col gap-4 border-b border-slate-800 pb-5 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white md:text-3xl">
            Purchase orders
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-400">
            POs created from Replenishment feed back into the buffer as open order (OP) once
            confirmed. When a PO&apos;s expected receipt date (order date + lead time) has passed,
            it is auto-received — quantity moves from open order into on-hand stock.
          </p>
        </div>
        <button
          type="button"
          disabled={checking}
          onClick={() => void checkAutoReceiveNow()}
          className="inline-flex items-center gap-2 rounded-lg border border-emerald-700/50 bg-emerald-950/30 px-4 py-2.5 text-sm font-semibold text-emerald-200 hover:bg-emerald-950/50 disabled:opacity-40"
        >
          <span aria-hidden>↻</span> {checking ? "Checking…" : "Check auto-receive now"}
        </button>
      </div>

      {notice ? (
        <div className="rounded-lg border border-emerald-500/40 bg-emerald-950/30 px-4 py-2 text-sm text-emerald-200">
          {notice}
          <button
            type="button"
            className="ml-3 text-xs opacity-70 hover:opacity-100"
            onClick={() => setNotice(null)}
          >
            Dismiss
          </button>
        </div>
      ) : null}

      {err ? (
        <div className="rounded-xl border border-red-900/50 bg-red-950/30 px-4 py-3 text-sm text-red-200">
          {err}
        </div>
      ) : null}

      {/* Auto-receive scheduler status */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-xl border border-slate-800 bg-slate-900/60 px-4 py-3 text-xs text-slate-400">
        <span className="flex items-center gap-1.5">
          <span
            className={`h-2 w-2 rounded-full ${autoStatus?.enabled ? "bg-emerald-500" : "bg-slate-600"}`}
          />
          Background job {autoStatus?.enabled ? "enabled" : "disabled"}
          {autoStatus?.enabled ? ` · runs every ${autoStatus.interval_minutes}m` : ""}
        </span>
        {autoStatus?.last_run_at ? (
          <span>Last run: {fmtDateTime(autoStatus.last_run_at)}</span>
        ) : null}
        {autoStatus ? (
          <span>
            Last sweep: {autoStatus.last_checked} checked / {autoStatus.last_received} received
          </span>
        ) : null}
      </div>

      {/* Status summary cards */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <SummaryCard title="Draft" value={counts.draft ?? 0} accent="slate" />
        <SummaryCard
          title="Confirmed"
          value={counts.confirmed ?? 0}
          subtitle="on order (OP)"
          accent="amber"
        />
        <SummaryCard
          title="Received"
          value={counts.received ?? 0}
          subtitle="in stock (OH)"
          accent="emerald"
        />
        <SummaryCard title="Cancelled" value={counts.cancelled ?? 0} accent="red" />
      </div>

      {onOrderQtyForSku ? (
        <div className="rounded-lg border border-amber-800/40 bg-amber-950/20 px-4 py-2 text-xs text-amber-200">
          Open order for <span className="font-mono">{skuFilterTrimmed}</span> on this page:{" "}
          <strong>{onOrderQtyForSku}</strong>
        </div>
      ) : null}

      {/* Filters */}
      <div className="flex flex-wrap items-end gap-4 rounded-xl border border-slate-800 bg-slate-900/60 p-4">
        <div>
          <label className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-slate-500">
            SKU
          </label>
          <input
            list="po-sku-options"
            value={skuFilter}
            onChange={(e) => setSkuFilter(e.target.value)}
            placeholder="All SKUs"
            className="min-w-[200px] rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
          />
          <datalist id="po-sku-options">
            {skuList.map((s) => (
              <option key={String(s["ID Item"])} value={String(s["ID Item"])} />
            ))}
          </datalist>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {STATUS_TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setStatusFilter(t.key)}
              className={`rounded-lg px-3 py-2 text-xs font-semibold transition-colors ${
                statusFilter === t.key
                  ? "bg-blue-600 text-white"
                  : "border border-slate-700 text-slate-300 hover:bg-slate-800"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900 shadow-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-800 bg-slate-950 text-xs uppercase tracking-wide text-slate-500">
                <th className="px-4 py-3 font-medium">ID</th>
                <th className="px-4 py-3 font-medium">SKU</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium text-right">Qty</th>
                <th className="px-4 py-3 font-medium">Order date</th>
                <th className="px-4 py-3 font-medium">Expected receipt</th>
                <th className="px-4 py-3 font-medium">Source</th>
                <th className="px-4 py-3 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-10 text-center text-slate-500">
                    {loading ? "Loading…" : "No purchase orders match this filter."}
                  </td>
                </tr>
              ) : (
                rows.map((po) => (
                  <tr key={po.id} className="hover:bg-slate-800/30">
                    <td className="px-4 py-3 font-mono text-slate-400">#{po.id}</td>
                    <td className="px-4 py-3 font-mono text-slate-200">{po.sku}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-block rounded border px-2 py-0.5 text-[11px] font-bold capitalize ${statusBadgeClass(po.status)}`}
                      >
                        {po.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums text-white">
                      {Number(po.qty).toFixed(0)} {po.unit}
                    </td>
                    <td className="px-4 py-3 text-slate-400">{fmtDateDdMmYy(po.order_date)}</td>
                    <td className="px-4 py-3 text-slate-400">
                      {fmtDateDdMmYy(po.expected_receipt_date)}
                    </td>
                    <td className="px-4 py-3 text-slate-500">{po.source}</td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1.5">
                        {po.status === "draft" ? (
                          <>
                            <button
                              type="button"
                              disabled={busyId === po.id}
                              onClick={() =>
                                void runAction(
                                  () => confirmPurchaseOrder(po.id),
                                  `PO #${po.id} confirmed.`,
                                  po.id,
                                )
                              }
                              className="rounded-lg bg-blue-600 px-2.5 py-1.5 text-[11px] font-semibold text-white hover:bg-blue-500 disabled:opacity-40"
                            >
                              Confirm
                            </button>
                            <button
                              type="button"
                              disabled={busyId === po.id}
                              onClick={() =>
                                void runAction(
                                  () => cancelPurchaseOrder(po.id),
                                  `PO #${po.id} cancelled.`,
                                  po.id,
                                )
                              }
                              className="rounded-lg border border-slate-600 px-2.5 py-1.5 text-[11px] font-semibold text-slate-300 hover:bg-slate-800 disabled:opacity-40"
                            >
                              Cancel
                            </button>
                          </>
                        ) : null}
                        {po.status === "confirmed" ? (
                          <>
                            <button
                              type="button"
                              disabled={busyId === po.id}
                              title="Manual override — normally handled automatically once expected receipt date passes"
                              onClick={() =>
                                void runAction(
                                  () => receivePurchaseOrder(po.id),
                                  `PO #${po.id} received — moved to stock.`,
                                  po.id,
                                )
                              }
                              className="rounded-lg bg-emerald-600 px-2.5 py-1.5 text-[11px] font-semibold text-white hover:bg-emerald-500 disabled:opacity-40"
                            >
                              Receive now
                            </button>
                            <button
                              type="button"
                              disabled={busyId === po.id}
                              onClick={() =>
                                void runAction(
                                  () => cancelPurchaseOrder(po.id),
                                  `PO #${po.id} cancelled.`,
                                  po.id,
                                )
                              }
                              className="rounded-lg border border-slate-600 px-2.5 py-1.5 text-[11px] font-semibold text-slate-300 hover:bg-slate-800 disabled:opacity-40"
                            >
                              Cancel
                            </button>
                          </>
                        ) : null}
                        {po.status === "received" || po.status === "cancelled" ? (
                          <span className="text-xs text-slate-600">—</span>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {pageCount > 1 ? (
          <div className="flex items-center justify-center gap-1 border-t border-slate-800 px-4 py-3">
            {Array.from({ length: Math.min(pageCount, 8) }, (_, i) => i + 1).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setPage(p)}
                className={`min-w-[2rem] rounded-lg px-2 py-1 text-xs font-semibold ${
                  page === p
                    ? "bg-blue-600 text-white"
                    : "text-slate-400 hover:bg-slate-800 hover:text-white"
                }`}
              >
                {p}
              </button>
            ))}
          </div>
        ) : null}
      </div>
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
  value: number;
  subtitle?: string;
  accent: "slate" | "amber" | "emerald" | "red";
}) {
  const valueColor =
    accent === "amber"
      ? "text-amber-400"
      : accent === "emerald"
        ? "text-emerald-400"
        : accent === "red"
          ? "text-red-400"
          : "text-white";
  const border =
    accent === "amber"
      ? "border-amber-900/30"
      : accent === "emerald"
        ? "border-emerald-900/30"
        : accent === "red"
          ? "border-red-900/30"
          : "border-slate-800";

  return (
    <div className={`rounded-xl border ${border} bg-slate-900/80 p-4`}>
      <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">{title}</p>
      <p className={`mt-1 text-2xl font-bold tabular-nums ${valueColor}`}>{value}</p>
      {subtitle ? <p className="mt-0.5 text-[11px] text-slate-500">{subtitle}</p> : null}
    </div>
  );
}
