import Sidebar from "@/components/layout/Sidebar";
import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "IDAS — Inventory Decision Analytic System",
  description:
    "IDAS (Inventory Decision Analytic System): operational dashboard, master data, buffer analytics, replenishment.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className="flex h-screen bg-slate-950 text-slate-50 overflow-hidden font-sans">
        <Sidebar />
        <main className="flex-1 overflow-y-auto bg-slate-950">
          <div className="w-full max-w-7xl mx-auto p-8">
            {children}
          </div>
        </main>
      </body>
    </html>
  );
}
