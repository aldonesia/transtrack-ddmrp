"use client";

import { useEffect, useMemo, useState } from "react";
import {
  getDatasetStatus,
  getLatestRun,
  getParitySnapshot,
  listSkus,
  runForecastAndOptimize,
  runOptimize,
  type ForecastAndOptimizeResponse,
  type DatasetStatus,
  type SkuRow,
} from "@/lib/api";

function ForecastChart({
  testDates,
  actual,
  predicted,
}: {
  testDates: string[];
  actual: number[];
  predicted: number[];
}) {
  const w = 640;
  const h = 220;
  const pad = 36;
  const innerW = w - pad * 2;
  const innerH = h - pad * 2;
  const n = Math.max(actual.length, predicted.length, 1);
  const all = [...actual, ...predicted];
  const ymax = Math.max(...all, 1);
  const ymin = Math.min(...all, 0);
  const span = ymax - ymin || 1;
  const x = (i: number) => pad + (i / Math.max(n - 1, 1)) * innerW;
  const y = (v: number) => pad + innerH - ((v - ymin) / span) * innerH;

  const line = (vals: number[], color: string, dash = false) => {
    if (!vals.length) return null;
    const d = vals
      .map((v, i) => `${i === 0 ? "M" : "L"} ${x(i).toFixed(1)} ${y(v).toFixed(1)}`)
      .join(" ");
    return (
      <path
        d={d}
        fill="none"
        stroke={color}
        strokeWidth={2}
        strokeDasharray={dash ? "6 4" : undefined}
      />
    );
  };

  return (
    <div className="overflow-x-auto">
      <svg width={w} height={h} className="text-slate-200">
        <rect x={0} y={0} width={w} height={h} fill="transparent" />
        {line(actual, "#38bdf8", false)}
        {line(predicted, "#a78bfa", true)}
        <text x={pad} y={18} className="fill-slate-400 text-[10px]">
          Aktual (solid) vs prediksi terbaik (dash)
        </text>
      </svg>
      <p className="text-[11px] text-slate-500 mt-1">
        Periode uji: {testDates[0] ?? "—"} … {testDates[testDates.length - 1] ?? "—"} (
        {n} hari)
      </p>
    </div>
  );
}

export default function Analytics() {
  const [activeTab, setActiveTab] = useState("forecasting");
  const [dataset, setDataset] = useState<DatasetStatus | null>(null);
  const [skuList, setSkuList] = useState<SkuRow[]>([]);
  const [selectedSku, setSelectedSku] = useState<string>("");
  const [forecast, setForecast] = useState<ForecastAndOptimizeResponse["forecast"] | null>(null);
  const [optimize, setOptimize] = useState<ForecastAndOptimizeResponse["optimize"] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [slTarget, setSlTarget] = useState(0.95);
  const [popSize, setPopSize] = useState(24);
  const [nGen, setNGen] = useState(40);
  const [latestRunAt, setLatestRunAt] = useState<string | null>(null);
  const [parityMsg, setParityMsg] = useState<string | null>(null);

  useEffect(() => {
    getDatasetStatus()
      .then(setDataset)
      .catch(() =>
        setDataset({
          source: "database",
          master_rows: 0,
          daily_rows: 0,
          skus_with_demand: 0,
          ready_for_forecast: false,
          message: "Tidak dapat menghubungi API.",
        })
      );
  }, []);

  useEffect(() => {
    listSkus()
      .then((d) => {
        setSkuList(d.skus ?? []);
        if (d.skus?.length) {
          setSelectedSku((prev) =>
            prev === "" ? String(d.skus![0]["ID Item"]) : prev
          );
        }
      })
      .catch((e) => setError(String(e.message)));
  }, []);

  useEffect(() => {
    if (!selectedSku) return;
    getLatestRun(selectedSku)
      .then((d) => {
        if (!d.latest_run) {
          setLatestRunAt(null);
          return;
        }
        setForecast(d.latest_run.forecast);
        setOptimize(d.latest_run.optimize);
        setLatestRunAt(d.latest_run.run_at);
      })
      .catch(() => {
        setLatestRunAt(null);
      });
  }, [selectedSku]);

  const bestPred = useMemo(() => {
    if (!forecast?.best_model || !forecast.predictions) return null;
    const bm = forecast.best_model as string;
    const preds = forecast.predictions as Record<string, number[]>;
    return preds[bm] ?? null;
  }, [forecast]);
  const selectedSkuMeta = useMemo(
    () => skuList.find((s) => String(s["ID Item"]) === String(selectedSku)),
    [skuList, selectedSku]
  );

  const onRunForecast = async () => {
    if (selectedSku === "") return;
    setLoading(true);
    setError(null);
    try {
      const data = await runForecastAndOptimize(selectedSku, {
        sl_target: slTarget,
        pop_size: popSize,
        n_gen: nGen,
        include_baseline: true,
      });
      setForecast(data.forecast);
      setOptimize(data.optimize);
      setLatestRunAt(new Date().toISOString());
      setActiveTab("optimasi");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const onRunOptimize = async () => {
    if (selectedSku === "") return;
    setLoading(true);
    setError(null);
    try {
      const data = await runForecastAndOptimize(selectedSku, {
        sl_target: slTarget,
        pop_size: popSize,
        n_gen: nGen,
        include_baseline: true,
      });
      setForecast(data.forecast);
      setOptimize(data.optimize);
      setLatestRunAt(new Date().toISOString());
      setActiveTab("optimasi");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const onParityCheck = async () => {
    if (!selectedSku) return;
    setLoading(true);
    setError(null);
    try {
      const p = await getParitySnapshot(selectedSku);
      setParityMsg(
        `Parity snapshot SKU ${String(p.sku)} · model=${String(p.forecast_best_model)} · MAE=${String(
          p.forecast_mae
        )} · optimized total_cost=${String((p.optimized as Record<string, unknown>)?.total_cost ?? "—")}`
      );
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const comparison = forecast?.comparison as
    | Array<Record<string, unknown>>
    | undefined;

  const clf = optimize?.classification as Record<string, unknown> | undefined;
  const opt = optimize?.optimized as { fv_opt?: number; ltf_opt?: number; kpi?: Record<string, unknown> } | undefined;
  const base = optimize?.baseline as Record<string, unknown> | undefined;

  const bestMetrics =
    forecast?.best_metrics != null && typeof forecast.best_metrics === "object"
      ? (forecast.best_metrics as Record<string, unknown>)
      : null;

  return (
    <div className="space-y-6 animate-in fade-in zoom-in duration-500">
      <div className="flex items-center justify-between pb-4 border-b border-slate-800">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight bg-gradient-to-br from-white to-slate-400 bg-clip-text text-transparent">
            Analytics & Parameter DDMRP
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            Forecasting dan optimasi buffer (hybrid notebook) per SKU terpilih
          </p>
          {forecast?.qty_per_carton ? (
            <p className="text-xs text-slate-500 mt-1">
              Unit kalkulasi: {forecast.unit ?? "CTN"} · 1 CTN = {forecast.qty_per_carton} pcs
            </p>
          ) : null}
          {latestRunAt ? (
            <p className="text-xs text-slate-500 mt-1">
              Latest run SKU: <span className="font-mono text-slate-300">{latestRunAt}</span>
            </p>
          ) : null}
        </div>
      </div>

      {dataset && (
        <div
          className={`rounded-xl border px-4 py-3 text-sm ${
            dataset.ready_for_forecast
              ? "border-emerald-900/50 bg-emerald-950/20 text-emerald-200"
              : "border-amber-900/50 bg-amber-950/20 text-amber-200"
          }`}
        >
          <p className="font-medium">
            {dataset.ready_for_forecast ? "Data DB siap untuk forecast" : "Lengkapi master + demand"}
          </p>
          <p className="text-xs opacity-90 mt-1">
            Master: {dataset.master_rows} SKU · Baris harian: {dataset.daily_rows} · SKU punya demand:{" "}
            {dataset.skus_with_demand}
          </p>
          <p className="text-xs mt-1">{dataset.message}</p>
        </div>
      )}

      {error && (
        <div className="rounded-xl border border-red-900/50 bg-red-950/30 text-red-200 px-4 py-3 text-sm">
          {error}
        </div>
      )}

      <div className="flex flex-wrap gap-4 items-end bg-slate-900/50 p-4 rounded-xl border border-slate-800">
        <div>
          <label className="block text-xs text-slate-500 mb-1">SKU</label>
          <select
            value={selectedSku === "" ? "" : selectedSku}
            onChange={(e) => setSelectedSku(e.target.value ? e.target.value : "")}
            className="bg-slate-950 border border-slate-700 text-sm rounded-lg px-3 py-2 text-white min-w-[200px]"
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
          disabled={loading || selectedSku === ""}
          onClick={onParityCheck}
          className="bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-white px-3 py-2 rounded-lg text-xs font-semibold"
        >
          {loading ? "Checking…" : "Parity Snapshot"}
        </button>
      </div>
      {parityMsg && (
        <div className="rounded-xl border border-slate-800 bg-slate-900/40 text-slate-300 px-4 py-3 text-xs">
          {parityMsg}
        </div>
      )}

      <div className="flex flex-wrap gap-2 bg-slate-900/50 p-1 rounded-xl w-fit border border-slate-800">
        {[
          ["forecasting", "Forecasting"],
          ["parameter", "Parameter & optimasi"],
          ["optimasi", "Hasil optimasi buffer"],
          ["aktif", "Buffer aktif"],
        ].map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setActiveTab(id)}
            className={`px-4 py-2 text-sm font-semibold rounded-lg transition-all ${
              activeTab === id
                ? "bg-indigo-600 text-white shadow-lg"
                : "text-slate-400 hover:text-white hover:bg-slate-800"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {activeTab === "forecasting" && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-2">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl shadow-xl p-6">
            <h2 className="text-lg font-bold text-white mb-2">Forecasting demand</h2>
            <p className="text-xs text-slate-400 mb-4">
              Out-of-sample terakhir (~20% hari): bandingkan model; metrik terbaik dipakai untuk
              simulasi buffer.
            </p>
            <button
              type="button"
              disabled={loading || selectedSku === ""}
              onClick={onRunForecast}
              className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-semibold"
            >
              {loading ? "Memproses…" : "Run forecast"}
            </button>

            {bestMetrics != null ? (
              <div className="mt-6 space-y-2">
                <p className="text-sm text-slate-300">
                  Model terbaik:{" "}
                  <span className="text-teal-400 font-mono">{String(forecast?.best_model ?? "")}</span>
                </p>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  {Object.entries(bestMetrics).map(([k, v]) => (
                    <div
                      key={k}
                      className="flex justify-between border border-slate-800 rounded-lg px-3 py-2"
                    >
                      <span className="text-slate-500">{k}</span>
                      <span className="text-white font-mono">{String(v)}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-2xl shadow-xl p-6">
            <h3 className="text-white font-bold mb-4">Grafik — periode uji</h3>
            {forecast != null &&
            bestPred != null &&
            Array.isArray(forecast.actual_test) ? (
              <ForecastChart
                testDates={forecast.test_dates as string[]}
                actual={forecast.actual_test as number[]}
                predicted={bestPred}
              />
            ) : null}
            {!forecast && (
              <p className="text-slate-500 text-sm">Jalankan forecast untuk melihat grafik.</p>
            )}
          </div>

          {comparison != null && comparison.length > 0 ? (
            <div className="lg:col-span-2 bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
              <div className="p-4 border-b border-slate-800">
                <h3 className="text-white font-bold">Ranking model (MAE)</h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm text-slate-300">
                  <thead className="bg-slate-950 text-slate-400">
                    <tr>
                      {Object.keys(comparison[0]).map((col) => (
                        <th key={col} className="px-4 py-3 font-medium">
                          {col}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60">
                    {comparison.slice(0, 12).map((row, i) => (
                      <tr key={i} className="hover:bg-slate-800/40">
                        {Object.values(row).map((cell, j) => (
                          <td key={j} className="px-4 py-2">
                            {String(cell ?? "")}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}
        </div>
      )}

      {activeTab === "parameter" && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-2">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl shadow-xl p-6">
            <h3 className="text-white font-bold mb-4">Parameter optimasi buffer (GA)</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-xs text-slate-400 mb-1">Service level target</label>
                <input
                  type="number"
                  step={0.01}
                  min={0.5}
                  max={0.999}
                  value={slTarget}
                  onChange={(e) => setSlTarget(Number(e.target.value))}
                  className="w-full bg-slate-950 border border-slate-700 text-sm rounded-lg px-4 py-2 text-white"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">Populasi GA</label>
                <input
                  type="number"
                  min={6}
                  max={80}
                  value={popSize}
                  onChange={(e) => setPopSize(Number(e.target.value))}
                  className="w-full bg-slate-950 border border-slate-700 text-sm rounded-lg px-4 py-2 text-white"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">Generasi</label>
                <input
                  type="number"
                  min={5}
                  max={120}
                  value={nGen}
                  onChange={(e) => setNGen(Number(e.target.value))}
                  className="w-full bg-slate-950 border border-slate-700 text-sm rounded-lg px-4 py-2 text-white"
                />
              </div>
            </div>
            <p className="text-xs text-slate-500 mt-4">
              Menjalankan forecast + klasifikasi ADI-CV² + simulasi DDMRP + GA sesuai notebook.
              Butuh beberapa detik hingga beberapa menit.
            </p>
            <button
              type="button"
              disabled={loading || selectedSku === ""}
              onClick={onRunOptimize}
              className="mt-6 w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white py-3 rounded-lg font-semibold shadow-lg shadow-indigo-500/20"
            >
              {loading ? "Memproses…" : "Run optimization"}
            </button>
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-2xl shadow-xl p-6">
            <h3 className="text-white font-bold mb-4">Klasifikasi (setelah optimasi)</h3>
            {clf ? (
              <ul className="space-y-2 text-sm text-slate-300">
                <li>
                  Kategori: <span className="text-amber-400">{String(clf.category)}</span>
                </li>
                <li>ADI: {String(clf.adi)} | CV²: {String(clf.cv2)}</li>
                <li>
                  Rentang VF: {String(clf.vf_low)} – {String(clf.vf_high)}
                </li>
                <li>
                  Rentang LTF: {String(clf.ltf_low)} – {String(clf.ltf_high)}
                </li>
              </ul>
            ) : (
              <p className="text-slate-500 text-sm">Belum ada hasil — jalankan optimasi.</p>
            )}
          </div>
        </div>
      )}

      {activeTab === "optimasi" && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl shadow-xl overflow-hidden mt-2">
          <div className="p-6 border-b border-slate-800 flex justify-between items-center bg-slate-900/50">
            <div>
              <h2 className="text-lg font-bold text-white">Hasil optimasi buffer</h2>
              <p className="text-xs text-slate-400">
                Model forecast:{" "}
                <span className="font-mono text-indigo-400">
                  {optimize?.forecast_best_model ? String(optimize.forecast_best_model) : "—"}
                </span>
              </p>
            </div>
          </div>

          {!optimize && (
            <p className="p-8 text-slate-500 text-sm">Jalankan optimasi dari tab Parameter.</p>
          )}

          {optimize != null ? (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm text-slate-300">
                <thead className="bg-slate-950 text-slate-400 border-b border-slate-800">
                  <tr>
                    <th className="px-6 py-4 font-medium">Skenario</th>
                    <th className="px-6 py-4 font-medium">FV</th>
                    <th className="px-6 py-4 font-medium">LTF</th>
                    <th className="px-6 py-4 font-medium">Fill rate</th>
                    <th className="px-6 py-4 font-medium">Total cost</th>
                    <th className="px-6 py-4 font-medium">TOR / TOY / TOG</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {base != null ? (
                    <tr className="hover:bg-slate-800/40">
                      <td className="px-6 py-4 font-semibold text-slate-400">Baseline</td>
                      <td className="px-6 py-4">{String(clf?.vf_init ?? "—")}</td>
                      <td className="px-6 py-4">{String(clf?.ltf_init ?? "—")}</td>
                      <td className="px-6 py-4">
                        {base.fill_rate != null
                          ? `${(Number(base.fill_rate) * 100).toFixed(2)}%`
                          : "—"}
                      </td>
                      <td className="px-6 py-4">{base.total_cost != null ? String(base.total_cost) : "—"}</td>
                      <td className="px-6 py-4 text-xs">
                        {String(base.tor ?? "—")}/{String(base.toy ?? "—")}/{String(base.tog ?? "—")}
                      </td>
                    </tr>
                  ) : null}
                  {opt != null ? (
                    <tr className="hover:bg-slate-800/40 bg-indigo-950/20">
                      <td className="px-6 py-4 font-semibold text-indigo-300">GA optimal</td>
                      <td className="px-6 py-4 text-amber-300 font-bold">{opt.fv_opt}</td>
                      <td className="px-6 py-4 text-amber-300 font-bold">{opt.ltf_opt}</td>
                      <td className="px-6 py-4">
                        {opt.kpi?.fill_rate != null
                          ? `${(Number(opt.kpi.fill_rate) * 100).toFixed(2)}%`
                          : "—"}
                      </td>
                      <td className="px-6 py-4">
                        {opt.kpi?.total_cost != null ? String(opt.kpi.total_cost) : "—"}
                      </td>
                      <td className="px-6 py-4 text-xs">
                        {String(opt.kpi?.tor ?? "—")}/{String(opt.kpi?.toy ?? "—")}/
                        {String(opt.kpi?.tog ?? "—")}
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>
      )}

      {activeTab === "aktif" && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-8 text-slate-400 text-sm">
          <p>
            Buffer aktif (versi periode, aktivasi planner) belum terhubung ke database. Gunakan
            hasil optimasi di tab sebelumnya sebagai draft.
          </p>
        </div>
      )}
    </div>
  );
}
