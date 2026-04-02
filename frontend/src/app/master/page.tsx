"use client";

import { useCallback, useEffect, useState } from "react";
import {
  demandTemplateUrl,
  listMasterSkus,
  saveMasterSku,
  uploadDemandExcel,
  type MasterSku,
} from "@/lib/api";

const emptyForm = {
  sku: "",
  nama_item: "",
  unit: "pcs",
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
  const [uploadBusy, setUploadBusy] = useState(false);

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

  const onUpload = async (file: File | null) => {
    if (!file) return;
    setUploadBusy(true);
    setErr(null);
    setMsg(null);
    try {
      const r = await uploadDemandExcel(file);
      setMsg(`Upload demand: +${r.inserted} baru, ${r.updated} diperbarui (${r.rows_in_file} baris).`);
      reload();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setUploadBusy(false);
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in zoom-in duration-500">
      <div className="flex items-center justify-between pb-4 border-b border-slate-800">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight bg-gradient-to-br from-white to-slate-400 bg-clip-text text-transparent">
            Master Data & Upload
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            Master SKU dan unggah demand harian · data tersimpan ke database untuk analytics
          </p>
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
          Upload demand
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
                ["pack_size", "Pack size", "number"],
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
        <div className="bg-slate-900 border border-slate-800 rounded-2xl shadow-xl p-8 max-w-3xl mx-auto mt-6 relative overflow-hidden group">
          <div className="relative z-10">
            <h2 className="text-2xl font-bold text-white mb-2">Unggah demand harian</h2>
            <p className="text-slate-400 mb-6 text-sm">
              Kolom: <strong className="text-slate-300">Date</strong>,{" "}
              <strong className="text-slate-300">SKU</strong>,{" "}
              <strong className="text-slate-300">Demand</strong>, opsional{" "}
              <strong className="text-slate-300">Promo_Discount</strong>. SKU harus sudah ada di
              master.
            </p>
            <a
              href={demandTemplateUrl()}
              className="text-sm text-indigo-400 hover:text-indigo-300 block mb-6"
            >
              ↓ Unduh template Excel
            </a>
            <label className="inline-block bg-indigo-600 hover:bg-indigo-500 text-white font-semibold py-3 px-6 rounded-lg cursor-pointer shadow-lg">
              {uploadBusy ? "Mengunggah…" : "Pilih file Excel"}
              <input
                type="file"
                className="hidden"
                accept=".xlsx,.xls"
                disabled={uploadBusy}
                onChange={(e) => onUpload(e.target.files?.[0] ?? null)}
              />
            </label>
          </div>
        </div>
      )}
    </div>
  );
}
