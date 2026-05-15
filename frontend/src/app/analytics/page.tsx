"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  getActiveBufferDetail,
  getDatasetStatus,
  getLatestRun,
  getParitySnapshot,
  listSkus,
  runForecast,
  runForecastAndOptimize,
  runOptimize,
  type ForecastAndOptimizeResponse,
  type DatasetStatus,
  type SkuRow,
  type ParitySnapshot,
} from "@/lib/api";

function fmtDateDdMmYy(iso: string | null | undefined): string {
  if (!iso) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (m) return `${m[3]}/${m[2]}/${m[1].slice(-2)}`;
  return iso;
}

function ForecastChart({
  testDates,
  actual,
  predicted,
  unit = "EA",
}: {
  testDates: string[];
  actual: number[];
  predicted: number[];
  unit?: string;
}) {
  const w = 860;
  const h = 360;
  const pad = 56;
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

  const yTicks = 5;
  const yTickValues = Array.from({ length: yTicks + 1 }, (_, i) => ymin + (span * i) / yTicks);
  const xTickIdx = Array.from({ length: Math.min(n, 8) }, (_, i) =>
    Math.round((i * (n - 1)) / Math.max(Math.min(n, 8) - 1, 1))
  );
  // Adaptive density: reduce value labels when points are many.
  const labelEvery = n <= 30 ? 1 : n <= 70 ? 2 : n <= 120 ? 3 : 5;

  const points = (vals: number[], color: string) =>
    vals.map((v, i) => {
      const px = x(i);
      const py = y(v);
      const showLabel = i % labelEvery === 0 || i === vals.length - 1;
      return (
        <g key={`${color}-${i}`}>
          <circle cx={px} cy={py} r={2.6} fill={color}>
            <title>{`${testDates[i] ?? `Point ${i + 1}`}: ${v.toFixed(2)}`}</title>
          </circle>
          {showLabel ? (
            <text
              x={px + 3}
              y={py - 5}
              className="fill-slate-400 text-[9px]"
            >
              {v.toFixed(1)}
            </text>
          ) : null}
        </g>
      );
    });

  return (
    <div className="overflow-x-auto">
      <svg width={w} height={h} className="text-slate-200">
        <rect x={0} y={0} width={w} height={h} fill="transparent" />
        {/* Y grid + ticks */}
        {yTickValues.map((yv, i) => (
          <g key={`y-${i}`}>
            <line
              x1={pad}
              y1={y(yv)}
              x2={w - pad}
              y2={y(yv)}
              stroke="#334155"
              strokeWidth={1}
              strokeDasharray="3 4"
            />
            <text x={pad - 8} y={y(yv) + 3} textAnchor="end" className="fill-slate-500 text-[10px]">
              {yv.toFixed(1)}
            </text>
          </g>
        ))}
        {/* X ticks */}
        {xTickIdx.map((idx) => (
          <g key={`x-${idx}`}>
            <line x1={x(idx)} y1={h - pad} x2={x(idx)} y2={h - pad + 4} stroke="#64748b" strokeWidth={1} />
            <text x={x(idx)} y={h - pad + 16} textAnchor="middle" className="fill-slate-500 text-[10px]">
              {testDates[idx] ?? idx + 1}
            </text>
          </g>
        ))}
        {/* Axis lines */}
        <line x1={pad} y1={pad} x2={pad} y2={h - pad} stroke="#94a3b8" strokeWidth={1.2} />
        <line x1={pad} y1={h - pad} x2={w - pad} y2={h - pad} stroke="#94a3b8" strokeWidth={1.2} />
        {line(actual, "#38bdf8", false)}
        {line(predicted, "#a78bfa", true)}
        {points(actual, "#38bdf8")}
        {points(predicted, "#a78bfa")}
        <text x={w / 2} y={h - 8} textAnchor="middle" className="fill-slate-400 text-[11px]">
          X: Test period date
        </text>
        <text
          x={14}
          y={h / 2}
          transform={`rotate(-90 14 ${h / 2})`}
          textAnchor="middle"
          className="fill-slate-400 text-[11px]"
        >
          Y: Demand ({unit})
        </text>
        <text x={pad} y={18} className="fill-slate-400 text-[10px]">
          Actual (solid) vs best forecast (dashed)
        </text>
        <text x={w - pad} y={18} textAnchor="end" className="fill-slate-500 text-[9px]">
          Adaptive point labels: every {labelEvery} points
        </text>
      </svg>
      <p className="text-[11px] text-slate-500 mt-1">
        Test period: {testDates[0] ?? "—"} … {testDates[testDates.length - 1] ?? "—"} (
        {n} days)
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
  const [popSize, setPopSize] = useState(30);
  const [nGen, setNGen] = useState(80);
  const [latestRunAt, setLatestRunAt] = useState<string | null>(null);
  const [paritySnapshot, setParitySnapshot] = useState<ParitySnapshot | null>(null);
  const [activeBuffer, setActiveBuffer] = useState<Awaited<ReturnType<typeof getActiveBufferDetail>> | null>(null);
  const [showAllBufferRows, setShowAllBufferRows] = useState(false);

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
          message: "Unable to reach API.",
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
          setForecast(null);
          setOptimize(null);
          return;
        }
        setForecast(d.latest_run.forecast);
        setOptimize(d.latest_run.optimize);
        setLatestRunAt(d.latest_run.run_at);
      })
      .catch(() => {
        setLatestRunAt(null);
        setForecast(null);
        setOptimize(null);
      });
  }, [selectedSku]);

  useEffect(() => {
    if (!selectedSku) return;
    getActiveBufferDetail(selectedSku)
      .then((d) => setActiveBuffer(d))
      .catch(() => setActiveBuffer(null));
  }, [selectedSku]);

  useEffect(() => {
    setShowAllBufferRows(false);
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

  const planningUnit =
    String(optimize?.unit ?? forecast?.unit ?? "EA").toUpperCase();

  const refreshActiveBuffer = () => {
    if (!selectedSku) return;
    getActiveBufferDetail(selectedSku)
      .then((d) => setActiveBuffer(d))
      .catch(() => setActiveBuffer(null));
  };

  const onSelectSku = (sku: string) => {
    setSelectedSku(sku);
    setForecast(null);
    setOptimize(null);
    setLatestRunAt(null);
    setParitySnapshot(null);
    setActiveBuffer(null);
    setError(null);
  };

  const onRunForecast = async () => {
    if (selectedSku === "") return;
    setLoading(true);
    setError(null);
    try {
      const fc = await runForecast(selectedSku);
      setForecast(fc);
      setLatestRunAt(new Date().toISOString());
      setActiveTab("forecasting");
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
      const opt = await runOptimize(selectedSku, {
        sl_target: slTarget,
        pop_size: popSize,
        n_gen: nGen,
        include_baseline: true,
      });
      setOptimize(opt);
      setLatestRunAt(new Date().toISOString());
      setActiveTab("optimasi");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const onRunFullPipeline = async () => {
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
      setActiveTab("aktif");
      refreshActiveBuffer();
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
      setParitySnapshot(p);
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
      <div className="flex flex-col gap-3 border-b border-slate-800 pb-4">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight bg-gradient-to-br from-white to-slate-400 bg-clip-text text-transparent">
            Analytics &amp; Buffer
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            Hybrid notebook flow (RUN 2 → 3 → 4): forecast, ADI-CV² + GA buffer, replenishment window.
            Planning unit: <span className="font-mono text-slate-300">{planningUnit}</span>
          </p>
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
            {dataset.ready_for_forecast ? "DB data ready for forecast" : "Complete master + demand"}
          </p>
          <p className="text-xs opacity-90 mt-1">
            Master: {dataset.master_rows} SKUs · Daily rows: {dataset.daily_rows} · SKUs with demand:{" "}
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
            onChange={(e) => onSelectSku(e.target.value ? e.target.value : "")}
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
            ADU: <span className="font-mono text-slate-200">{Number(selectedSkuMeta.ADU ?? 0).toFixed(2)}</span>{" "}
            {planningUnit}
            {" · "}Total demand:{" "}
            <span className="font-mono text-slate-200">{Number(selectedSkuMeta.Total_Demand ?? 0).toFixed(2)}</span>{" "}
            {planningUnit}
          </div>
        ) : null}
        <button
          type="button"
          disabled={loading || selectedSku === ""}
          onClick={() => void onRunFullPipeline()}
          className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-semibold shadow-lg shadow-indigo-500/20"
        >
          {loading ? "Processing…" : "Run full pipeline"}
        </button>
        <button
          type="button"
          disabled={loading || selectedSku === ""}
          onClick={onParityCheck}
          className="bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-white px-3 py-2 rounded-lg text-xs font-semibold"
        >
          {loading ? "Checking…" : "Parity Snapshot"}
        </button>
      </div>
      {paritySnapshot && (
        <div className="rounded-xl border border-slate-800 bg-slate-900/40 text-slate-300 px-4 py-3 text-xs space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-medium text-slate-200">
              Parity snapshot — SKU <span className="font-mono">{paritySnapshot.sku}</span>
            </p>
            <button
              type="button"
              onClick={() => setParitySnapshot(null)}
              className="text-slate-500 hover:text-slate-300 text-[11px]"
            >
              Close
            </button>
          </div>
          <p className="text-[11px] text-slate-500">
            Compare with the Last Version notebook output (README → Parity Check). Figures below are
            recomputed from the DB when you click (not from the stored latest run).
          </p>
          <pre className="font-mono text-[11px] leading-relaxed overflow-x-auto max-h-80 overflow-y-auto text-slate-400 bg-slate-950/80 rounded-lg p-3 border border-slate-800/80">
            {JSON.stringify(paritySnapshot, null, 2)}
          </pre>
        </div>
      )}

      <div className="rounded-xl border border-slate-800 bg-slate-900/50 px-4 py-3">
        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-2">Notebook flow</p>
        <ol className="flex flex-wrap gap-2 text-xs text-slate-400">
          {[
            "RUN 2 — Forecast (model ranking)",
            "RUN 3 — ADI-CV² classify + DDMRP simulate + GA",
            "RUN 4 — Active buffer & replenishment window",
          ].map((step) => (
            <li key={step} className="rounded-md border border-slate-700 bg-slate-950/60 px-2.5 py-1">
              {step}
            </li>
          ))}
        </ol>
      </div>

      <div className="flex flex-wrap gap-2 bg-slate-900/50 p-1 rounded-xl w-fit border border-slate-800">
        {[
          ["forecasting", "RUN 2 — Forecast"],
          ["parameter", "RUN 3 — Classify & GA"],
          ["optimasi", "RUN 3 — Results"],
          ["aktif", "RUN 4 — Active buffer"],
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
              Latest out-of-sample (~20% of days): compare models; best metrics drive buffer simulation.
            </p>
            <button
              type="button"
              disabled={loading || selectedSku === ""}
              onClick={onRunForecast}
              className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-semibold"
            >
              {loading ? "Processing…" : "Run forecast"}
            </button>

            {bestMetrics != null ? (
              <div className="mt-6 space-y-2">
                <p className="text-sm text-slate-300">
                  Best model:{" "}
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
            <h3 className="text-white font-bold mb-4">Chart — test period</h3>
            {forecast != null &&
            bestPred != null &&
            Array.isArray(forecast.actual_test) ? (
              <ForecastChart
                testDates={forecast.test_dates as string[]}
                actual={forecast.actual_test as number[]}
                predicted={bestPred}
                unit={planningUnit}
              />
            ) : null}
            {!forecast && (
              <p className="text-slate-500 text-sm">Run forecast to see the chart.</p>
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
            <h3 className="text-white font-bold mb-4">Buffer optimization parameters (GA)</h3>
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
                <label className="block text-xs text-slate-400 mb-1">GA population</label>
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
                <label className="block text-xs text-slate-400 mb-1">Generations</label>
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
              Runs forecast + ADI-CV² classification + DDMRP simulation + GA per notebook.
              May take seconds to minutes.
            </p>
            <button
              type="button"
              disabled={loading || selectedSku === ""}
              onClick={onRunOptimize}
              className="mt-6 w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white py-3 rounded-lg font-semibold shadow-lg shadow-indigo-500/20"
            >
              {loading ? "Processing…" : "Optimize only (RUN 3)"}
            </button>
            <button
              type="button"
              disabled={loading || selectedSku === ""}
              onClick={() => void onRunFullPipeline()}
              className="mt-2 w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white py-3 rounded-lg font-semibold shadow-lg shadow-indigo-500/20"
            >
              {loading ? "Processing…" : "Run full pipeline (RUN 2→4)"}
            </button>
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-2xl shadow-xl p-6">
            <h3 className="text-white font-bold mb-4">ADI-CV² classification (notebook RUN 3)</h3>
            {clf ? (
              <div className="space-y-3 text-sm text-slate-300">
                <p>
                  Category: <span className="text-amber-400 font-semibold">{String(clf.category)}</span>
                </p>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    ["ADI", clf.adi],
                    ["CV²", clf.cv2],
                    ["DLT (days)", clf.dlt],
                    ["ADU", clf.adu],
                    ["BZR", clf.bzr],
                    ["DOC", clf.doc],
                    ["DBO (days)", clf.dbo],
                    ["MOQ", clf.moq],
                    ["TOR", clf.tor],
                    ["TOY", clf.toy],
                    ["TOG", clf.tog],
                    ["VF init", clf.vf_init],
                    ["LTF init", clf.ltf_init],
                  ].map(([label, val]) => (
                    <div
                      key={String(label)}
                      className="flex justify-between border border-slate-800 rounded-lg px-3 py-2"
                    >
                      <span className="text-slate-500">{String(label)}</span>
                      <span className="text-white font-mono">{String(val ?? "—")}</span>
                    </div>
                  ))}
                </div>
                <p className="text-xs text-slate-500">
                  VF search: {String(clf.vf_low)} – {String(clf.vf_high)} · LTF search:{" "}
                  {String(clf.ltf_low)} – {String(clf.ltf_high)} · Unit: {planningUnit}
                </p>
              </div>
            ) : (
              <p className="text-slate-500 text-sm">No results yet — run optimization or full pipeline.</p>
            )}
          </div>
        </div>
      )}

      {activeTab === "optimasi" && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl shadow-xl overflow-hidden mt-2">
          <div className="p-6 border-b border-slate-800 flex justify-between items-center bg-slate-900/50">
            <div>
              <h2 className="text-lg font-bold text-white">Buffer optimization results</h2>
              <p className="text-xs text-slate-400">
                Model forecast:{" "}
                <span className="font-mono text-indigo-400">
                  {optimize?.forecast_best_model ? String(optimize.forecast_best_model) : "—"}
                </span>
              </p>
            </div>
          </div>

          {!optimize && (
            <p className="p-8 text-slate-500 text-sm">Run optimization from the Parameters tab.</p>
          )}

          {optimize != null ? (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm text-slate-300">
                <thead className="bg-slate-950 text-slate-400 border-b border-slate-800">
                  <tr>
                    <th className="px-6 py-4 font-medium">Scenario</th>
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
        <div className="space-y-4 mt-2">
          {!activeBuffer ? (
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-8 text-slate-400 text-sm">
              <p>
                No active buffer for this SKU. Use{" "}
                <button
                  type="button"
                  onClick={() => void onRunFullPipeline()}
                  className="text-indigo-400 hover:text-indigo-300 underline"
                >
                  Run full pipeline
                </button>{" "}
                on RUN 3 tab or the toolbar.
              </p>
            </div>
          ) : (
            <>
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6">
                <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                  <h3 className="text-white font-bold">Selected active buffer (RUN 4)</h3>
                  <Link
                    href="/replenishment"
                    className="text-xs text-indigo-400 hover:text-indigo-300 underline"
                  >
                    Open replenishment page →
                  </Link>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
                  <div className="border border-slate-800 rounded-lg px-3 py-2">
                    <p className="text-slate-500">Buffer ID</p>
                    <p className="text-white font-mono">{activeBuffer.buffer_id}</p>
                  </div>
                  <div className="border border-slate-800 rounded-lg px-3 py-2">
                    <p className="text-slate-500">Version</p>
                    <p className="text-white font-mono">{activeBuffer.version}</p>
                  </div>
                  <div className="border border-slate-800 rounded-lg px-3 py-2">
                    <p className="text-slate-500">Status</p>
                    <p className="text-emerald-300 font-mono">{activeBuffer.status}</p>
                  </div>
                  <div className="border border-slate-800 rounded-lg px-3 py-2">
                    <p className="text-slate-500">Active period</p>
                    <p className="text-white font-mono">
                      {fmtDateDdMmYy(activeBuffer.start_date)} to {fmtDateDdMmYy(activeBuffer.end_date)}
                    </p>
                  </div>
                  <div className="border border-slate-800 rounded-lg px-3 py-2">
                    <p className="text-slate-500">DLT / ADU</p>
                    <p className="text-white font-mono">
                      {activeBuffer.dlt} days / {activeBuffer.adu.toFixed(2)} {activeBuffer.unit}
                    </p>
                  </div>
                  <div className="border border-slate-800 rounded-lg px-3 py-2">
                    <p className="text-slate-500">VF / LTF</p>
                    <p className="text-white font-mono">
                      {activeBuffer.vf_opt.toFixed(4)} / {activeBuffer.ltf_opt.toFixed(4)}
                    </p>
                  </div>
                  <div className="border border-slate-800 rounded-lg px-3 py-2">
                    <p className="text-slate-500">TOR / TOY / TOG ({activeBuffer.unit})</p>
                    <p className="text-white font-mono">
                      {activeBuffer.tor.toFixed(2)} / {activeBuffer.toy.toFixed(2)} / {activeBuffer.tog.toFixed(2)}
                    </p>
                  </div>
                  <div className="border border-slate-800 rounded-lg px-3 py-2">
                    <p className="text-slate-500">Replenishment summary</p>
                    <p className="text-white font-mono">
                      order_days={activeBuffer.summary.n_order_days}, total_order={activeBuffer.summary.total_order_qty}
                    </p>
                  </div>
                </div>
              </div>

              <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
                <div className="p-4 border-b border-slate-800 flex items-center justify-between gap-3">
                  <h3 className="text-white font-bold">Replenishment window (active buffer)</h3>
                  <button
                    type="button"
                    onClick={() => setShowAllBufferRows((v) => !v)}
                    className="text-xs px-3 py-1.5 rounded-md border border-slate-700 text-slate-300 hover:bg-slate-800"
                  >
                    {showAllBufferRows ? "Show last 31 days" : "Show all days"}
                  </button>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm text-slate-300">
                    <thead className="bg-slate-950 text-slate-400 border-b border-slate-800">
                      <tr>
                        <th className="px-4 py-3 font-medium">Date</th>
                        <th className="px-4 py-3 font-medium text-right">Order Qty ({activeBuffer.unit})</th>
                        <th className="px-4 py-3 font-medium text-right">NFE ({activeBuffer.unit})</th>
                        <th className="px-4 py-3 font-medium">Zone</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60">
                      {(showAllBufferRows
                        ? activeBuffer.recommendations
                        : activeBuffer.recommendations.slice(0, 31)
                      ).map((r, idx) => (
                        <tr key={`${r.date ?? "x"}-${idx}`} className="hover:bg-slate-800/40">
                          <td className="px-4 py-2">{fmtDateDdMmYy(r.date)}</td>
                          <td className="px-4 py-2 text-right text-emerald-300">{Number(r.order_qty).toFixed(2)}</td>
                          <td className="px-4 py-2 text-right">{Number(r.nfe).toFixed(2)}</td>
                          <td className="px-4 py-2">{r.zone ?? "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
