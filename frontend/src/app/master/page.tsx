"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  exportMasterSkuUrl,
  getSkuGroups,
  masterSkuTemplateUrl,
  listMasterSkus,
  saveMasterSku,
  uploadMasterSkuExcel,
  validateMasterSkuExcel,
  type MasterSku,
} from "@/lib/api";
import {
  MASTER_SKU_ALLOWED_UNITS,
  MASTER_SKU_EXCEL_COLUMNS,
  MASTER_SKU_FORM_FIELDS,
  MASTER_SKU_REQUIRED_COLUMNS,
} from "@/lib/masterSkuFields";

const PAGE_SIZE = 9;

function formatIdInt(n: number | null | undefined): string {
  const v = Math.round(Number(n ?? 0));
  return v.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

/** Stable pseudo-color for group badge (mockup-style). */
function groupBadgeClass(group: string): string {
  const g = group.trim().toLowerCase();
  const palettes = [
    "bg-emerald-500/20 text-emerald-300 border-emerald-500/40",
    "bg-sky-500/20 text-sky-300 border-sky-500/40",
    "bg-amber-500/20 text-amber-300 border-amber-500/40",
    "bg-rose-500/20 text-rose-300 border-rose-500/40",
    "bg-violet-500/20 text-violet-300 border-violet-500/40",
    "bg-cyan-500/20 text-cyan-300 border-cyan-500/40",
  ];
  let h = 0;
  for (let i = 0; i < g.length; i++) h = (h * 31 + g.charCodeAt(i)) >>> 0;
  return palettes[h % palettes.length];
}

function dltTextClass(lt: number): string {
  if (lt <= 7) return "text-emerald-400 font-semibold";
  if (lt <= 14) return "text-amber-400 font-semibold";
  return "text-orange-400 font-semibold";
}

function masterRowToCsvRecord(r: MasterSku): Record<string, string | number> {
  return {
    "Material Number": r.sku,
    "Material Description": r.nama_item ?? "",
    "Material Group": r.group ?? "",
    Unit: r.unit ?? "pcs",
    Criticality: r.criticality ?? "",
    "ABC Class": r.abc_class ?? "",
    "XYZ Class": r.xyz_class ?? "",
    "Vendor Type": r.vendor_type ?? "",
    Currency: r.currency ?? "",
    "Lead Time_Days": r.lead_time ?? 0,
    MOQ: r.moq ?? 1,
    "Sales Price": Math.round(Number(r.harga ?? 0)),
    "Purchase Price": Math.round(Number(r.purchase_price ?? 0)),
    "Holding Cost Rate/day": r.holding_cost_rate_day ?? 0,
    "Holding Cost/day (IDR)": Math.round(Number(r.holding_cost_day_idr ?? 0)),
    "Lost Sale Rate/Each": r.lost_sale_rate_each ?? 0,
    "Penalty/unit (IDR)": Math.round(Number(r.penalty_per_unit_idr ?? 0)),
    "Logistic Cost/Order": Math.round(Number(r.logistic_cost_order ?? 0)),
    "Initial Inventory": Math.round(Number(r.initial_inventory ?? 0)),
    Qmax: r.qmax ?? "",
    "Target Percentile": `${Math.round(Number(r.target_percentile ?? 0.95) * 100)}%`,
  };
}

function downloadCsv(filename: string, rows: MasterSku[]) {
  const headers = [...MASTER_SKU_EXCEL_COLUMNS];
  const esc = (v: unknown) => {
    const s = String(v ?? "");
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const lines = [
    headers.join(","),
    ...rows.map((r) => {
      const rec = masterRowToCsvRecord(r);
      return headers.map((h) => esc(rec[h])).join(",");
    }),
  ];
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

type SkuForm = {
  sku: string;
  nama_item: string;
  group: string;
  unit: string;
  criticality: string;
  abc_class: string;
  xyz_class: string;
  vendor_type: string;
  currency: string;
  lead_time: number;
  moq: number;
  harga: number;
  purchase_price: number;
  holding_cost_rate_day: number;
  holding_cost_day_idr: number;
  lost_sale_rate_each: number;
  penalty_per_unit_idr: number;
  logistic_cost_order: number;
  initial_inventory: number;
  qmax: number | "";
  target_percentile: number;
  target_sl: number;
  status: "Active" | "Nonaktif";
  use_forecast: boolean;
};

const emptyForm: SkuForm = {
  sku: "",
  nama_item: "",
  group: "",
  unit: "EA",
  criticality: "",
  abc_class: "",
  xyz_class: "",
  vendor_type: "",
  currency: "",
  lead_time: 3,
  moq: 1,
  harga: 9000,
  purchase_price: 7000,
  holding_cost_rate_day: 0.0001,
  holding_cost_day_idr: 0,
  lost_sale_rate_each: 0.15,
  penalty_per_unit_idr: 0,
  logistic_cost_order: 750000,
  initial_inventory: 0,
  qmax: "",
  target_percentile: 0.95,
  target_sl: 0.95,
  status: "Active",
  use_forecast: true,
};

function rowToForm(r: MasterSku): SkuForm {
  const st = (r.status ?? "").trim();
  return {
    sku: r.sku,
    nama_item: String(r.nama_item ?? ""),
    group: String(r.group ?? ""),
    unit: (() => {
      const u = String(r.unit ?? "EA").trim().toUpperCase();
      return (MASTER_SKU_ALLOWED_UNITS as readonly string[]).includes(u) ? u : "EA";
    })(),
    criticality: String(r.criticality ?? ""),
    abc_class: String(r.abc_class ?? ""),
    xyz_class: String(r.xyz_class ?? ""),
    vendor_type: String(r.vendor_type ?? ""),
    currency: String(r.currency ?? ""),
    lead_time: Number(r.lead_time ?? 0),
    moq: Math.max(1, Number(r.moq ?? 1)),
    harga: Number(r.harga ?? 0),
    purchase_price: Number(r.purchase_price ?? 0),
    holding_cost_rate_day: Number(r.holding_cost_rate_day ?? 0),
    holding_cost_day_idr: Math.round(Number(r.holding_cost_day_idr ?? 0)),
    lost_sale_rate_each: Number(r.lost_sale_rate_each ?? 0),
    penalty_per_unit_idr: Math.round(Number(r.penalty_per_unit_idr ?? 0)),
    logistic_cost_order: Math.round(Number(r.logistic_cost_order ?? 0)),
    initial_inventory: Math.round(Number(r.initial_inventory ?? 0)),
    qmax: r.qmax != null && r.qmax > 0 ? Math.round(Number(r.qmax)) : "",
    target_percentile: Number(r.target_percentile ?? 0.95),
    target_sl: Number(r.target_sl ?? 0.95),
    status: st === "Nonaktif" ? "Nonaktif" : "Active",
    use_forecast: r.use_forecast !== false,
  };
}

export default function MasterData() {
  const [activeTab, setActiveTab] = useState<"sku" | "upload">("sku");
  const [rows, setRows] = useState<MasterSku[]>([]);
  const [form, setForm] = useState<SkuForm>(emptyForm);
  const [selectedSku, setSelectedSku] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [uploadMasterBusy, setUploadMasterBusy] = useState(false);
  const [masterFile, setMasterFile] = useState<File | null>(null);
  const [masterValidation, setMasterValidation] = useState<Record<string, unknown> | null>(null);
  const [lastUploadSummary, setLastUploadSummary] = useState<string | null>(null);
  const [lastExportAt, setLastExportAt] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [groupFilter, setGroupFilter] = useState("__all__");
  const [dltFilter, setDltFilter] = useState<"all" | "lte7" | "8to14" | "15to30" | "gte31">("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("all");
  const [dbGroups, setDbGroups] = useState<string[]>([]);

  const groupOptions = useMemo(() => {
    const s = new Set<string>(dbGroups);
    for (const r of rows) {
      const g = String(r.group ?? "").trim();
      if (g) s.add(g);
    }
    const fg = form.group.trim();
    if (fg) s.add(fg);
    return Array.from(s).sort((a, b) => a.localeCompare(b, "en"));
  }, [dbGroups, rows, form.group]);

  const loadGroups = useCallback(() => {
    getSkuGroups()
      .then((d) => setDbGroups(d.groups ?? []))
      .catch(() => setDbGroups([]));
  }, []);

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((item) => {
      if (q) {
        const parts = [item.sku, item.nama_item, item.group].map((x) =>
          String(x ?? "").toLowerCase()
        );
        if (!parts.some((p) => p.includes(q))) return false;
      }
      if (groupFilter !== "__all__" && String(item.group ?? "").trim() !== groupFilter) {
        return false;
      }
      const lt = Number(item.lead_time ?? 0);
      if (dltFilter === "lte7" && lt > 7) return false;
      if (dltFilter === "8to14" && (lt < 8 || lt > 14)) return false;
      if (dltFilter === "15to30" && (lt < 15 || lt > 30)) return false;
      if (dltFilter === "gte31" && lt < 31) return false;
      const st = (item.status ?? "").trim();
      if (statusFilter === "active") return st !== "Nonaktif";
      if (statusFilter === "inactive") return st === "Nonaktif";
      return true;
    });
  }, [rows, search, groupFilter, dltFilter, statusFilter]);

  const pageCount = Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const paginatedRows = useMemo(() => {
    const p = Math.min(Math.max(1, page), pageCount);
    const start = (p - 1) * PAGE_SIZE;
    return filteredRows.slice(start, start + PAGE_SIZE);
  }, [filteredRows, page, pageCount]);

  useEffect(() => {
    setPage(1);
  }, [search, groupFilter, dltFilter, statusFilter]);

  useEffect(() => {
    if (page > pageCount) setPage(pageCount);
  }, [page, pageCount]);

  const reload = useCallback(() => {
    listMasterSkus()
      .then((d) => setRows(d.skus))
      .catch((e) => setErr(String(e.message)));
  }, []);

  useEffect(() => {
    reload();
    loadGroups();
  }, [reload, loadGroups]);

  useEffect(() => {
    if (!selectedSku) return;
    const r = rows.find((x) => x.sku === selectedSku);
    if (r) setForm(rowToForm(r));
  }, [rows, selectedSku]);

  const selectRow = (item: MasterSku) => {
    setSelectedSku(item.sku);
    setForm(rowToForm(item));
    setErr(null);
    setModalOpen(true);
  };

  const startNew = () => {
    setSelectedSku(null);
    setForm({ ...emptyForm });
    setErr(null);
    setModalOpen(true);
  };

  const resetForm = () => {
    if (selectedSku) {
      const r = rows.find((x) => x.sku === selectedSku);
      if (r) setForm(rowToForm(r));
    } else {
      setForm({ ...emptyForm });
    }
    setErr(null);
  };

  const submitSku = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    setMsg(null);
    const sku = form.sku.trim();
    if (!sku) {
      setErr("Material Number is required.");
      return;
    }
    if (!form.nama_item.trim()) {
      setErr("Material Description is required.");
      return;
    }
    if (!form.group.trim()) {
      setErr("Material Group is required.");
      return;
    }
    const unit = form.unit.trim().toUpperCase();
    if (!(MASTER_SKU_ALLOWED_UNITS as readonly string[]).includes(unit)) {
      setErr(`Unit must be one of: ${MASTER_SKU_ALLOWED_UNITS.join(", ")}`);
      return;
    }
    const holdingCostDayIdr = Math.round(
      Number(form.holding_cost_rate_day) * Number(form.purchase_price)
    );
    const penaltyPerUnitIdr = Math.round(Number(form.lost_sale_rate_each) * Number(form.harga));
    try {
      await saveMasterSku({
        sku,
        nama_item: form.nama_item,
        group: form.group.trim() || null,
        unit,
        criticality: form.criticality.trim() || null,
        abc_class: form.abc_class.trim() || null,
        xyz_class: form.xyz_class.trim() || null,
        vendor_type: form.vendor_type.trim() || null,
        currency: form.currency.trim() || null,
        lead_time: Math.max(0, Math.round(Number(form.lead_time))),
        moq: Math.max(1, Math.round(Number(form.moq))),
        harga: Math.round(Number(form.harga)),
        purchase_price: Math.round(Number(form.purchase_price)),
        holding_cost_rate_day: Number(form.holding_cost_rate_day),
        holding_cost_day_idr: holdingCostDayIdr,
        lost_sale_rate_each: Number(form.lost_sale_rate_each),
        penalty_per_unit_idr: penaltyPerUnitIdr,
        logistic_cost_order: Math.round(Number(form.logistic_cost_order)),
        initial_inventory: Math.max(0, Math.round(Number(form.initial_inventory))),
        qmax: form.qmax === "" ? null : Math.max(1, Math.round(Number(form.qmax))),
        target_percentile: Number(form.target_percentile),
        target_sl: Number(form.target_sl),
        status: form.status,
        use_forecast: form.use_forecast,
      });
      setMsg(`Changes for SKU ${sku} saved.`);
      setSelectedSku(sku);
      setModalOpen(false);
      reload();
      loadGroups();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  const onValidateMasterSku = async (file: File | null) => {
    if (!file) return;
    setMasterFile(file);
    setUploadMasterBusy(true);
    setErr(null);
    setMsg(null);
    try {
      const r = await validateMasterSkuExcel(file);
      setMasterValidation(r);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setUploadMasterBusy(false);
    }
  };

  const onDropMasterSku = (e: React.DragEvent) => {
    e.preventDefault();
    const f = e.dataTransfer.files?.[0];
    if (f) void onValidateMasterSku(f);
  };

  const onCommitMasterSku = async () => {
    if (!masterFile) return;
    setUploadMasterBusy(true);
    setErr(null);
    setMsg(null);
    try {
      const r = await uploadMasterSkuExcel(masterFile);
      setMsg(`Master SKU upload: +${r.inserted} new, ${r.updated} updated (${r.rows_in_file} rows).`);
      setLastUploadSummary(
        `Last upload ${new Date().toLocaleString()} · inserted=${r.inserted}, updated=${r.updated}, rows=${r.rows_in_file}`
      );
      setMasterValidation(null);
      setMasterFile(null);
      reload();
      loadGroups();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setUploadMasterBusy(false);
    }
  };

  const onExportCsv = () => {
    downloadCsv(`master_sku_${new Date().toISOString().slice(0, 10)}.csv`, rows);
    setLastExportAt(new Date().toLocaleString());
  };

  const numInput = (
    id: string,
    label: React.ReactNode,
    value: number,
    onChange: (n: number) => void,
    opts?: { step?: number; min?: number; max?: number; hint?: string }
  ) => (
    <div key={id}>
      <label htmlFor={id} className="block text-xs font-medium text-slate-400 mb-1">
        {label}
      </label>
      <input
        id={id}
        type="number"
        step={opts?.step ?? 1}
        min={opts?.min}
        max={opts?.max}
        className="w-full bg-slate-950 border border-slate-700 text-sm rounded-lg px-3 py-2 text-white"
        value={Number.isFinite(value) ? value : 0}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      {opts?.hint && <p className="text-[11px] text-slate-600 mt-1">{opts.hint}</p>}
    </div>
  );

  const textInput = (
    id: string,
    label: React.ReactNode,
    value: string,
    onChange: (s: string) => void,
    required?: boolean
  ) => (
    <div key={id}>
      <label htmlFor={id} className="block text-xs font-medium text-slate-400 mb-1">
        {label}
        {required && <span className="text-red-400"> *</span>}
      </label>
      <input
        id={id}
        type="text"
        className="w-full bg-slate-950 border border-slate-700 text-sm rounded-lg px-3 py-2 text-white"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );

  const renderMasterSkuFields = () =>
    MASTER_SKU_FORM_FIELDS.map((field) => {
      const id = `f-${field.key}`;
      if (field.key === "group") {
        const inList = groupOptions.includes(form.group);
        return (
          <div key={field.key}>
            <label htmlFor={id} className="block text-xs font-medium text-slate-400 mb-1">
              {field.label}
              {field.required && <span className="text-red-400"> *</span>}
            </label>
            <select
              id={`${id}-select`}
              className="w-full bg-slate-950 border border-slate-700 text-sm rounded-lg px-3 py-2 text-white mb-2"
              value={inList && form.group ? form.group : ""}
              onChange={(e) => {
                const v = e.target.value;
                if (v) setForm((f) => ({ ...f, group: v }));
              }}
            >
              <option value="">Select existing group…</option>
              {groupOptions.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>
            <input
              id={id}
              list="group-suggestions"
              placeholder="Or type a new group name"
              className="w-full bg-slate-950 border border-slate-700 text-sm rounded-lg px-3 py-2 text-white"
              value={form.group}
              onChange={(e) => setForm((f) => ({ ...f, group: e.target.value }))}
            />
            <datalist id="group-suggestions">
              {groupOptions.map((g) => (
                <option key={g} value={g} />
              ))}
            </datalist>
          </div>
        );
      }
      if (field.kind === "unit") {
        return (
          <div key={field.key}>
            <label htmlFor={id} className="block text-xs font-medium text-slate-400 mb-1">
              {field.label}
              {field.required && <span className="text-red-400"> *</span>}
            </label>
            <select
              id={id}
              className="w-full bg-slate-950 border border-slate-700 text-sm rounded-lg px-3 py-2 text-white"
              value={form.unit}
              onChange={(e) => setForm((f) => ({ ...f, unit: e.target.value }))}
            >
              {MASTER_SKU_ALLOWED_UNITS.map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </select>
          </div>
        );
      }
      if (field.kind === "select") {
        const current = String(form[field.key] ?? "");
        const options = field.options ?? [];
        return (
          <div key={field.key}>
            <label htmlFor={id} className="block text-xs font-medium text-slate-400 mb-1">
              {field.label}
              {field.required && <span className="text-red-400"> *</span>}
            </label>
            <select
              id={id}
              className="w-full bg-slate-950 border border-slate-700 text-sm rounded-lg px-3 py-2 text-white"
              value={options.includes(current) ? current : ""}
              onChange={(e) => setForm((f) => ({ ...f, [field.key]: e.target.value } as SkuForm))}
            >
              <option value="">Select…</option>
              {options.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          </div>
        );
      }
      if (field.kind === "text") {
        return textInput(
          id,
          field.label,
          String(form[field.key] ?? ""),
          (s) => setForm((f) => ({ ...f, [field.key]: s })),
          field.required
        );
      }
      const setNum = (n: number) => setForm((f) => ({ ...f, [field.key]: n } as SkuForm));
      const baseInput = numInput(
        id,
        field.label,
        Number(form[field.key] ?? 0),
        setNum,
        {
          step:
            field.step ??
            (field.kind === "percent"
              ? 0.01
              : field.kind === "money" || field.kind === "int"
                ? 1
                : 0.000001),
          min: 0,
          max: field.kind === "percent" ? 1 : undefined,
          hint: field.hint,
        }
      );

      let computedLabel: string | null = null;
      let computedValue = 0;
      let computedFormula: string | null = null;
      if (field.key === "holding_cost_rate_day") {
        computedLabel = "Holding Cost/day (IDR)";
        computedValue = Math.round(
          Number(form.holding_cost_rate_day || 0) * Number(form.purchase_price || 0)
        );
        computedFormula = "Holding Cost Rate/day × Purchase Price";
      } else if (field.key === "lost_sale_rate_each") {
        computedLabel = "Penalty/unit (IDR)";
        computedValue = Math.round(Number(form.lost_sale_rate_each || 0) * Number(form.harga || 0));
        computedFormula = "Lost Sale Rate/Each × Sales Price";
      }
      if (!computedLabel) return baseInput;

      return (
        <div key={field.key} className="contents">
          {baseInput}
          <div className="rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-2 mt-1.5">
            <p className="text-xs font-medium text-slate-500">{computedLabel}</p>
            <p className="text-sm font-mono text-slate-300 mt-0.5">
              {computedValue.toLocaleString("en-US")}
            </p>
            <p className="text-[11px] text-slate-600 mt-0.5">Auto-calculated: {computedFormula}</p>
          </div>
        </div>
      );
    });

  const from = filteredRows.length === 0 ? 0 : (safePage - 1) * PAGE_SIZE + 1;
  const to = Math.min(safePage * PAGE_SIZE, filteredRows.length);

  return (
    <div className="space-y-5 animate-in fade-in zoom-in duration-500">
      <div className="flex flex-col gap-4 border-b border-slate-800 pb-5 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight text-white">Master SKU</h1>
          <p className="text-sm text-slate-400 mt-1 max-w-xl">
            Manage SKU data for DDMRP forecasting and buffer optimization.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 shrink-0">
          <button
            type="button"
            onClick={onExportCsv}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-600 bg-slate-800/80 px-4 py-2 text-sm font-medium text-slate-100 hover:bg-slate-700"
          >
            <span aria-hidden>⬇</span> Export CSV
          </button>
          <a
            href={exportMasterSkuUrl()}
            onClick={() => setLastExportAt(new Date().toLocaleString())}
            className="inline-flex items-center gap-2 rounded-lg border border-indigo-500/50 bg-indigo-600/90 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500"
          >
            <span aria-hidden>⬇</span> Export Excel
          </a>
          <button
            type="button"
            onClick={startNew}
            className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500"
          >
            <span aria-hidden>+</span> New SKU
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
      {lastUploadSummary && (
        <div className="rounded-xl border border-slate-800 bg-slate-900/40 text-slate-300 px-4 py-3 text-xs">
          {lastUploadSummary}
        </div>
      )}
      {lastExportAt && (
        <div className="rounded-xl border border-slate-800 bg-slate-900/40 text-slate-300 px-4 py-3 text-xs">
          Last export: {lastExportAt}
        </div>
      )}

      <div className="flex flex-wrap gap-2 bg-slate-900/60 p-1 rounded-xl border border-slate-800 w-fit">
        <button
          type="button"
          onClick={() => setActiveTab("sku")}
          className={`px-4 py-2 text-sm font-semibold rounded-lg transition-all ${
            activeTab === "sku"
              ? "bg-indigo-600 text-white shadow-md"
              : "text-slate-400 hover:text-white hover:bg-slate-800"
          }`}
        >
          SKU List
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("upload")}
          className={`px-4 py-2 text-sm font-semibold rounded-lg transition-all ${
            activeTab === "upload"
              ? "bg-indigo-600 text-white shadow-md"
              : "text-slate-400 hover:text-white hover:bg-slate-800"
          }`}
        >
          Bulk Upload
        </button>
      </div>

      {activeTab === "sku" && (
        <>
          <div className="flex flex-col xl:flex-row xl:items-end gap-3 flex-wrap">
            <div className="flex-1 min-w-[200px]">
              <label className="block text-xs text-slate-500 mb-1">Search SKU</label>
              <input
                type="search"
                placeholder="Search SKU"
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-white"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <div className="w-full sm:w-44">
              <label className="block text-xs text-slate-500 mb-1">Group</label>
              <select
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-white"
                value={groupFilter}
                onChange={(e) => setGroupFilter(e.target.value)}
              >
                <option value="__all__">All groups</option>
                {groupOptions.map((g) => (
                  <option key={g} value={g}>
                    {g}
                  </option>
                ))}
              </select>
            </div>
            <div className="w-full sm:w-44">
              <label className="block text-xs text-slate-500 mb-1">DLT</label>
              <select
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-white"
                value={dltFilter}
                onChange={(e) => setDltFilter(e.target.value as typeof dltFilter)}
              >
                <option value="all">All</option>
                <option value="lte7">0–7 hr</option>
                <option value="8to14">8–14 hr</option>
                <option value="15to30">15–30 hr</option>
                <option value="gte31">31+ hr</option>
              </select>
            </div>
            <div className="w-full sm:w-40">
              <label className="block text-xs text-slate-500 mb-1">Status</label>
              <select
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-white"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
              >
                <option value="all">All</option>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </div>
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-2xl shadow-xl overflow-hidden flex flex-col min-h-[320px]">
              <div className="px-4 py-3 border-b border-slate-800 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                <div>
                  <h2 className="text-base font-bold text-white">SKU List</h2>
                  <p className="text-xs text-slate-500">
                    {paginatedRows.length} of {filteredRows.length} shown
                    {filteredRows.length !== rows.length && ` · ${rows.length} total in database`}
                  </p>
                </div>
                <p className="text-xs text-indigo-300/90">Click a row to edit</p>
              </div>
              <div className="overflow-x-auto flex-1">
                <table className="w-full text-left text-sm text-slate-300">
                  <thead className="bg-slate-950 text-slate-500 text-xs uppercase tracking-wide border-b border-slate-800">
                    <tr>
                      <th className="px-4 py-3 font-medium">SKU / Nama</th>
                      <th className="px-4 py-3 font-medium">Group</th>
                      <th className="px-4 py-3 font-medium w-24">DLT</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60">
                    {paginatedRows.map((item) => {
                      const g = String(item.group ?? "").trim() || "—";
                      const lt = Number(item.lead_time ?? 0);
                      const selected = selectedSku === item.sku;
                      return (
                        <tr
                          key={item.sku}
                          role="button"
                          tabIndex={0}
                          onClick={() => selectRow(item)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              selectRow(item);
                            }
                          }}
                          className={`cursor-pointer transition-colors ${
                            selected
                              ? "bg-indigo-600/25 border-l-2 border-l-indigo-500"
                              : "hover:bg-slate-800/50 border-l-2 border-l-transparent"
                          }`}
                        >
                          <td className="px-4 py-3">
                            <div className="font-semibold text-white">{item.sku}</div>
                            <div className="text-slate-400 truncate max-w-[220px] text-xs mt-0.5">
                              {item.nama_item ?? "—"}
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            {g === "—" ? (
                              <span className="text-slate-600">—</span>
                            ) : (
                              <span
                                className={`inline-flex px-2 py-0.5 rounded-md text-xs font-semibold border ${groupBadgeClass(g)}`}
                              >
                                {g}
                              </span>
                            )}
                          </td>
                          <td className={`px-4 py-3 tabular-nums ${dltTextClass(lt)}`}>{lt} hr</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {filteredRows.length === 0 && (
                  <p className="p-8 text-center text-slate-500 text-sm">No matching SKUs.</p>
                )}
              </div>
              <div className="px-4 py-3 border-t border-slate-800 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-slate-500">
                <span>
                  Showing {from}-{to} of {filteredRows.length} SKUs
                </span>
                <div className="flex items-center gap-2">
                  <span className="text-slate-400 tabular-nums">
                    Page {safePage} / {pageCount}
                  </span>
                  <button
                    type="button"
                    disabled={safePage <= 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    className="px-2 py-1 rounded border border-slate-700 text-slate-300 disabled:opacity-40 hover:bg-slate-800"
                  >
                    ←
                  </button>
                  <button
                    type="button"
                    disabled={safePage >= pageCount}
                    onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
                    className="px-2 py-1 rounded border border-slate-700 text-slate-300 disabled:opacity-40 hover:bg-slate-800"
                  >
                    →
                  </button>
                </div>
              </div>
          </div>
        </>
      )}

      {modalOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="sku-modal-title"
          onClick={() => setModalOpen(false)}
        >
          <div
            className="w-full max-w-2xl max-h-[85vh] bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-4 border-b border-slate-800 shrink-0">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h2 id="sku-modal-title" className="text-lg font-bold text-white">
                    {selectedSku ? `Edit SKU: ${selectedSku}` : "New SKU"}
                  </h2>
                  <p className="text-xs text-slate-500 mt-1">
                    Fields follow the Excel template <span className="font-mono">sku_master</span>.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="text-slate-500 hover:text-white shrink-0"
                  aria-label="Close"
                >
                  ✕
                </button>
              </div>
            </div>

            <form onSubmit={submitSku} className="flex flex-col flex-1 min-h-0">
              <div className="overflow-y-auto px-5 py-4 space-y-3 flex-1 grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3 sm:space-y-0">
                {renderMasterSkuFields()}
                <div className="sm:col-span-2 pt-2 border-t border-slate-800 grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3">
                  <div>
                    <label htmlFor="f-status" className="block text-xs font-medium text-slate-400 mb-1">
                      Status (app only, not in Excel template)
                    </label>
                    <select
                      id="f-status"
                      className="w-full bg-slate-950 border border-slate-700 text-sm rounded-lg px-3 py-2 text-white"
                      value={form.status}
                      onChange={(e) =>
                        setForm((f) => ({
                          ...f,
                          status: e.target.value as "Active" | "Nonaktif",
                        }))
                      }
                    >
                      <option value="Active">Active</option>
                      <option value="Nonaktif">Inactive</option>
                    </select>
                    <p className="text-[11px] text-slate-600 mt-1">
                      Inactive excludes the SKU from automatic dataset refresh.
                    </p>
                  </div>
                  <div>
                    <label htmlFor="f-use-forecast" className="block text-xs font-medium text-slate-400 mb-1">
                      Forecasting (app only, not in Excel template)
                    </label>
                    <label
                      htmlFor="f-use-forecast"
                      className="flex items-center gap-2 w-full bg-slate-950 border border-slate-700 text-sm rounded-lg px-3 py-2 text-white cursor-pointer"
                    >
                      <input
                        id="f-use-forecast"
                        type="checkbox"
                        checked={form.use_forecast}
                        onChange={(e) => setForm((f) => ({ ...f, use_forecast: e.target.checked }))}
                        className="rounded border-slate-600"
                      />
                      Use forecast
                    </label>
                    <p className="text-[11px] text-slate-600 mt-1">
                      {form.use_forecast
                        ? "Run Analytics & Buffer uses the statistical forecast pipeline."
                        : "Run Analytics & Buffer computes the buffer directly from actual demand (no forecast step)."}
                    </p>
                  </div>
                </div>
              </div>

              <div className="shrink-0 border-t border-slate-800 px-5 py-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={resetForm}
                  className="flex-1 min-w-[100px] rounded-lg border border-slate-600 py-2.5 text-sm font-semibold text-slate-200 hover:bg-slate-800"
                >
                  Reset
                </button>
                <button
                  type="submit"
                  className="flex-[2] min-w-[140px] rounded-lg bg-indigo-600 py-2.5 text-sm font-semibold text-white hover:bg-indigo-500"
                >
                  Save changes
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {activeTab === "upload" && (
        <div className="mt-2 space-y-6">
          <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5 md:p-6">
            <h2 className="text-sm font-bold text-slate-300 uppercase tracking-wide mb-4">Upload flow</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-2">
              {[
                {
                  step: 1,
                  title: "Choose Excel file",
                  body: (
                    <div
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={onDropMasterSku}
                      className="mt-3 rounded-xl border-2 border-dashed border-slate-600 bg-slate-950/50 px-3 py-6 text-center"
                    >
                      <p className="text-2xl text-slate-500" aria-hidden>
                        ↑
                      </p>
                      <p className="text-xs text-slate-400 mt-2">
                        Drag &amp; drop here or click to choose a file{" "}
                        <span className="text-slate-300">.xlsx, .xls</span>
                        <span className="block text-[11px] text-slate-600 mt-1">Max. 10 MB (recommended)</span>
                      </p>
                      <label className="mt-3 inline-block cursor-pointer rounded-lg bg-indigo-600 px-4 py-2 text-xs font-semibold text-white hover:bg-indigo-500">
                        {uploadMasterBusy ? "Processing…" : "Choose file"}
                        <input
                          type="file"
                          className="hidden"
                          accept=".xlsx,.xls"
                          disabled={uploadMasterBusy}
                          onChange={(e) => void onValidateMasterSku(e.target.files?.[0] ?? null)}
                        />
                      </label>
                      {masterFile && (
                        <p className="mt-2 text-[11px] text-emerald-400 truncate" title={masterFile.name}>
                          {masterFile.name}
                        </p>
                      )}
                      <p className="mt-4 text-left text-[10px] font-semibold uppercase text-slate-500">
                        Required columns
                      </p>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {MASTER_SKU_REQUIRED_COLUMNS.map((col) => (
                          <span
                            key={col}
                            className="rounded-md border border-sky-600/60 bg-sky-900/30 px-2 py-0.5 text-[10px] text-sky-300"
                            title="Required"
                          >
                            {col}
                          </span>
                        ))}
                        {MASTER_SKU_EXCEL_COLUMNS.filter(
                          (col) => !(MASTER_SKU_REQUIRED_COLUMNS as readonly string[]).includes(col)
                        ).map((col) => (
                          <span
                            key={col}
                            className="rounded-md border border-slate-700 bg-slate-900 px-2 py-0.5 text-[10px] text-slate-400"
                            title="Optional"
                          >
                            {col}
                          </span>
                        ))}
                      </div>
                      <p className="mt-2 text-[10px] text-slate-600">
                        Blue columns = required (must have a value per row). All 21 headers must be
                        present — matching the <span className="font-mono">sku_master</span> template.
                      </p>
                      <a
                        href={masterSkuTemplateUrl()}
                        className="mt-2 inline-block text-[11px] font-medium text-indigo-400 hover:text-indigo-300"
                      >
                        ↓ Download template
                      </a>
                    </div>
                  ),
                },
                {
                  step: 2,
                  title: "Validation & preview",
                  body: (
                    <div className="mt-3 space-y-3 text-sm">
                      <div className="grid grid-cols-3 gap-2">
                        <div className="rounded-lg border border-slate-800 bg-slate-950/50 p-2">
                          <p className="text-[10px] text-slate-500">Total rows</p>
                          <p className="text-lg font-semibold text-slate-200 tabular-nums">
                            {masterValidation ? formatIdInt(Number(masterValidation.total_rows ?? 0)) : "—"}
                          </p>
                        </div>
                        <div className="rounded-lg border border-slate-800 bg-slate-950/50 p-2">
                          <p className="text-[10px] text-slate-500">Valid rows</p>
                          <p className="text-lg font-semibold text-emerald-400 tabular-nums">
                            {masterValidation ? formatIdInt(Number(masterValidation.valid_rows ?? 0)) : "—"}
                          </p>
                        </div>
                        <div className="rounded-lg border border-slate-800 bg-slate-950/50 p-2">
                          <p className="text-[10px] text-slate-500">Error rows</p>
                          <p className="text-lg font-semibold text-red-400 tabular-nums">
                            {masterValidation ? formatIdInt(Number(masterValidation.error_rows ?? 0)) : "—"}
                          </p>
                        </div>
                      </div>
                      {!masterValidation && (
                        <p className="text-xs text-slate-500">
                          Upload a file first. Validation results will appear here.
                        </p>
                      )}
                      {masterValidation?.ok === false && (
                        <p className="text-xs text-red-300">{String(masterValidation.error ?? "Validation failed")}</p>
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
                          <span className="text-slate-200 truncate max-w-[10rem]">
                            {masterFile?.name ?? "—"}
                          </span>
                        </li>
                        <li className="flex justify-between gap-2">
                          <span>Total rows</span>
                          <span className="text-slate-200">
                            {masterValidation ? String(masterValidation.total_rows ?? 0) : "—"}
                          </span>
                        </li>
                        <li className="flex justify-between gap-2">
                          <span>Will be saved</span>
                          <span className="text-emerald-400 font-medium">
                            {String(masterValidation?.valid_rows ?? 0)}
                          </span>
                        </li>
                        <li className="flex justify-between gap-2">
                          <span>Will be skipped</span>
                          <span className="text-amber-300 font-medium">
                            {String(masterValidation?.error_rows ?? 0)}
                          </span>
                        </li>
                      </ul>
                      <p className="text-[11px] text-slate-500">
                        SKUs with the same code will be <strong className="text-slate-300">updated</strong>,
                        not rejected — new SKUs are inserted.
                      </p>
                      <button
                        type="button"
                        disabled={
                          uploadMasterBusy || Number(masterValidation?.valid_rows ?? 0) <= 0
                        }
                        onClick={() => void onCommitMasterSku()}
                        className="w-full rounded-xl bg-indigo-600 py-3 text-sm font-bold text-white shadow-lg hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        Save valid rows
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

          <div className="rounded-2xl border border-slate-800 bg-slate-900 shadow-xl p-6 max-w-5xl">
            <h2 className="text-lg font-bold text-white mb-2">Error detail</h2>
            {!masterValidation && <p className="text-slate-500 text-sm">No validation yet.</p>}
            {masterValidation && (
              <div className="text-slate-300 text-sm space-y-2">
                {Array.isArray(masterValidation.errors) && masterValidation.errors.length > 0 ? (
                  <div className="space-y-2">
                    {(masterValidation.errors as { row?: unknown; message?: unknown }[])
                      .slice(0, 20)
                      .map((e, idx) => (
                        <div
                          key={idx}
                          className="border border-slate-800 rounded-lg px-3 py-2 bg-slate-950/30"
                        >
                          <div className="font-mono text-slate-400">row {String(e.row ?? "?")}</div>
                          <div className="text-red-300">{String(e.message ?? "")}</div>
                        </div>
                      ))}
                  </div>
                ) : (
                  <p className="text-emerald-300">No errors.</p>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
