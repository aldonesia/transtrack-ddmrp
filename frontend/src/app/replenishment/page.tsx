"use client";

export default function Replenishment() {
  const recommendations = [
    { sku: "A001", stock: 20, oo: 10, nfe: 15, toy: 80, tog: 115, oh: 100, moq: 100, finalQty: 100, status: "Order" },
    { sku: "A002", stock: 55, oo: 0, nfe: 45, toy: 60, tog: 90, oh: 45, moq: 50, finalQty: 50, status: "Order" },
    { sku: "A003", stock: 120, oo: 40, nfe: 130, toy: 88, tog: 108, oh: 0, moq: 20, finalQty: 0, status: "Aman" },
    { sku: "A008", stock: 18, oo: 0, nfe: 6, toy: 55, tog: 80, oh: 74, moq: 20, finalQty: 80, status: "Order" },
  ];

  return (
    <div className="space-y-6 animate-in fade-in zoom-in duration-500">
      <div className="flex items-center justify-between pb-4 border-b border-slate-800">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight bg-gradient-to-br from-white to-slate-400 bg-clip-text text-transparent">
            Rekomendasi Replenishment
          </h1>
          <p className="text-sm text-slate-400 mt-1">Kalkulasi Net Flow Equation (NFE) berdasarkan buffer aktif v2026.03</p>
        </div>
        <div className="flex gap-3">
            <button className="bg-slate-800 hover:bg-slate-700 text-white px-4 py-2 text-sm font-semibold rounded-lg shadow-sm transition-colors border border-slate-700">
              Export Excel
            </button>
            <button className="bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2 text-sm font-semibold rounded-lg shadow-lg shadow-indigo-500/20 transition-all">
              Approve Selected
            </button>
        </div>
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-2xl shadow-xl overflow-hidden mt-6">
          <div className="p-4 bg-slate-900/50 flex flex-wrap gap-4 border-b border-slate-800">
             <input type="text" placeholder="Search SKU..." className="bg-slate-950 border border-slate-700 text-sm rounded-lg px-4 py-2 text-white focus:ring-2 focus:ring-indigo-500 outline-none w-64 focus:border-indigo-500 transition-all"/>
             <select className="bg-slate-950 border border-slate-700 text-sm rounded-lg px-4 py-2 text-slate-300 focus:ring-2 focus:ring-indigo-500 outline-none">
                <option>Status: All</option>
                <option>Order</option>
                <option>Aman</option>
             </select>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-slate-300">
              <thead className="bg-slate-950 text-slate-400 border-b border-slate-800">
                <tr>
                  <th className="px-4 py-4 pl-6 font-medium">
                     <input type="checkbox" className="rounded bg-slate-900 border-slate-700" />
                  </th>
                  <th className="px-4 py-4 font-medium">SKU</th>
                  <th className="px-4 py-4 font-medium text-right">Stock</th>
                  <th className="px-4 py-4 font-medium text-right">Open Order</th>
                  <th className="px-4 py-4 font-medium text-right">NFE</th>
                  <th className="px-4 py-4 font-medium text-right">TOY</th>
                  <th className="px-4 py-4 font-medium text-right">TOG</th>
                  <th className="px-4 py-4 font-medium text-right text-indigo-300">Final Qty</th>
                  <th className="px-4 py-4 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {recommendations.map((item, i) => (
                  <tr key={i} className="hover:bg-slate-800/40 transition-colors group">
                    <td className="px-4 py-4 pl-6">
                       <input type="checkbox" className="rounded bg-slate-900 border-slate-700" />
                    </td>
                    <td className="px-4 py-4 font-semibold text-white">{item.sku}</td>
                    <td className="px-4 py-4 text-right text-slate-400">{item.stock}</td>
                    <td className="px-4 py-4 text-right text-slate-400">{item.oo}</td>
                    <td className="px-4 py-4 text-right">
                       <span className={`px-2 py-1 rounded inline-block text-xs font-bold w-12 text-center ${item.nfe < item.toy ? 'bg-amber-900/30 text-amber-500 border border-amber-800/40' : 'bg-emerald-900/30 text-emerald-400 border border-emerald-800/40'}`}>{item.nfe}</span>
                    </td>
                    <td className="px-4 py-4 text-right text-slate-500">{item.toy}</td>
                    <td className="px-4 py-4 text-right text-slate-500">{item.tog}</td>
                    <td className="px-4 py-4 text-right font-extrabold text-white bg-slate-800/30 group-hover:bg-slate-700/50 transition-colors">{item.finalQty}</td>
                    <td className="px-4 py-4">
                      {item.status === "Order" ? (
                         <span className="flex items-center text-rose-400 text-xs font-bold uppercase tracking-wider">
                            <span className="w-2 h-2 rounded-full bg-rose-500 mr-2 animate-pulse"></span> Order
                         </span>
                      ) : (
                         <span className="flex items-center text-emerald-500 text-xs font-bold uppercase tracking-wider">
                            <span className="w-2 h-2 rounded-full bg-emerald-500 mr-2"></span> Aman
                         </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
      </div>
      
      <div className="bg-slate-900/50 border border-slate-800 border-l-4 border-l-blue-500 rounded-lg p-4 mt-6">
          <h3 className="text-white font-bold text-sm mb-1">Penjelasan NFE</h3>
          <p className="text-slate-400 text-xs leading-relaxed">
             <strong>A001:</strong> NFE 15 {"<"} TOY 80, maka replenishment dipicu.<br/>
             Qty awal = TOG (115) - NFE (15) = 100, disesuaikan dengan aturan MOQ/pack size sehingga Final Qty = 100.
          </p>
      </div>

    </div>
  );
}
