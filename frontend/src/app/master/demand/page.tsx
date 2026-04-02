"use client";

import { useEffect, useState } from "react";
import {
  demandTemplateUrl,
  listDemandRows,
  validateDemandExcel,
  uploadDemandExcel,
  type DemandRow,
} from "@/lib/api";

export default function MasterDemandPage() {
  const [uploadBusy, setUploadBusy] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [validation, setValidation] = useState<Record<string, unknown> | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [rows, setRows] = useState<DemandRow[]>([]);
  const [listBusy, setListBusy] = useState(false);

  const reloadList = async () => {
    setListBusy(true);
    try {
      const r = await listDemandRows({ limit: 100 });
      setRows(r.rows ?? []);
    } catch (e) {
      // Keep UI non-blocking; upload can still work.
      // eslint-disable-next-line no-console
      console.error(e);
    } finally {
      setListBusy(false);
    }
  };

  useEffect(() => {
    void reloadList();
  }, []);

  const onValidate = async (f: File | null) => {
    if (!f) return;
    setFile(f);
    setValidation(null);
    setErr(null);
    setMsg(null);
    setUploadBusy(true);
    try {
      const r = await validateDemandExcel(f);
      setValidation(r);
      setMsg(`Validasi selesai. valid=${String(r.valid_rows ?? 0)} error=${String(r.error_rows ?? 0)}`);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setUploadBusy(false);
    }
  };

  const onCommit = async () => {
    if (!file) return;
    const validRows = Number(validation?.valid_rows ?? 0);
    if (!validRows) return;

    setErr(null);
    setMsg(null);
    setUploadBusy(true);
    try {
      const r = await uploadDemandExcel(file);
      setMsg(`Upload demand: +${r.inserted} baru, ${r.updated} diperbarui (${r.rows_in_file} baris).`);
      setValidation(null);
      setFile(null);
      await reloadList();
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
            Master Demand
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            Upload demand harian (dari Excel) dengan preview validasi sebelum simpan.
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

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-5xl mx-auto mt-6">
        <div className="bg-slate-900 border border-slate-800 rounded-2xl shadow-xl p-6">
          <h2 className="text-xl font-bold text-white mb-2">Validasi & preview</h2>
          <p className="text-slate-400 mb-4 text-sm">
            Kolom wajib: <strong>Date</strong>, <strong>SKU</strong>, <strong>Demand</strong>. Kolom promo opsional: <strong>Promo_Discount</strong>.
          </p>

          <a
            href={demandTemplateUrl()}
            className="text-sm text-indigo-400 hover:text-indigo-300 block mb-4"
          >
            ↓ Unduh template Demand
          </a>

          <label className="inline-block bg-indigo-600 hover:bg-indigo-500 text-white font-semibold py-3 px-6 rounded-lg cursor-pointer shadow-lg">
            {uploadBusy ? "Memproses…" : "Pilih file Excel"}
            <input
              type="file"
              className="hidden"
              accept=".xlsx,.xls"
              disabled={uploadBusy}
              onChange={(e) => onValidate(e.target.files?.[0] ?? null)}
            />
          </label>

          {validation && (
            <div className="mt-4 text-sm text-slate-300 space-y-2">
              <p>
                Total {String(validation.total_rows ?? 0)} · valid{" "}
                {String(validation.valid_rows ?? 0)} · error{" "}
                {String(validation.error_rows ?? 0)}
              </p>

              <button
                type="button"
                disabled={uploadBusy || Number(validation.valid_rows ?? 0) <= 0}
                onClick={onCommit}
                className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-semibold py-2 px-4 rounded-lg"
              >
                Simpan Data Valid
              </button>
            </div>
          )}
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-2xl shadow-xl p-6">
          <h2 className="text-xl font-bold text-white mb-2">Error preview</h2>
          {!validation && (
            <p className="text-slate-500 text-sm">Belum ada validasi.</p>
          )}

          {validation && (
            <div className="text-slate-300 text-sm space-y-2">
              {Array.isArray(validation.errors) && validation.errors.length > 0 ? (
                <div className="space-y-2">
                  {(validation.errors as any[]).slice(0, 20).map((e, idx) => (
                    <div
                      key={idx}
                      className="border border-slate-800 rounded-lg px-3 py-2 bg-slate-950/30"
                    >
                      <div className="font-mono text-slate-400">
                        row {String(e.row ?? "?" )}
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

      <div className="bg-slate-900 border border-slate-800 rounded-2xl shadow-xl p-6 max-w-5xl mx-auto">
        <div className="flex items-center justify-between pb-4 border-b border-slate-800">
          <h2 className="text-lg font-bold text-white">Daftar demand (terbaru)</h2>
          <p className="text-xs text-slate-500">{listBusy ? "Memuat…" : `Showing ${rows.length}`}</p>
        </div>

        <div className="overflow-x-auto mt-4">
          <table className="w-full text-left text-sm text-slate-300">
            <thead className="bg-slate-950 text-slate-400 border-b border-slate-800">
              <tr>
                <th className="px-3 py-3 font-medium">Date</th>
                <th className="px-3 py-3 font-medium">SKU</th>
                <th className="px-3 py-3 font-medium">Nama</th>
                <th className="px-3 py-3 font-medium">Group</th>
                <th className="px-3 py-3 font-medium text-right">Demand</th>
                <th className="px-3 py-3 font-medium text-right">Promo</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-3 py-4 text-center text-slate-500">
                    Belum ada data demand di database.
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr key={r.id} className="hover:bg-slate-800/40 transition-colors">
                    <td className="px-3 py-3">{r.date ?? "—"}</td>
                    <td className="px-3 py-3 font-semibold text-white">{r.sku}</td>
                    <td className="px-3 py-3 max-w-[220px] truncate">{r.nama_item ?? "—"}</td>
                    <td className="px-3 py-3 max-w-[180px] truncate">{r.group ?? "—"}</td>
                    <td className="px-3 py-3 text-right text-emerald-300">
                      {Number(r.demand).toFixed(2)}
                    </td>
                    <td className="px-3 py-3 text-right text-amber-300">
                      {Number(r.promo_discount).toFixed(2)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

