"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  createDemandRow,
  demandTemplateUrl,
  exportDemandUrl,
  getDemandSummary,
  listDemandRows,
  listMasterSkus,
  updateDemandRow,
  uploadDemandExcel,
  validateDemandExcel,
  type DemandRow,
  type DemandSummary,
  type MasterSku,
} from "@/lib/api";

const PAGE_SIZE = 10;
const LAST_UPLOAD_KEY = "ddmrp_demand_last_upload";

type LastUploadMeta = {
  at: string;
  fileName: string;
  rows: number;
  inserted: number;
  updated: number;
  skipped?: number;
  status: string;
};

type DemandValidation = {
  ok?: boolean;
  error?: string;
  total_rows?: number;
  valid_rows?: number;
  error_rows?: number;
  unique_skus?: number;
  duplicate_rows_in_file?: number;
  errors?: Array<{ row?: unknown; message?: unknown }>;
  preview?: unknown[];
};

function groupBadgeClass(group: string): string {
  const g = group.trim().toLowerCase();
  const palettes = [
    "bg-emerald-500/20 text-emerald-300 border-emerald-500/40",
    "bg-sky-500/20 text-sky-300 border-sky-500/40",
    "bg-amber-500/20 text-amber-300 border-amber-500/40",
    "bg-rose-500/20 text-rose-300 border-rose-500/40",
    "bg-violet-500/20 text-violet-300 border-violet-500/40",
    "bg-orange-500/20 text-orange-300 border-orange-500/40",
  ];
  let h = 0;
  for (let i = 0; i < g.length; i++) h = (h * 31 + g.charCodeAt(i)) >>> 0;
  return palettes[h % palettes.length];
}

function formatIntId(n: number): string {
  return Math.round(n).toLocaleString("en-US", { maximumFractionDigits: 0 });
}

function formatMonthYear(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "short", year: "numeric" });
}

function formatDateShort(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso.includes("T") ? iso : `${iso}T12:00:00`);
  if (Number.isNaN(d.getTime())) {
    const m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(iso.trim());
    if (m) return iso.trim();
    return iso;
  }
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yy = String(d.getFullYear() % 100).padStart(2, "0");
  return `${dd}/${mm}/${yy}`;
}

function daysAgoLabel(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso + "T12:00:00");
  if (Number.isNaN(d.getTime())) return "";
  const diff = Date.now() - d.getTime();
  const days = Math.floor(diff / (86400 * 1000));
  if (days < 0) return "";
  if (days === 0) return "today";
  return `${days} days ago`;
}

function readLastUpload(): LastUploadMeta | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(LAST_UPLOAD_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as LastUploadMeta;
  } catch {
    return null;
  }
}

function writeLastUpload(m: LastUploadMeta) {
  try {
    localStorage.setItem(LAST_UPLOAD_KEY, JSON.stringify(m));
  } catch {
    /* ignore */
  }
}

type DatePreset = "all" | "7d" | "30d" | "90d";

export default function MasterDemandPage() {
  const [summary, setSummary] = useState<DemandSummary | null>(null);
  const [rows, setRows] = useState<DemandRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [listBusy, setListBusy] = useState(false);

  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [datePreset, setDatePreset] = useState<DatePreset>("all");
  const dateRange = useMemo(() => {
    if (datePreset === "all") return {};
    const end = new Date();
    const start = new Date();
    const back = datePreset === "7d" ? 7 : datePreset === "30d" ? 30 : 90;
    start.setDate(end.getDate() - back);
    return {
      from: start.toISOString().slice(0, 10),
      to: end.toISOString().slice(0, 10),
    };
  }, [datePreset]);
  const [groupFilter, setGroupFilter] = useState("__all__");
  const [promoOnly, setPromoOnly] = useState(false);

  const [uploadBusy, setUploadBusy] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [validation, setValidation] = useState<DemandValidation | null>(null);
  const [saveMode, setSaveMode] = useState<"insert_only" | "upsert">("insert_only");
  const [lastUpload, setLastUpload] = useState<LastUploadMeta | null>(null);

  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [lastExportAt, setLastExportAt] = useState<string | null>(null);

  const [masterSkus, setMasterSkus] = useState<MasterSku[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingRow, setEditingRow] = useState<DemandRow | null>(null);
  const [modalSku, setModalSku] = useState("");
  const [modalDate, setModalDate] = useState("");
  const [modalDemand, setModalDemand] = useState("");
  const [modalPromo, setModalPromo] = useState("");
  const [modalErr, setModalErr] = useState<string | null>(null);
  const [modalBusy, setModalBusy] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    listMasterSkus()
      .then((d) => setMasterSkus(d.skus ?? []))
      .catch(() => setMasterSkus([]));
  }, []);

  const openNewDemandModal = () => {
    setEditingRow(null);
    setModalSku("");
    setModalDate(new Date().toISOString().slice(0, 10));
    setModalDemand("");
    setModalPromo("");
    setModalErr(null);
    setModalOpen(true);
  };

  const openEditDemandModal = (row: DemandRow) => {
    setEditingRow(row);
    setModalSku(row.sku);
    setModalDate(row.date ? row.date.slice(0, 10) : "");
    setModalDemand(String(row.demand ?? ""));
    // Stored as a fraction (0–1); this field takes a 0–100 percent input.
    setModalPromo(row.promo_discount ? String(row.promo_discount * 100) : "");
    setModalErr(null);
    setModalOpen(true);
  };

  const submitDemandModal = async () => {
    setModalErr(null);
    const sku = modalSku.trim();
    if (!sku) {
      setModalErr("SKU is required.");
      return;
    }
    if (!modalDate) {
      setModalErr("Date is required.");
      return;
    }
    const demandN = Number(modalDemand);
    if (!Number.isFinite(demandN) || demandN < 0) {
      setModalErr("Demand must be a number ≥ 0.");
      return;
    }
    const promoN = modalPromo.trim() === "" ? 0 : Number(modalPromo) / 100;
    setModalBusy(true);
    try {
      if (editingRow) {
        await updateDemandRow(editingRow.id, {
          sku,
          date: modalDate,
          demand: demandN,
          promo_discount: promoN,
        });
        setMsg(`Demand record #${editingRow.id} updated.`);
      } else {
        const created = await createDemandRow({
          sku,
          date: modalDate,
          demand: demandN,
          promo_discount: promoN,
        });
        setMsg(`Demand record #${created.id} added for SKU ${sku}.`);
      }
      setModalOpen(false);
      await loadSummary();
      await loadTable();
    } catch (e: unknown) {
      setModalErr(e instanceof Error ? e.message : String(e));
    } finally {
      setModalBusy(false);
    }
  };

  const loadSummary = useCallback(async () => {
    try {
      const s = await getDemandSummary();
      setSummary(s);
    } catch {
      setSummary(null);
    }
  }, []);

  const loadTable = useCallback(async () => {
    setListBusy(true);
    try {
      const offset = (page - 1) * PAGE_SIZE;
      const r = await listDemandRows({
        limit: PAGE_SIZE,
        offset,
        search: debouncedSearch || undefined,
        dateFrom: dateRange.from,
        dateTo: dateRange.to,
        group: groupFilter !== "__all__" ? groupFilter : undefined,
        promoOnly,
      });
      setRows(r.rows ?? []);
      setTotal(r.total ?? 0);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setListBusy(false);
    }
  }, [page, debouncedSearch, dateRange.from, dateRange.to, groupFilter, promoOnly]);

  useEffect(() => {
    setLastUpload(readLastUpload());
  }, []);

  useEffect(() => {
    void loadSummary();
  }, [loadSummary]);

  useEffect(() => {
    void loadTable();
  }, [loadTable]);

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, datePreset, groupFilter, promoOnly]);

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);

  useEffect(() => {
    if (page > pageCount) setPage(pageCount);
  }, [page, pageCount]);

  const maxDemandOnPage = useMemo(
    () => Math.max(1, ...rows.map((r) => Number(r.demand) || 0)),
    [rows]
  );

  const onPickFile = async (f: File | null) => {
    if (!f) return;
    setFile(f);
    setValidation(null);
    setErr(null);
    setMsg(null);
    setUploadBusy(true);
    try {
      const r = (await validateDemandExcel(f)) as DemandValidation;
      setValidation(r);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setUploadBusy(false);
    }
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const f = e.dataTransfer.files?.[0];
    if (f) void onPickFile(f);
  };

  const onCommit = async () => {
    if (!file) return;
    const validRows = Number(validation?.valid_rows ?? 0);
    if (!validRows) return;

    setErr(null);
    setMsg(null);
    setUploadBusy(true);
    try {
      const r = await uploadDemandExcel(file, { mode: saveMode });
      const meta: LastUploadMeta = {
        at: new Date().toISOString(),
        fileName: file.name,
        rows: r.rows_in_file,
        inserted: r.inserted,
        updated: r.updated,
        skipped: r.skipped,
        status: "Success",
      };
      writeLastUpload(meta);
      setLastUpload(meta);
      setMsg(
        `Demand upload: +${r.inserted} new, ${r.updated} updated` +
          (r.skipped ? `, ${r.skipped} skipped` : "") +
          ` (${r.rows_in_file} rows).`
      );
      setValidation(null);
      setFile(null);
      await loadSummary();
      await loadTable();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setUploadBusy(false);
    }
  };

  const v = validation;
  const validN = Number(v?.valid_rows ?? 0);
  const canSave = Boolean(file && validN > 0 && !uploadBusy);

  const periodSubtitle =
    summary?.date_min && summary?.date_max
      ? `${formatMonthYear(new Date(summary.date_min))} – ${formatMonthYear(new Date(summary.date_max))}`
      : "—";

  const groupOptions = summary?.demand_groups ?? [];

  const from = total === 0 ? 0 : (safePage - 1) * PAGE_SIZE + 1;
  const to = Math.min(safePage * PAGE_SIZE, total);

  return (
    <div className="space-y-6 animate-in fade-in zoom-in duration-500 pb-10">
      <div className="flex flex-col gap-4 border-b border-slate-800 pb-5 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight text-white">Master Demand</h1>
          <p className="text-sm text-slate-400 mt-1 max-w-2xl">
            Upload and manage daily demand per SKU for DDMRP buffer calculation.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 shrink-0">
          <a
            href={demandTemplateUrl()}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-600 bg-slate-800/80 px-4 py-2 text-sm font-medium text-slate-100 hover:bg-slate-700"
          >
            <span aria-hidden>⬇</span> Template Excel
          </a>
          <a
            href={exportDemandUrl()}
            onClick={() => setLastExportAt(new Date().toLocaleString())}
            className="inline-flex items-center gap-2 rounded-lg border border-indigo-500/50 bg-indigo-600/90 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500"
          >
            <span aria-hidden>⬇</span> Export Demand
          </a>
          <button
            type="button"
            onClick={openNewDemandModal}
            className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500"
          >
            <span aria-hidden>+</span> New demand
          </button>
        </div>
      </div>

      {msg && (
        <div className="rounded-xl border border-emerald-900/50 bg-emerald-950/20 text-emerald-200 px-4 py-3 text-sm">
          {msg}
        </div>
      )}
      {err && (
        <div className="rounded-xl border border-red-900/50 bg-red-950/30 text-red-200 px-4 py-3 text-sm">
          {err}
        </div>
      )}
      {lastExportAt && (
        <div className="rounded-xl border border-slate-800 bg-slate-900/40 text-slate-300 px-4 py-3 text-xs">
          Last export: {lastExportAt}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-4 shadow-lg">
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Total record</p>
          <p className="mt-2 text-2xl font-bold text-white tabular-nums">
            {summary ? formatIntId(summary.total_records) : "—"}
          </p>
          <p className="mt-1 text-xs text-slate-500">demand records stored</p>
        </div>
        <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-4 shadow-lg">
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Data period</p>
          <p className="mt-2 text-2xl font-bold text-white tabular-nums">
            {summary?.days_span != null ? `${summary.days_span}` : "—"}{" "}
            <span className="text-base font-semibold text-slate-400">days</span>
          </p>
          <p className="mt-1 text-xs text-slate-500 truncate" title={periodSubtitle}>
            {periodSubtitle}
          </p>
        </div>
        <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-4 shadow-lg">
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">SKUs covered</p>
          <p className="mt-2 text-2xl font-bold text-white tabular-nums">
            {summary ? `${summary.sku_with_demand} / ${summary.sku_active_master}` : "—"}
          </p>
          <p className="mt-1 text-xs text-slate-500">active SKUs in master</p>
        </div>
        <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-4 shadow-lg">
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Last upload</p>
          <p
            className={`mt-2 text-lg font-bold ${
              lastUpload?.status === "Success" || lastUpload?.status === "Berhasil" ? "text-emerald-400" : "text-slate-400"
            }`}
          >
            {lastUpload?.status ?? "—"}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {lastUpload
              ? `${new Date(lastUpload.at).toLocaleDateString("en-US")} · ${formatIntId(lastUpload.rows)} rows`
              : "No history on this device yet"}
          </p>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5 md:p-6">
        <h2 className="text-sm font-bold text-slate-300 uppercase tracking-wide mb-4">Upload flow</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-2">
          {[
            {
              step: 1,
              title: "Choose Excel / CSV file",
              body: (
                <div
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={onDrop}
                  className="mt-3 rounded-xl border-2 border-dashed border-slate-600 bg-slate-950/50 px-3 py-6 text-center"
                >
                  <p className="text-2xl text-slate-500" aria-hidden>
                    ↑
                  </p>
                  <p className="text-xs text-slate-400 mt-2">
                    Drag &amp; drop here or click to choose a file{" "}
                    <span className="text-slate-300">.xlsx, .xls, .csv</span>
                    <span className="block text-[11px] text-slate-600 mt-1">Max. 10 MB (recommended)</span>
                  </p>
                  <label className="mt-3 inline-block cursor-pointer rounded-lg bg-indigo-600 px-4 py-2 text-xs font-semibold text-white hover:bg-indigo-500">
                    {uploadBusy ? "Processing…" : "Choose file"}
                    <input
                      type="file"
                      className="hidden"
                      accept=".xlsx,.xls,.csv"
                      disabled={uploadBusy}
                      onChange={(e) => void onPickFile(e.target.files?.[0] ?? null)}
                    />
                  </label>
                  {file && (
                    <p className="mt-2 text-[11px] text-emerald-400 truncate" title={file.name}>
                      {file.name}
                    </p>
                  )}
                  <p className="mt-4 text-left text-[10px] font-semibold uppercase text-slate-500">
                    Required columns
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {[
                      { col: "ID Item", required: true },
                      { col: "Nama Item", required: false },
                      { col: "Date", required: true },
                      { col: "Demand ", required: true },
                      { col: "Sales Price Price After Discont", required: false },
                      { col: "Promo Discount", required: false },
                      { col: "IsPromo", required: false },
                      { col: "PromoDiscountPct", required: false },
                      { col: "PromoType", required: false },
                    ].map(({ col, required }) => (
                      <span
                        key={col}
                        className={`rounded-md border px-2 py-0.5 text-[10px] ${
                          required
                            ? "border-sky-600/60 bg-sky-900/30 text-sky-300"
                            : "border-slate-700 bg-slate-900 text-slate-400"
                        }`}
                        title={required ? "Required" : "Optional"}
                      >
                        {col}
                      </span>
                    ))}
                  </div>
                  <p className="mt-2 text-[10px] text-slate-600">
                    Blue columns = required. Item name &amp; group come from Master SKU when empty.
                  </p>
                </div>
              ),
            },
            {
              step: 2,
              title: "Validation & preview",
              body: (
                <div className="mt-3 space-y-3 text-sm">
                  <div className="grid grid-cols-2 gap-2">
                    <div className="rounded-lg border border-slate-800 bg-slate-950/50 p-2">
                      <p className="text-[10px] text-slate-500">Valid rows</p>
                      <p className="text-lg font-semibold text-emerald-400 tabular-nums">
                        {v ? String(v.valid_rows ?? 0) : "—"}
                      </p>
                    </div>
                    <div className="rounded-lg border border-slate-800 bg-slate-950/50 p-2">
                      <p className="text-[10px] text-slate-500">Error rows</p>
                      <p className="text-lg font-semibold text-red-400 tabular-nums">
                        {v ? String(v.error_rows ?? 0) : "—"}
                      </p>
                    </div>
                    <div className="rounded-lg border border-slate-800 bg-slate-950/50 p-2">
                      <p className="text-[10px] text-slate-500">SKUs recognized</p>
                      <p className="text-lg font-semibold text-sky-400 tabular-nums">
                        {v ? String(v.unique_skus ?? 0) : "—"}
                      </p>
                    </div>
                    <div className="rounded-lg border border-slate-800 bg-slate-950/50 p-2">
                      <p className="text-[10px] text-slate-500">Duplicates</p>
                      <p className="text-lg font-semibold text-amber-400 tabular-nums">
                        {v ? String(v.duplicate_rows_in_file ?? 0) : "—"}
                      </p>
                    </div>
                  </div>
                  {!v && (
                    <p className="text-xs text-slate-500">
                      Upload a file first. Validation results will appear here.
                    </p>
                  )}
                  {v?.ok === false && (
                    <p className="text-xs text-red-300">{String(v.error ?? "Validation failed")}</p>
                  )}
                </div>
              ),
            },
            {
              step: 3,
              title: "Confirm & save",
              body: (
                <div className="mt-3 space-y-3 text-sm">
                  <ul className="space-y-1.5 text-xs text-slate-400">
                    <li className="flex justify-between gap-2">
                      <span>File</span>
                      <span className="text-slate-200 truncate max-w-[10rem]">{file?.name ?? "—"}</span>
                    </li>
                    <li className="flex justify-between gap-2">
                      <span>Total rows</span>
                      <span className="text-slate-200">{v ? String(v.total_rows ?? 0) : "—"}</span>
                    </li>
                    <li className="flex justify-between gap-2">
                      <span>Will be saved</span>
                      <span className="text-emerald-400 font-medium">{String(v?.valid_rows ?? 0)}</span>
                    </li>
                    <li className="flex justify-between gap-2">
                      <span>Will be skipped</span>
                      <span className="text-amber-300 font-medium">{String(v?.error_rows ?? 0)}</span>
                    </li>
                  </ul>
                  <div>
                    <p className="text-[10px] font-semibold uppercase text-slate-500 mb-2">Save mode</p>
                    <label className="flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-2 cursor-pointer">
                      <input
                        type="radio"
                        name="saveMode"
                        checked={saveMode === "insert_only"}
                        onChange={() => setSaveMode("insert_only")}
                      />
                      <span className="text-xs text-slate-300">Insert new rows only (skip existing date+SKU)</span>
                    </label>
                    <label className="mt-2 flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-2 cursor-pointer">
                      <input
                        type="radio"
                        name="saveMode"
                        checked={saveMode === "upsert"}
                        onChange={() => setSaveMode("upsert")}
                      />
                      <span className="text-xs text-slate-300">Overwrite existing rows (update demand)</span>
                    </label>
                  </div>
                  <button
                    type="button"
                    disabled={!canSave}
                    onClick={() => void onCommit()}
                    className="w-full rounded-xl bg-indigo-600 py-3 text-sm font-bold text-white shadow-lg hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Save to database
                  </button>
                </div>
              ),
            },
          ].map((block) => (
            <div
              key={block.step}
              className="relative rounded-xl border border-slate-800 bg-slate-950/30 p-4 md:border-slate-800"
            >
              <div className="flex items-center gap-2">
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-indigo-600 text-sm font-bold text-white">
                  {block.step}
                </span>
                <h3 className="text-sm font-bold text-white">{block.title}</h3>
              </div>
              {block.body}
            </div>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div className="relative flex-1 max-w-md">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500">🔍</span>
          <input
            type="search"
            placeholder="Search SKU, name…"
            className="w-full rounded-lg border border-slate-700 bg-slate-900 py-2.5 pl-10 pr-3 text-sm text-white placeholder:text-slate-600"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          <select
            className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2.5 text-sm text-white"
            value={datePreset}
            onChange={(e) => setDatePreset(e.target.value as DatePreset)}
          >
            <option value="all">Date: All</option>
            <option value="7d">Last 7 days</option>
            <option value="30d">Last 30 days</option>
            <option value="90d">Last 90 days</option>
          </select>
          <select
            className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2.5 text-sm text-white"
            value={groupFilter}
            onChange={(e) => setGroupFilter(e.target.value)}
          >
            <option value="__all__">Group: All</option>
            {groupOptions.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => setPromoOnly((p) => !p)}
            className={`rounded-lg border px-3 py-2.5 text-sm font-medium transition-colors ${
              promoOnly
                ? "border-amber-500/60 bg-amber-600/20 text-amber-200"
                : "border-slate-700 bg-slate-900 text-slate-400 hover:text-white"
            }`}
          >
            Promo only
          </button>
          <span className="text-xs text-slate-500 tabular-nums lg:ml-2">
            Showing {listBusy ? "…" : total}
          </span>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-800 bg-slate-900 shadow-xl overflow-hidden">
        <div className="border-b border-slate-800 px-4 py-3 sm:px-6">
          <h2 className="text-lg font-bold text-white">Recent demand list</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Daily demand per SKU — newest first
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-slate-300">
            <thead className="bg-slate-950 text-slate-500 text-xs uppercase tracking-wide border-b border-slate-800">
              <tr>
                <th className="px-4 py-3 font-medium">Date</th>
                <th className="px-4 py-3 font-medium">SKU / Nama</th>
                <th className="px-4 py-3 font-medium">Group</th>
                <th className="px-4 py-3 font-medium">Demand</th>
                <th className="px-4 py-3 font-medium">Promo</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {rows.length === 0 && !listBusy ? (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center text-slate-500">
                    No demand data matches the current filters.
                  </td>
                </tr>
              ) : (
                rows.map((r) => {
                  const g = String(r.group ?? "").trim() || "—";
                  const pct = Math.min(100, (Number(r.demand) / maxDemandOnPage) * 100);
                  const promo = Number(r.promo_discount ?? 0);
                  return (
                    <tr
                      key={r.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => openEditDemandModal(r)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          openEditDemandModal(r);
                        }
                      }}
                      className="cursor-pointer hover:bg-slate-800/40"
                      title="Click to edit"
                    >
                      <td className="px-4 py-3 align-top">
                        <div className="text-white font-medium">{formatDateShort(r.date)}</div>
                        <div className="text-[11px] text-slate-600">{daysAgoLabel(r.date)}</div>
                      </td>
                      <td className="px-4 py-3 align-top">
                        <div className="font-semibold text-white">{r.sku}</div>
                        <div className="text-xs text-slate-500 truncate max-w-[200px]">
                          {r.nama_item ?? "—"}
                        </div>
                      </td>
                      <td className="px-4 py-3 align-top">
                        {g === "—" ? (
                          "—"
                        ) : (
                          <span
                            className={`inline-flex rounded-md border px-2 py-0.5 text-xs font-semibold ${groupBadgeClass(g)}`}
                          >
                            {g}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 align-top">
                        <div className="flex items-center gap-2">
                          <div className="h-2 w-16 overflow-hidden rounded-full bg-slate-800">
                            <div
                              className="h-full rounded-full bg-emerald-500"
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                          <span className="tabular-nums text-emerald-300 font-medium">
                            {formatIntId(Number(r.demand))}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3 align-top">
                        {promo > 0 ? (
                          <span className="inline-flex rounded-md border border-amber-500/40 bg-amber-500/15 px-2 py-0.5 text-xs font-bold text-amber-300">
                            {(promo <= 1 ? promo * 100 : promo).toFixed(0)}%
                          </span>
                        ) : (
                          <span className="text-slate-600">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        <div className="flex flex-col gap-2 border-t border-slate-800 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6 text-xs text-slate-500">
          <span>
            Showing {from}-{to} of {total} records
            {summary ? ` (${formatIntId(summary.total_records)} total)` : ""}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={safePage <= 1 || listBusy}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="rounded border border-slate-700 px-2 py-1 text-slate-300 hover:bg-slate-800 disabled:opacity-40"
            >
              ←
            </button>
            <span className="tabular-nums text-slate-400">
              Page {safePage} / {pageCount}
            </span>
            <button
              type="button"
              disabled={safePage >= pageCount || listBusy}
              onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
              className="rounded border border-slate-700 px-2 py-1 text-slate-300 hover:bg-slate-800 disabled:opacity-40"
            >
              →
            </button>
          </div>
        </div>
      </div>

      {modalOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="demand-modal-title"
          onClick={() => setModalOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-slate-700 bg-slate-900 p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="demand-modal-title" className="text-lg font-bold text-white">
              {editingRow ? `Edit demand #${editingRow.id}` : "New demand"}
            </h2>

            {modalErr ? (
              <div className="mt-3 rounded-lg border border-red-900/50 bg-red-950/30 px-3 py-2 text-xs text-red-200">
                {modalErr}
              </div>
            ) : null}

            <div className="mt-4">
              <label htmlFor="demand-sku" className="block text-xs text-slate-500 mb-1">
                SKU
              </label>
              <input
                id="demand-sku"
                list="demand-sku-options"
                value={modalSku}
                onChange={(e) => setModalSku(e.target.value)}
                placeholder="SKU code"
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
              />
              <datalist id="demand-sku-options">
                {masterSkus.map((s) => (
                  <option key={s.sku} value={s.sku}>
                    {s.nama_item ?? ""}
                  </option>
                ))}
              </datalist>
            </div>

            <div className="mt-4">
              <label htmlFor="demand-date" className="block text-xs text-slate-500 mb-1">
                Date
              </label>
              <input
                id="demand-date"
                type="date"
                value={modalDate}
                onChange={(e) => setModalDate(e.target.value)}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
              />
            </div>

            <div className="mt-4 grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="demand-qty" className="block text-xs text-slate-500 mb-1">
                  Demand
                </label>
                <input
                  id="demand-qty"
                  type="number"
                  min={0}
                  step={1}
                  value={modalDemand}
                  onChange={(e) => setModalDemand(e.target.value)}
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-white"
                />
              </div>
              <div>
                <label htmlFor="demand-promo" className="block text-xs text-slate-500 mb-1">
                  Promo discount (%)
                </label>
                <input
                  id="demand-promo"
                  type="number"
                  min={0}
                  max={100}
                  step={1}
                  value={modalPromo}
                  onChange={(e) => setModalPromo(e.target.value)}
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-white"
                />
              </div>
            </div>

            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                disabled={modalBusy}
                onClick={() => setModalOpen(false)}
                className="rounded-lg border border-slate-600 px-4 py-2 text-sm text-slate-300 hover:bg-slate-800"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={modalBusy}
                onClick={() => void submitDemandModal()}
                className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-50"
              >
                {modalBusy ? "Saving…" : editingRow ? "Save changes" : "Add demand"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
