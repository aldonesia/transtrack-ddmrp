"use client";

import { useEffect, useMemo, useState } from "react";
import { getReplenishmentPlan, listSkus, type ReplenishmentRecommendation, type SkuRow } from "@/lib/api";

export default function Replenishment() {
  const [skuList, setSkuList] = useState<SkuRow[]>([]);
  const [selectedSku, setSelectedSku] = useState<string>("");
  const [plan, setPlan] = useState<{
    sku: string;
    unit?: string;
    qty_per_carton?: number;
    buffer_id: number;
    today_date: string | null;
    leadtime_days: number;
    recommendations: ReplenishmentRecommendation[];
  } | null>(null);

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const canRun = useMemo(() => selectedSku.trim().length > 0, [selectedSku]);
  const selectedSkuMeta = useMemo(
    () => skuList.find((s) => String(s["ID Item"]) === String(selectedSku)),
    [skuList, selectedSku]
  );

  const loadSkus = async () => {
    try {
      const d = await listSkus();
      setSkuList(d.skus ?? []);
      if (d.skus?.length && !selectedSku) {
        setSelectedSku(String(d.skus[0]["ID Item"]));
      }
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  const loadPlan = async (sku: string) => {
    setLoading(true);
    setErr(null);
    try {
      const p = await getReplenishmentPlan(sku);
      setPlan(p);
    } catch (e: unknown) {
      setPlan(null);
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadSkus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!canRun) return;
    void loadPlan(selectedSku);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canRun, selectedSku]);

  return (
    <div className="space-y-6 animate-in fade-in zoom-in duration-500">
      <div className="flex items-center justify-between pb-4 border-b border-slate-800">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight bg-gradient-to-br from-white to-slate-400 bg-clip-text text-transparent">
            Rekomendasi Replenishment
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            Menggunakan buffer aktif yang disimpan setelah `forecast + DDMRP + GA`.
          </p>
        </div>
      </div>

      {err && (
        <div className="rounded-xl border border-red-900/50 bg-red-950/30 text-red-200 px-4 py-3 text-sm">
          {err}
        </div>
      )}

      <div className="flex flex-wrap gap-4 items-end bg-slate-900/50 p-4 rounded-xl border border-slate-800">
        <div>
          <label className="block text-xs text-slate-500 mb-1">SKU</label>
          <select
            value={selectedSku}
            onChange={(e) => setSelectedSku(e.target.value)}
            className="bg-slate-950 border border-slate-700 text-sm rounded-lg px-3 py-2 text-white min-w-[240px]"
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
        {selectedSkuMeta ? (
          <div className="text-xs text-slate-400 pb-1">
            ADU: <span className="font-mono text-slate-200">{Number(selectedSkuMeta.ADU ?? 0).toFixed(2)}</span> CTN
            {" · "}Total demand:{" "}
            <span className="font-mono text-slate-200">{Number(selectedSkuMeta.Total_Demand ?? 0).toFixed(2)}</span> CTN
          </div>
        ) : null}

        <button
          type="button"
          disabled={!canRun || loading}
          onClick={() => void loadPlan(selectedSku)}
          className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-semibold shadow-lg shadow-indigo-500/20"
        >
          {loading ? "Memuat…" : "Refresh"}
        </button>
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-2xl shadow-xl overflow-hidden">
        <div className="p-6 border-b border-slate-800 flex items-start justify-between gap-4 bg-slate-900/50">
          <div>
            <h2 className="text-lg font-bold text-white">Rekomendasi order qty</h2>
            <p className="text-xs text-slate-400 mt-1">
              {plan ? (
                <>
                  Today (server): <span className="font-mono text-indigo-300">{plan.today_date ?? "—"}</span> · Lead time:{' '}
                  <span className="font-mono text-indigo-300">{plan.leadtime_days}</span> hari
                  {plan.qty_per_carton ? (
                    <>
                      {" "}· Unit: <span className="font-mono text-indigo-300">{plan.unit ?? "CTN"}</span> (1 CTN ={" "}
                      <span className="font-mono text-indigo-300">{plan.qty_per_carton}</span> pcs)
                    </>
                  ) : null}
                </>
              ) : (
                "Jalankan forecast di tab Analytics untuk menghasilkan buffer aktif."
              )}
            </p>
            {plan ? (
              <p className="text-[11px] text-slate-500 mt-1">
                `Today (server)` adalah tanggal acuan plan buffer aktif (bukan jam lokal browser).
              </p>
            ) : null}
          </div>
          {plan ? (
            <div className="text-xs text-slate-500 font-mono">buffer_id={plan.buffer_id}</div>
          ) : null}
        </div>

        <div className="p-6">
          {!plan ? (
            <p className="text-slate-500 text-sm">
              Belum ada rencana replenishment untuk SKU terpilih.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm text-slate-300">
                <thead className="bg-slate-950 text-slate-400 border-b border-slate-800">
                  <tr>
                    <th className="px-4 py-3 font-medium">Tanggal</th>
                    <th className="px-4 py-3 font-medium text-right">Order Qty (CTN)</th>
                    <th className="px-4 py-3 font-medium text-right">NFE (CTN)</th>
                    <th className="px-4 py-3 font-medium">Zona</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {plan.recommendations.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-4 py-4 text-center text-slate-500">
                        Tidak ada rekomendasi pada window lead time.
                      </td>
                    </tr>
                  ) : (
                    plan.recommendations.map((r, idx) => (
                      <tr key={`${r.date ?? "x"}-${idx}`} className="hover:bg-slate-800/40">
                        <td className="px-4 py-3">{r.date ?? "—"}</td>
                        <td className="px-4 py-3 text-right text-emerald-300 font-semibold">
                          {Number(r.order_qty).toFixed(2)}
                        </td>
                        <td className="px-4 py-3 text-right text-slate-400">
                          {Number(r.nfe).toFixed(2)}
                        </td>
                        <td className="px-4 py-3">
                          <span className="px-2 py-1 rounded bg-slate-800/30 border border-slate-700 text-slate-300 text-xs font-bold">
                            {r.zone ?? "—"}
                          </span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
