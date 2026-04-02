"use client";

import { useEffect, useState } from "react";
import { getApiBase } from "@/lib/api";

export default function Dashboard() {
  const [data, setData] = useState<any>(null);

  useEffect(() => {
    fetch(`${getApiBase()}/api/dashboard-summary`)
      .then((res) => res.json())
      .then(setData)
      .catch((err) => {
        // Keep UI resilient if backend is down.
        // eslint-disable-next-line no-console
        console.error(err);
        setData(null);
      });
  }, []);

  if (!data) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="animate-pulse flex space-x-4 text-blue-400">Loading Dashboard...</div>
      </div>
    );
  }

  const topCritical = Array.isArray(data.top_critical) ? data.top_critical : [];
  const fillRate = typeof data.fill_rate === "number" ? data.fill_rate : null;

  return (
    <div className="space-y-6 animate-in fade-in zoom-in duration-500">
      <div className="flex items-center justify-between pb-4 border-b border-slate-800">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight bg-gradient-to-br from-white to-slate-400 bg-clip-text text-transparent">
            Dashboard Distributor DDMRP
          </h1>
          <p className="text-sm text-slate-400 mt-1">Ringkasan operasional dan analitik buffer</p>
        </div>
        <div className="flex items-center bg-slate-900 px-4 py-2 rounded-xl backdrop-blur-md border border-slate-800 shadow-xl">
          <span className="text-xs text-slate-500 uppercase font-semibold mr-2">Periode</span>
          <span className="text-sm font-bold text-teal-400">Maret 2026</span>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
        {[
          { label: "Total SKU", value: data.total_sku, color: "from-blue-500 to-cyan-400" },
          { label: "Zona Merah", value: data.zona_merah, color: "from-red-500 to-rose-400" },
          { label: "Perlu Replenishment", value: data.perlu_replenishment, color: "from-amber-500 to-orange-400" },
          { label: "Open Order", value: data.open_order, color: "from-indigo-500 to-purple-400" },
          { label: "Buffer Active", value: data.buffer_active, color: "from-emerald-500 to-emerald-400" },
        ].map((stat, i) => (
          <div key={i} className="relative group overflow-hidden rounded-2xl bg-slate-900 p-6 border border-slate-800 shadow-lg hover:border-slate-600 transition-all duration-300">
            <div className={`absolute -inset-1 opacity-20 bg-gradient-to-r ${stat.color} blur-lg group-hover:opacity-40 transition-opacity`}></div>
            <div className="relative">
              <p className="text-sm font-medium text-slate-400">{stat.label}</p>
              <p className="mt-2 text-3xl font-bold tracking-tight text-white">{stat.value}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-8">
        <div className="md:col-span-2 bg-slate-900 border border-slate-800 rounded-2xl shadow-lg p-6">
          <h2 className="text-lg font-bold text-white mb-4">Top SKU Kritis</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-slate-300">
              <thead className="bg-slate-950/50 text-slate-400 border-b border-slate-700">
                <tr>
                  <th className="px-4 py-3 font-medium">SKU</th>
                  <th className="px-4 py-3 font-medium">NFE</th>
                  <th className="px-4 py-3 font-medium">TOY</th>
                  <th className="px-4 py-3 font-medium">TOG</th>
                  <th className="px-4 py-3 font-medium text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {topCritical.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-4 text-center text-slate-500">
                      Tidak ada data Top SKU Kritis (belum ada buffer aktif / belum ada order).
                    </td>
                  </tr>
                ) : (
                  topCritical.map((row: any, i: number) => (
                    <tr key={`${row.sku}-${i}`} className="hover:bg-slate-800/50 transition-colors">
                      <td className="px-4 py-3 font-semibold text-white">{row.sku}</td>
                      <td className="px-4 py-3">
                        <span
                          className={`px-2 py-1 rounded text-xs font-bold ${
                            row.status === "critical"
                              ? "bg-red-900/40 text-red-400"
                              : "bg-amber-900/40 text-amber-400"
                          }`}
                        >
                          {row.nfe}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-400">{row.toy}</td>
                      <td className="px-4 py-3 text-slate-400">{row.tog}</td>
                      <td className="px-4 py-3 text-right text-blue-400 font-medium cursor-pointer hover:text-blue-300">
                        {row.action}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-2xl shadow-lg p-6">
           <h2 className="text-lg font-bold text-white mb-4">Ringkasan Kontrol Harian</h2>
           <ul className="space-y-4">
              <li className="flex justify-between items-center bg-slate-800/50 p-3 rounded-lg border border-slate-700">
                 <span className="text-slate-300 text-sm">Order hari ini</span>
                 <span className="font-bold text-blue-400">{data.perlu_replenishment ?? 0} SKU</span>
              </li>
              <li className="flex justify-between items-center bg-slate-800/50 p-3 rounded-lg border border-slate-700">
                 <span className="text-slate-300 text-sm">Receipt hari ini</span>
                 <span className="font-bold text-emerald-400">—</span>
              </li>
              <li className="flex justify-between items-center bg-red-900/20 p-3 rounded-lg border border-red-900/40">
                 <span className="text-red-300 text-sm font-medium">Stockout risk</span>
                 <span className="font-bold text-red-400">{data.zona_merah ?? 0} SKU</span>
              </li>
           </ul>
           <div className="mt-6 p-4 rounded-xl bg-gradient-to-br from-indigo-900/40 to-purple-900/40 border border-indigo-800/50 relative overflow-hidden">
              <div className="relative z-10">
                <p className="text-xs font-medium text-indigo-300 uppercase mb-1">Fill Rate Est.</p>
                  <h3 className="text-3xl font-extrabold text-white">
                    {fillRate != null ? `${fillRate}%` : "N/A"}
                  </h3>
              </div>
              <div className="absolute -right-4 -bottom-4 w-20 h-20 bg-indigo-500 rounded-full blur-2xl opacity-30"></div>
           </div>
        </div>
      </div>
    </div>
  );
}
