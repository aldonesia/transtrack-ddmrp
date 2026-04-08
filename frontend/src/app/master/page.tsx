"use client";

import { useCallback, useEffect, useState } from "react";
import {
  exportMasterSkuUrl,
  masterSkuTemplateUrl,
  listMasterSkus,
  saveMasterSku,
  uploadMasterSkuExcel,
  validateMasterSkuExcel,
  type MasterSku,
} from "@/lib/api";

const emptyForm = {
  sku: "",
  nama_item: "",
  unit: "ctn",
  lead_time: 3,
  moq: 100,
  pack_size: 10,
  harga: 9000,
  target_sl: 0.95,
  status: "Active",
  group: "",
  purchase_price: 7000,
  holding_cost_rate_day: 0.0001,
  lost_sale_rate_each: 0.15,
  logistic_cost_order: 750000,
};

export default function MasterData() {
  const [activeTab, setActiveTab] = useState("sku");
  const [rows, setRows] = useState<MasterSku[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [uploadMasterBusy, setUploadMasterBusy] = useState(false);
  const [masterFile, setMasterFile] = useState<File | null>(null);
  const [masterValidation, setMasterValidation] = useState<Record<string, unknown> | null>(null);
  const [lastUploadSummary, setLastUploadSummary] = useState<string | null>(null);
  const [lastExportAt, setLastExportAt] = useState<string | null>(null);

  const reload = useCallback(() => {
    listMasterSkus()
      .then((d) => setRows(d.skus))
      .catch((e) => setErr(String(e.message)));
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const submitSku = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    setMsg(null);
    try {
      await saveMasterSku({
        ...form,
        sku: form.sku.trim(),
        lead_time: Number(form.lead_time),
        moq: Number(form.moq),
        pack_size: Number(form.pack_size),
        harga: Number(form.harga),
        target_sl: Number(form.target_sl),
        purchase_price: Number(form.purchase_price),
        holding_cost_rate_day: Number(form.holding_cost_rate_day),
        lost_sale_rate_each: Number(form.lost_sale_rate_each),
        logistic_cost_order: Number(form.logistic_cost_order),
      });
      setMsg(`SKU ${form.sku} disimpan.`);
      reload();
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
      setMsg(`Upload master SKU: +${r.inserted} baru, ${r.updated} diperbarui (${r.rows_in_file} baris).`);
      setLastUploadSummary(
        `Upload terakhir ${new Date().toLocaleString()} · inserted=${r.inserted}, updated=${r.updated}, rows=${r.rows_in_file}`
      );
      setMasterValidation(null);
      setMasterFile(null);
      reload();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setUploadMasterBusy(false);
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in zoom-in duration-500">
      <div className="flex items-center justify-between pb-4 border-b border-slate-800">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight bg-gradient-to-br from-white to-slate-400 bg-clip-text text-transparent">
            Master SKU
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            Kelola Master SKU untuk kebutuhan forecasting & optimasi DDMRP (data tersimpan ke database).
          </p>
        </div>
        <a
          href={exportMasterSkuUrl()}
          onClick={() => setLastExportAt(new Date().toLocaleString())}
          className="text-sm text-indigo-400 hover:text-indigo-300"
        >
          ↓ Export Master SKU
        </a>
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
          Export terakhir: {lastExportAt}
        </div>
      )}

      <div className="flex space-x-2 bg-slate-900/50 p-1 rounded-xl w-fit border border-slate-800">
        <button
          type="button"
          onClick={() => setActiveTab("sku")}
          className={`px-4 py-2 text-sm font-semibold rounded-lg transition-all ${
            activeTab === "sku"
              ? "bg-indigo-600 text-white shadow-lg"
              : "text-slate-400 hover:text-white hover:bg-slate-800"
          }`}
        >
          Master SKU
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("upload")}
          className={`px-4 py-2 text-sm font-semibold rounded-lg transition-all ${
            activeTab === "upload"
              ? "bg-indigo-600 text-white shadow-lg"
              : "text-slate-400 hover:text-white hover:bg-slate-800"
          }`}
        >
          Upload Master SKU
        </button>
      </div>

      {activeTab === "sku" && (
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
          <div className="xl:col-span-2 bg-slate-900 border border-slate-800 rounded-2xl shadow-xl overflow-hidden">
            <div className="p-6 border-b border-slate-800">
              <h2 className="text-lg font-bold text-white">Daftar SKU (database)</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm text-slate-300">
                <thead className="bg-slate-950 text-slate-400 border-b border-slate-800">
                  <tr>
                    <th className="px-4 py-3 font-medium">SKU</th>
                    <th className="px-4 py-3 font-medium">Nama</th>
                    <th className="px-4 py-3 font-medium">DLT</th>
                    <th className="px-4 py-3 font-medium">MOQ</th>
                    <th className="px-4 py-3 font-medium">Harga</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {rows.map((item) => (
                    <tr key={item.sku} className="hover:bg-slate-800/40 transition-colors">
                      <td className="px-4 py-3 font-semibold text-white">{item.sku}</td>
                      <td className="px-4 py-3 max-w-[200px] truncate">{item.nama_item}</td>
                      <td className="px-4 py-3 text-emerald-400">{item.lead_time} h</td>
                      <td className="px-4 py-3">{item.moq}</td>
                      <td className="px-4 py-3">{item.harga}</td>
                      <td className="px-4 py-3">
                        <span className="px-2 py-1 rounded bg-emerald-900/30 text-emerald-400 text-xs font-bold border border-emerald-800/50">
                          {item.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <form
            onSubmit={submitSku}
            className="bg-slate-900 border border-slate-800 rounded-2xl shadow-xl p-6 space-y-3"
          >
            <h3 className="text-white font-bold">Tambah / perbarui SKU</h3>
            <p className="text-xs text-slate-500">
              Biaya (holding rate/day, lost sale rate, logistic/order) dipakai optimasi buffer.
            </p>
            {(
              [
                ["sku", "SKU", "text"],
                ["nama_item", "Nama item", "text"],
                ["group", "Grup", "text"],
                ["unit", "Unit", "text"],
                ["lead_time", "Lead time (hari)", "number"],
                ["moq", "MOQ", "number"],
                ["pack_size", "Qty per Carton (pcs/ctn)", "number"],
                ["harga", "Harga jual (ea)", "number"],
                ["purchase_price", "Harga beli", "number"],
                ["holding_cost_rate_day", "Holding cost rate/hari (× harga)", "number"],
                ["lost_sale_rate_each", "Lost sale rate/each", "number"],
                ["logistic_cost_order", "Biaya order/logistik", "number"],
                ["target_sl", "Target SL (0–1)", "number"],
                ["status", "Status", "text"],
              ] as const
            ).map(([key, label, typ]) => (
              <div key={key}>
                <label className="block text-xs text-slate-500 mb-1">{label}</label>
                <input
                  type={typ}
                  step={typ === "number" ? "any" : undefined}
                  className="w-full bg-slate-950 border border-slate-700 text-sm rounded-lg px-3 py-2 text-white"
                  value={String(form[key as keyof typeof form] ?? "")}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      [key]:
                        typ === "number" ? Number(e.target.value) : e.target.value,
                    }))
                  }
                />
              </div>
            ))}
            <button
              type="submit"
              className="w-full bg-indigo-600 hover:bg-indigo-500 text-white py-2 rounded-lg font-semibold mt-4"
            >
              Simpan ke database
            </button>
          </form>
        </div>
      )}

      {activeTab === "upload" && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-5xl mx-auto mt-6">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl shadow-xl p-6">
            <h2 className="text-xl font-bold text-white mb-2">Validasi & preview</h2>
            <p className="text-slate-400 mb-4 text-sm">
              Wajib kolom: Material Number, Material Group, Lead Time_Days, Sales Price, Purchase
              Price, Holding Cost Rate/day, Lost Sale Rate/Each, Logistic Cost/Order, MOQ.
              Opsional: Qty Per Carton (default 1 jika tidak diisi).
            </p>
            <a
              href={masterSkuTemplateUrl()}
              className="text-sm text-indigo-400 hover:text-indigo-300 block mb-4"
            >
              ↓ Unduh template Master SKU
            </a>
            <label className="inline-block bg-indigo-600 hover:bg-indigo-500 text-white font-semibold py-3 px-6 rounded-lg cursor-pointer shadow-lg">
              {uploadMasterBusy ? "Mengunggah…" : "Pilih file Master SKU"}
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
                  Validasi: total {String(masterValidation.total_rows ?? 0)} | valid{" "}
                  {String(masterValidation.valid_rows ?? 0)} | error{" "}
                  {String(masterValidation.error_rows ?? 0)}
                </p>
                <button
                  type="button"
                  disabled={uploadMasterBusy || Number(masterValidation.valid_rows ?? 0) <= 0}
                  onClick={onCommitMasterSku}
                  className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-semibold py-2 px-4 rounded-lg"
                >
                  Simpan Data Valid
                </button>
                <p className="text-xs text-slate-500">
                  SKU dengan kode yang sama akan di-<strong>update</strong>, bukan ditolak.
                </p>
              </div>
            )}
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-2xl shadow-xl p-6">
            <h2 className="text-xl font-bold text-white mb-2">Error preview</h2>
            {!masterValidation && <p className="text-slate-500 text-sm">Belum ada validasi.</p>}
            {masterValidation && (
              <div className="text-slate-300 text-sm space-y-2">
                {Array.isArray(masterValidation.errors) &&
                masterValidation.errors.length > 0 ? (
                  <div className="space-y-2">
                    {(masterValidation.errors as any[]).slice(0, 20).map((e, idx) => (
                      <div
                        key={idx}
                        className="border border-slate-800 rounded-lg px-3 py-2 bg-slate-950/30"
                      >
                        <div className="font-mono text-slate-400">
                          row {String(e.row ?? "?")}
                        </div>
                        <div className="text-red-300">{String(e.message ?? "")}</div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-emerald-300">Tidak ada error.</p>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
