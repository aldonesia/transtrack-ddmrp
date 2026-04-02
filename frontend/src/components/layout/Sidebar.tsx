"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export default function Sidebar() {
  const pathname = usePathname();

  const navigation = [
    { name: "Beranda & KPI", href: "/" },
    { name: "Master Data", href: "/master" },
    { name: "Analytics & Buffer", href: "/analytics" },
    { name: "Replenishment", href: "/replenishment" }
  ];

  return (
    <div className="flex h-screen w-64 flex-col bg-slate-900 border-r border-slate-800 text-white">
      <div className="flex h-16 items-center px-6 border-b border-slate-800 bg-slate-950">
        <h1 className="text-xl font-bold bg-gradient-to-r from-blue-400 to-teal-400 bg-clip-text text-transparent">
          DDMRP Dashboard
        </h1>
      </div>
      <nav className="flex-1 overflow-y-auto py-4 px-3 space-y-1">
        {navigation.map((item) => {
          const isActive = pathname === item.href;
          return (
            <Link
              key={item.name}
              href={item.href}
              className={`block px-4 py-2 text-sm font-medium rounded-lg transition-colors duration-150 ${
                isActive
                  ? "bg-blue-600 text-white shadow-lg shadow-blue-900/50"
                  : "text-slate-300 hover:bg-slate-800 hover:text-white"
              }`}
            >
              {item.name}
            </Link>
          );
        })}
      </nav>
      <div className="p-4 border-t border-slate-800 text-xs text-slate-500">
        Demo Version v2026.03
      </div>
    </div>
  );
}
