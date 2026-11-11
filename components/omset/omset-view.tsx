"use client";

import { useMemo, useState } from "react";
import { Icon } from "@/components/ui/icon";
import { formatRupiah } from "@/lib/format";

type OrderRow = {
  id: string;
  totalPrice: number;
  status: string;
  paymentState: string;
  createdAt: string;
  servicePackage: string;
};

type CashFlowRow = {
  id: string;
  type: string;
  amount: number;
  category: string;
  createdAt: string;
};

type FilterMode = "today" | "week" | "month" | "custom";

function startOfDayWib(d: Date): Date {
  // WIB = UTC+7
  const wib = new Date(d.getTime() + 7 * 60 * 60 * 1000);
  wib.setUTCHours(0, 0, 0, 0);
  return new Date(wib.getTime() - 7 * 60 * 60 * 1000);
}

function todayWib(): Date {
  const now = new Date();
  return startOfDayWib(now);
}

function formatDateInput(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function parseLocalDate(s: string): Date {
  // "YYYY-MM-DD" → local midnight
  const [y, m, day] = s.split("-").map(Number);
  return new Date(y, m - 1, day);
}

export function OmsetView({
  orders,
  cashFlows,
}: {
  orders: OrderRow[];
  cashFlows: CashFlowRow[];
}) {
  const [mode, setMode] = useState<FilterMode>("today");
  const [customFrom, setCustomFrom] = useState(formatDateInput(todayWib()));
  const [customTo, setCustomTo] = useState(formatDateInput(new Date()));

  const { from, to } = useMemo(() => {
    const now = new Date();
    if (mode === "today") {
      const f = startOfDayWib(now);
      const t = new Date(f.getTime() + 24 * 60 * 60 * 1000);
      return { from: f, to: t };
    }
    if (mode === "week") {
      const f = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      return { from: f, to: new Date(now.getTime() + 24 * 60 * 60 * 1000) };
    }
    if (mode === "month") {
      const f = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      return { from: f, to: new Date(now.getTime() + 24 * 60 * 60 * 1000) };
    }
    // custom
    const f = parseLocalDate(customFrom);
    const t = new Date(parseLocalDate(customTo).getTime() + 24 * 60 * 60 * 1000);
    return { from: f, to: t };
  }, [mode, customFrom, customTo]);

  const filteredOrders = useMemo(
    () => orders.filter((o) => {
      const d = new Date(o.createdAt);
      return d >= from && d < to;
    }),
    [orders, from, to],
  );

  const filteredCash = useMemo(
    () => cashFlows.filter((c) => {
      const d = new Date(c.createdAt);
      return d >= from && d < to;
    }),
    [cashFlows, from, to],
  );

  // Metrics
  const completedOrders = filteredOrders.filter((o) =>
    ["completed", "menunggu_diambil", "diserahkan"].includes(o.status)
  );
  const totalOmset = completedOrders.reduce((s, o) => s + o.totalPrice, 0);
  const totalOrders = filteredOrders.filter((o) => o.status !== "cancelled").length;
  const paidOrders = filteredOrders.filter((o) => o.paymentState === "paid").length;
  const unpaidOrders = filteredOrders.filter((o) =>
    ["unpaid", "partial"].includes(o.paymentState) && o.status !== "cancelled"
  ).length;
  const cashIn = filteredCash.filter((c) => c.type === "in").reduce((s, c) => s + c.amount, 0);
  const cashOut = filteredCash.filter((c) => c.type === "out").reduce((s, c) => s + c.amount, 0);

  // Service breakdown
  const serviceMap = new Map<string, { count: number; revenue: number }>();
  for (const o of completedOrders) {
    const pkg = o.servicePackage || "Lainnya";
    const existing = serviceMap.get(pkg) ?? { count: 0, revenue: 0 };
    serviceMap.set(pkg, { count: existing.count + 1, revenue: existing.revenue + o.totalPrice });
  }
  const topServices = Array.from(serviceMap.entries())
    .sort((a, b) => b[1].revenue - a[1].revenue)
    .slice(0, 5);

  const FILTERS: { key: FilterMode; label: string }[] = [
    { key: "today", label: "Hari Ini" },
    { key: "week", label: "7 Hari" },
    { key: "month", label: "30 Hari" },
    { key: "custom", label: "Custom" },
  ];

  return (
    <div className="px-gutter py-4 flex flex-col gap-4 pb-nav-plain lg:pb-8">
      {/* Filter tabs */}
      <div className="flex gap-2 overflow-x-auto no-scrollbar">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setMode(f.key)}
            className={`shrink-0 px-4 h-10 rounded-full font-caption text-caption active:scale-95 transition-transform ${
              mode === f.key
                ? "bg-primary text-white"
                : "bg-surface-container-low text-text-secondary"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Custom date range */}
      {mode === "custom" && (
        <div className="clay-card p-4 flex flex-col gap-3">
          <p className="font-body-bold text-body-bold text-text-primary">Pilih Rentang Tanggal</p>
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1">
              <span className="font-caption text-caption text-text-muted">Dari</span>
              <input
                type="date"
                value={customFrom}
                onChange={(e) => setCustomFrom(e.target.value)}
                className="h-11 px-3 rounded-xl bg-surface-container-low font-body text-body text-text-primary outline-none focus:ring-2 focus:ring-brand-400"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="font-caption text-caption text-text-muted">Sampai</span>
              <input
                type="date"
                value={customTo}
                onChange={(e) => setCustomTo(e.target.value)}
                className="h-11 px-3 rounded-xl bg-surface-container-low font-body text-body text-text-primary outline-none focus:ring-2 focus:ring-brand-400"
              />
            </label>
          </div>
        </div>
      )}

      {/* Omset utama */}
      <div className="relative overflow-hidden rounded-[20px] p-5 primary-gradient text-on-primary clay-glow">
        <div className="absolute -right-6 -bottom-6 opacity-10 pointer-events-none text-white">
          <Icon name="insights" className="text-[130px]" />
        </div>
        <div className="relative z-10">
          <p className="font-caption text-caption text-brand-100">Total Omset</p>
          <p className="font-metric-display text-metric-display text-white tracking-tight leading-none mt-1">
            {formatRupiah(totalOmset)}
          </p>
          <p className="font-caption text-caption text-brand-100 mt-2">
            {totalOrders} order aktif • {completedOrders.length} selesai
          </p>
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
        <div className="clay-card p-4 flex flex-col gap-1">
          <div className="w-9 h-9 rounded-xl bg-success-surface flex items-center justify-center">
            <Icon name="check_circle" className="text-success-text text-[20px]" />
          </div>
          <p className="font-caption text-caption text-text-muted mt-2">Sudah Lunas</p>
          <p className="font-headline-1 text-headline-1 text-text-primary">{paidOrders}</p>
          <p className="font-micro-badge text-micro-badge text-text-muted">order</p>
        </div>
        <div className="clay-card p-4 flex flex-col gap-1">
          <div className="w-9 h-9 rounded-xl bg-warning-surface flex items-center justify-center">
            <Icon name="schedule" className="text-warning-text text-[20px]" />
          </div>
          <p className="font-caption text-caption text-text-muted mt-2">Belum Lunas</p>
          <p className="font-headline-1 text-headline-1 text-text-primary">{unpaidOrders}</p>
          <p className="font-micro-badge text-micro-badge text-text-muted">order</p>
        </div>
        <div className="clay-card p-4 flex flex-col gap-1">
          <div className="w-9 h-9 rounded-xl bg-success-surface flex items-center justify-center">
            <Icon name="arrow_forward" className="text-success-text text-[20px]" />
          </div>
          <p className="font-caption text-caption text-text-muted mt-2">Kas Masuk</p>
          <p className="font-headline-2 text-headline-2 text-success-text">{formatRupiah(cashIn)}</p>
        </div>
        <div className="clay-card p-4 flex flex-col gap-1">
          <div className="w-9 h-9 rounded-xl bg-danger-surface flex items-center justify-center">
            <Icon name="arrow_back" className="text-danger-text text-[20px]" />
          </div>
          <p className="font-caption text-caption text-text-muted mt-2">Kas Keluar</p>
          <p className="font-headline-2 text-headline-2 text-danger-text">{formatRupiah(cashOut)}</p>
        </div>
      </div>

      {/* Top layanan */}
      {topServices.length > 0 && (
        <div className="clay-card p-4 flex flex-col gap-3 lg:mt-6">
          <h3 className="font-headline-2 text-headline-2 text-text-primary">Top Layanan</h3>
          <div className="flex flex-col gap-2">
            {topServices.map(([name, data]) => (
              <div key={name} className="flex items-center justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <p className="font-body text-body text-text-primary truncate">{name}</p>
                  <p className="font-caption text-caption text-text-muted">{data.count}x dikerjakan</p>
                </div>
                <p className="font-body-bold text-body-bold text-text-primary shrink-0">
                  {formatRupiah(data.revenue)}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {filteredOrders.length === 0 && (
        <div className="clay-card p-8 flex flex-col items-center text-center gap-2">
          <Icon name="inbox" className="text-[40px] text-text-muted" />
          <p className="font-body text-body text-text-secondary">Tidak ada data pada periode ini.</p>
        </div>
      )}
    </div>
  );
}
