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
  MASTER_SKU_EXCEL_COLUMNS_SEMICOLON,
  MASTER_SKU_FORM_FIELDS,
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
  target_sl: number;
  status: "Active" | "Nonaktif";
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
  target_sl: 0.95,
  status: "Active",
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
    target_sl: Number(r.target_sl ?? 0.95),
    status: st === "Nonaktif" ? "Nonaktif" : "Active",
  };
}

export default function MasterData() {
  const [activeTab, setActiveTab] = useState<"sku" | "upload">("sku");
  const [rows, setRows] = useState<MasterSku[]>([]);
  const [form, setForm] = useState<SkuForm>(emptyForm);
  const [selectedSku, setSelectedSku] = useState<string | null>(null);
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
  };

  const startNew = () => {
    setSelectedSku(null);
    setForm({ ...emptyForm });
    setErr(null);
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
        holding_cost_day_idr: Math.round(Number(form.holding_cost_day_idr)),
        lost_sale_rate_each: Number(form.lost_sale_rate_each),
        penalty_per_unit_idr: Math.round(Number(form.penalty_per_unit_idr)),
        logistic_cost_order: Math.round(Number(form.logistic_cost_order)),
        target_sl: Number(form.target_sl),
        status: form.status,
      });
      setMsg(`Changes for SKU ${sku} saved.`);
      setSelectedSku(sku);
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
      return numInput(
        id,
        field.label,
        Number(form[field.key] ?? 0),
        setNum,
        {
          step:
            field.step ?? (field.kind === "money" || field.kind === "int" ? 1 : 0.000001),
          min: 0,
          hint: field.hint,
        }
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

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
            <div className="lg:col-span-7 bg-slate-900 border border-slate-800 rounded-2xl shadow-xl overflow-hidden flex flex-col min-h-[320px]">
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

            <div className="lg:col-span-5 bg-slate-900 border border-slate-800 rounded-2xl shadow-xl flex flex-col max-h-[calc(100vh-10rem)]">
              <div className="px-5 py-4 border-b border-slate-800 shrink-0">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h2 className="text-lg font-bold text-white">Detail SKU</h2>
                    {selectedSku ? (
                      <span className="mt-1 inline-block text-xs font-semibold px-2 py-0.5 rounded bg-sky-600/30 text-sky-200 border border-sky-500/40">
                        Edit: {selectedSku}
                      </span>
                    ) : (
                      <span className="mt-1 inline-block text-xs text-slate-500">New entry</span>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={startNew}
                    className="text-xs font-medium text-indigo-400 hover:text-indigo-300 shrink-0"
                  >
                    + New SKU
                  </button>
                </div>
              </div>

              <form onSubmit={submitSku} className="flex flex-col flex-1 min-h-0">
                <div className="overflow-y-auto px-5 py-4 space-y-3 flex-1">
                  <p className="text-xs text-slate-500">
                    Fields follow the Excel template <span className="font-mono">sku_master</span> (18 columns).
                  </p>
                  {renderMasterSkuFields()}
                  <div className="pt-2 border-t border-slate-800">
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
                </div>

                <div className="shrink-0 border-t border-slate-800 px-5 py-4 space-y-4 bg-slate-950/30">
                  <div className="flex flex-wrap gap-2">
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

                  <div className="rounded-xl border border-dashed border-slate-600 bg-slate-900/50 px-4 py-3 text-center">
                    <p className="text-xs text-slate-400 mb-2">Bulk upload via Excel (Data 2)</p>
                    <p className="text-[11px] text-slate-600 mb-3 font-mono break-all">
                      {MASTER_SKU_EXCEL_COLUMNS_SEMICOLON}
                    </p>
                    <div className="flex flex-wrap justify-center gap-2">
                      <button
                        type="button"
                        onClick={() => setActiveTab("upload")}
                        className="text-xs font-medium text-indigo-400 hover:text-indigo-300"
                      >
                        Open Bulk Upload tab →
                      </button>
                      <span className="text-slate-600">|</span>
                      <a
                        href={masterSkuTemplateUrl()}
                        className="text-xs font-medium text-slate-400 hover:text-slate-300"
                      >
                        Download template
                      </a>
                    </div>
                  </div>
                </div>
              </form>
            </div>
          </div>
        </>
      )}

      {activeTab === "upload" && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-5xl mx-auto mt-2">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl shadow-xl p-6">
            <h2 className="text-xl font-bold text-white mb-2">Validation &amp; preview</h2>
            <p className="text-slate-400 mb-3 text-sm">
              Headers must match the <span className="font-mono">sku_master</span>{" "}
              template (Data 2 sheet) exactly. Download the template for the correct column order.
            </p>
            <p className="text-[11px] text-slate-600 mb-4 font-mono break-all leading-relaxed">
              {MASTER_SKU_EXCEL_COLUMNS_SEMICOLON}
            </p>
            <div className="flex flex-wrap gap-3 text-sm mb-4">
              <a href={masterSkuTemplateUrl()} className="text-indigo-400 hover:text-indigo-300">
                ↓ Template Master SKU (Data 2)
              </a>
            </div>
            <label className="inline-block bg-indigo-600 hover:bg-indigo-500 text-white font-semibold py-3 px-6 rounded-lg cursor-pointer shadow-lg">
              {uploadMasterBusy ? "Uploading…" : "Choose Master SKU file"}
              <input
                type="file"
                className="hidden"
                accept=".xlsx,.xls"
                disabled={uploadMasterBusy}
                onChange={(e) => onValidateMasterSku(e.target.files?.[0] ?? null)}
              />
            </label>
            {masterValidation && (
              <div className="mt-4 text-sm text-slate-300 space-y-2">
                <p>
                  Validation: total {String(masterValidation.total_rows ?? 0)} | valid{" "}
                  {String(masterValidation.valid_rows ?? 0)} | error{" "}
                  {String(masterValidation.error_rows ?? 0)}
                </p>
                <button
                  type="button"
                  disabled={uploadMasterBusy || Number(masterValidation.valid_rows ?? 0) <= 0}
                  onClick={onCommitMasterSku}
                  className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-semibold py-2 px-4 rounded-lg"
                >
                  Save valid rows
                </button>
                <p className="text-xs text-slate-500">
                  SKUs with the same code will be <strong>updated</strong>, not rejected.
                </p>
              </div>
            )}
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-2xl shadow-xl p-6">
            <h2 className="text-xl font-bold text-white mb-2">Error preview</h2>
            {!masterValidation && <p className="text-slate-500 text-sm">No validation yet.</p>}
            {masterValidation && (
              <div className="text-slate-300 text-sm space-y-2">
                {Array.isArray(masterValidation.errors) &&
                masterValidation.errors.length > 0 ? (
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
