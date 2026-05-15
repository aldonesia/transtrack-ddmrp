"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { getApiBase } from "@/lib/api";

type DashMini = {
  perlu_replenishment?: number;
};

const NAV = [
  { name: "Dashboard", href: "/" },
  { name: "Master Data", href: "/master" },
  { name: "Master Demand", href: "/master/demand" },
  { name: "Analytics & Buffer", href: "/analytics" },
  { name: "Replenishment", href: "/replenishment", badgeKey: "perlu_replenishment" as const },
] as const;

function linkActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  if (href === "/master") {
    return (
      pathname === "/master" ||
      (pathname.startsWith("/master/") && !pathname.startsWith("/master/demand"))
    );
  }
  if (href === "/master/demand") {
    return pathname === "/master/demand" || pathname.startsWith("/master/demand/");
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

export default function Sidebar() {
  const pathname = usePathname() ?? "/";
  const [dash, setDash] = useState<DashMini | null>(null);

  useEffect(() => {
    let cancelled = false;
    const base = getApiBase();
    fetch(`${base}/api/dashboard-summary`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!cancelled && j && typeof j === "object") {
          setDash({
            perlu_replenishment: Number((j as DashMini).perlu_replenishment ?? 0),
          });
        }
      })
      .catch(() => {
        if (!cancelled) setDash(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const replenBadge =
    dash?.perlu_replenishment != null && dash.perlu_replenishment > 0
      ? dash.perlu_replenishment
      : null;

  return (
    <div className="flex h-screen w-64 shrink-0 flex-col border-r border-slate-800 bg-slate-900 text-white">
      <div className="border-b border-slate-800 bg-slate-950 px-5 py-5">
        <h1 className="text-lg font-bold leading-snug tracking-tight text-white">IDAS</h1>
        <p className="mt-1 text-[11px] leading-snug text-slate-400">
          Inventory Decision Analytic System
        </p>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-4">
        <p className="mb-2 px-3 text-[10px] font-bold uppercase tracking-widest text-slate-500">
          Operations
        </p>
        <div className="space-y-0.5">
          {NAV.map((item) => {
            const active = linkActive(pathname, item.href);
            const showBadge = "badgeKey" in item && replenBadge != null;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center justify-between gap-2 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors duration-150 ${
                  active
                    ? "bg-blue-600 text-white shadow-md shadow-blue-900/40"
                    : "text-slate-300 hover:bg-slate-800 hover:text-white"
                }`}
              >
                <span>{item.name}</span>
                {showBadge ? (
                  <span className="min-w-[1.5rem] rounded-full bg-red-600 px-1.5 py-0.5 text-center text-[11px] font-bold text-white">
                    {replenBadge > 99 ? "99+" : replenBadge}
                  </span>
                ) : null}
              </Link>
            );
          })}
        </div>
      </nav>

    </div>
  );
}
