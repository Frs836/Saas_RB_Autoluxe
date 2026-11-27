"use client";

import { useMemo, useState } from "react";
import { Icon } from "@/components/ui/icon";
import { formatRupiah } from "@/lib/format";

type OrderRow = {
  id: string;
  orderNumber?: string;
  licensePlate?: string;
  totalPrice: number;
  status: string;
  paymentState: string;
  paymentMethod?: string | null;
  createdAt: string;
  servicePackage: string;
};

type CashFlowRow = {
  id: string;
  type: string;
  amount: number;
  category: string;
  paymentMethod?: string;
  description?: string;
  orderId?: string | null;
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
  const [methodFilter, setMethodFilter] = useState<"all" | "cash" | "qris" | "bank_transfer">("all");
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
    { key: "custom", label: "Pilih Tanggal" },
  ];

  // Rincian Omzet & Pemasukan per Metode Pembayaran (Cash, QRIS, Transfer)
  const methodStats = useMemo(() => {
    const res = {
      cash: { masuk: 0, orderCount: 0, keluar: 0 },
      qris: { masuk: 0, orderCount: 0, keluar: 0 },
      bank_transfer: { masuk: 0, orderCount: 0, keluar: 0 },
    };

    for (const c of filteredCash) {
      const m = (c.paymentMethod ?? "cash") as "cash" | "qris" | "bank_transfer";
      if (res[m]) {
        if (c.type === "in") {
          res[m].masuk += c.amount;
          if (c.category === "pos_order") res[m].orderCount += 1;
        } else if (c.type === "out") {
          res[m].keluar += c.amount;
        }
      }
    }

    return res;
  }, [filteredCash]);

  // Transaksi gabungan untuk daftar riwayat
  const combinedTransactions = useMemo(() => {
    const list = filteredCash.map((c) => {
      const relOrder = c.orderId ? orders.find((o) => o.id === c.orderId) : null;
      let label = c.description || c.category;
      if (c.category === "pos_order" && relOrder) {
        label = `Order #${relOrder.orderNumber || ""}${relOrder.licensePlate ? ` (${relOrder.licensePlate})` : ""}${relOrder.servicePackage ? ` - ${relOrder.servicePackage}` : ""}`;
      }
      return {
        id: c.id,
        type: c.type,
        amount: c.amount,
        category: c.category,
        paymentMethod: (c.paymentMethod ?? "cash") as "cash" | "qris" | "bank_transfer",
        label,
        createdAt: c.createdAt,
      };
    });

    if (methodFilter === "all") return list;
    return list.filter((t) => t.paymentMethod === methodFilter);
  }, [filteredCash, orders, methodFilter]);

  return (
    <div className="px-gutter py-4 flex flex-col gap-4 pb-nav-plain lg:pb-8">
      {/* Filter tabs */}
      <div className="flex gap-2 overflow-x-auto no-scrollbar">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setMode(f.key)}
            className={`shrink-0 px-4 min-h-[44px] rounded-[8px] border font-caption text-caption transition-colors duration-150 ${
              mode === f.key
                ? "bg-primary text-white border-primary"
                : "bg-surface text-text-secondary border-border-subtle hover:bg-surface-variant"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Custom date range */}
      {mode === "custom" && (
        <div className="clay-card rounded-[10px] p-4 flex flex-col gap-3">
          <p className="font-body-bold text-body-bold text-text-primary">Pilih Rentang Tanggal</p>
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1">
              <span className="font-caption text-caption text-text-muted">Dari</span>
              <input
                type="date"
                value={customFrom}
                onChange={(e) => setCustomFrom(e.target.value)}
                className="h-11 px-3 rounded-[8px] border border-border-strong bg-surface font-body text-body text-text-primary outline-none focus-visible:ring-2 focus-visible:ring-accent"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="font-caption text-caption text-text-muted">Sampai</span>
              <input
                type="date"
                value={customTo}
                onChange={(e) => setCustomTo(e.target.value)}
                className="h-11 px-3 rounded-[8px] border border-border-strong bg-surface font-body text-body text-text-primary outline-none focus-visible:ring-2 focus-visible:ring-accent"
              />
            </label>
          </div>
        </div>
      )}

      {/* Omzet utama */}
      <div className="relative overflow-hidden rounded-[10px] p-5 primary-gradient text-white clay-glow">
        <div className="absolute -right-6 -top-6 w-32 h-32 rounded-full bg-sky-400/20 blur-2xl pointer-events-none" />
        <div className="relative z-10">
          <p className="font-caption text-caption text-white/80">Total Omzet</p>
          <p className="font-metric-display text-metric-display text-white tracking-tight leading-none mt-1 tabular-nums">
            {formatRupiah(totalOmset)}
          </p>
          <p className="font-caption text-caption text-white/80 mt-2 tabular-nums">
            {totalOrders} order aktif • {completedOrders.length} selesai
          </p>
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
        <div className="clay-card rounded-[10px] p-4 flex flex-col gap-1">
          <div className="w-9 h-9 rounded-[8px] bg-success-surface border border-emerald-200 flex items-center justify-center">
            <Icon name="check_circle" className="text-success-text text-[20px]" />
          </div>
          <p className="font-caption text-caption text-text-muted mt-2">Sudah Lunas</p>
          <p className="font-headline-1 text-headline-1 text-text-primary tabular-nums">{paidOrders}</p>
          <p className="font-micro-badge text-micro-badge text-text-muted">order</p>
        </div>
        <div className="clay-card rounded-[10px] p-4 flex flex-col gap-1">
          <div className="w-9 h-9 rounded-[8px] bg-warning-surface border border-amber-200 flex items-center justify-center">
            <Icon name="schedule" className="text-warning-text text-[20px]" />
          </div>
          <p className="font-caption text-caption text-text-muted mt-2">Belum Lunas</p>
          <p className="font-headline-1 text-headline-1 text-text-primary tabular-nums">{unpaidOrders}</p>
          <p className="font-micro-badge text-micro-badge text-text-muted">order</p>
        </div>
        <div className="clay-card rounded-[10px] p-4 flex flex-col gap-1">
          <div className="w-9 h-9 rounded-[8px] bg-success-surface border border-emerald-200 flex items-center justify-center">
            <Icon name="arrow_forward" className="text-success-text text-[20px]" />
          </div>
          <p className="font-caption text-caption text-text-muted mt-2">Kas Masuk</p>
          <p className="font-headline-2 text-headline-2 text-success-text tabular-nums">{formatRupiah(cashIn)}</p>
        </div>
        <div className="clay-card rounded-[10px] p-4 flex flex-col gap-1">
          <div className="w-9 h-9 rounded-[8px] bg-danger-surface border border-red-200 flex items-center justify-center">
            <Icon name="arrow_back" className="text-danger-text text-[20px]" />
          </div>
          <p className="font-caption text-caption text-text-muted mt-2">Kas Keluar</p>
          <p className="font-headline-2 text-headline-2 text-danger-text tabular-nums">{formatRupiah(cashOut)}</p>
        </div>
      </div>

      {/* Rincian Finansial per Metode Pembayaran (Cash, QRIS, Transfer) */}
      <section className="clay-card rounded-[10px] p-4 flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <Icon name="account_balance_wallet" className="text-primary text-[20px]" />
          <h3 className="font-headline-3 text-headline-3 text-text-primary">
            Rincian per Metode Pembayaran
          </h3>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {/* Tunai (Cash) */}
          <div className="p-3.5 rounded-[10px] bg-surface-variant border border-border-subtle flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="font-body-bold text-caption text-text-primary flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 inline-block" />
                Tunai (Cash)
              </span>
              <span className="font-micro-badge text-[10px] px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 font-semibold tabular-nums">
                {methodStats.cash.orderCount} order
              </span>
            </div>
            <div className="flex flex-col gap-1 pt-1 border-t border-border-subtle">
              <div className="flex items-center justify-between text-caption">
                <span className="text-text-muted">Masuk:</span>
                <span className="font-body-bold text-success-text tabular-nums">
                  {formatRupiah(methodStats.cash.masuk)}
                </span>
              </div>
              <div className="flex items-center justify-between text-caption">
                <span className="text-text-muted">Keluar:</span>
                <span className="font-body-bold text-danger-text tabular-nums">
                  {formatRupiah(methodStats.cash.keluar)}
                </span>
              </div>
              <div className="flex items-center justify-between text-caption pt-1 border-t border-border-subtle/60">
                <span className="font-semibold text-text-secondary">Net:</span>
                <span className="font-bold text-text-primary tabular-nums">
                  {formatRupiah(methodStats.cash.masuk - methodStats.cash.keluar)}
                </span>
              </div>
            </div>
          </div>

          {/* QRIS */}
          <div className="p-3.5 rounded-[10px] bg-surface-variant border border-border-subtle flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="font-body-bold text-caption text-text-primary flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-sky-500 inline-block" />
                QRIS
              </span>
              <span className="font-micro-badge text-[10px] px-2 py-0.5 rounded-full bg-sky-50 text-sky-700 border border-sky-200 font-semibold tabular-nums">
                {methodStats.qris.orderCount} order
              </span>
            </div>
            <div className="flex flex-col gap-1 pt-1 border-t border-border-subtle">
              <div className="flex items-center justify-between text-caption">
                <span className="text-text-muted">Masuk:</span>
                <span className="font-body-bold text-success-text tabular-nums">
                  {formatRupiah(methodStats.qris.masuk)}
                </span>
              </div>
              <div className="flex items-center justify-between text-caption">
                <span className="text-text-muted">Keluar:</span>
                <span className="font-body-bold text-danger-text tabular-nums">
                  {formatRupiah(methodStats.qris.keluar)}
                </span>
              </div>
              <div className="flex items-center justify-between text-caption pt-1 border-t border-border-subtle/60">
                <span className="font-semibold text-text-secondary">Net:</span>
                <span className="font-bold text-text-primary tabular-nums">
                  {formatRupiah(methodStats.qris.masuk - methodStats.qris.keluar)}
                </span>
              </div>
            </div>
          </div>

          {/* Transfer Bank */}
          <div className="p-3.5 rounded-[10px] bg-surface-variant border border-border-subtle flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="font-body-bold text-caption text-text-primary flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-purple-500 inline-block" />
                Transfer Bank
              </span>
              <span className="font-micro-badge text-[10px] px-2 py-0.5 rounded-full bg-purple-50 text-purple-700 border border-purple-200 font-semibold tabular-nums">
                {methodStats.bank_transfer.orderCount} order
              </span>
            </div>
            <div className="flex flex-col gap-1 pt-1 border-t border-border-subtle">
              <div className="flex items-center justify-between text-caption">
                <span className="text-text-muted">Masuk:</span>
                <span className="font-body-bold text-success-text tabular-nums">
                  {formatRupiah(methodStats.bank_transfer.masuk)}
                </span>
              </div>
              <div className="flex items-center justify-between text-caption">
                <span className="text-text-muted">Keluar:</span>
                <span className="font-body-bold text-danger-text tabular-nums">
                  {formatRupiah(methodStats.bank_transfer.keluar)}
                </span>
              </div>
              <div className="flex items-center justify-between text-caption pt-1 border-t border-border-subtle/60">
                <span className="font-semibold text-text-secondary">Net:</span>
                <span className="font-bold text-text-primary tabular-nums">
                  {formatRupiah(methodStats.bank_transfer.masuk - methodStats.bank_transfer.keluar)}
                </span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Riwayat & Detail Transaksi Keuangan dengan Filter Metode Pembayaran */}
      <section className="clay-card rounded-[10px] p-4 flex flex-col gap-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Icon name="receipt_long" className="text-primary text-[20px]" />
            <h3 className="font-headline-3 text-headline-3 text-text-primary">
              Riwayat Transaksi & Metode Bayar
            </h3>
          </div>
          {/* Method Filter Buttons */}
          <div className="flex gap-1.5 overflow-x-auto no-scrollbar">
            {(
              [
                { key: "all", label: "Semua Metode" },
                { key: "cash", label: "Tunai" },
                { key: "qris", label: "QRIS" },
                { key: "bank_transfer", label: "Transfer" },
              ] as const
            ).map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => setMethodFilter(item.key)}
                className={`px-3 py-1 text-xs rounded-full border transition-all ${
                  methodFilter === item.key
                    ? "bg-primary text-white border-primary shadow-sm"
                    : "bg-surface-variant text-text-secondary border-border-subtle hover:bg-surface"
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>

        {combinedTransactions.length === 0 ? (
          <div className="p-6 text-center text-text-muted text-caption">
            Tidak ada transaksi untuk filter metode pembayaran ini.
          </div>
        ) : (
          <div className="flex flex-col divide-y divide-border-subtle">
            {combinedTransactions.map((tx) => {
              const isCash = tx.paymentMethod === "cash";
              const isQris = tx.paymentMethod === "qris";
              const badgeStyle = isCash
                ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                : isQris
                ? "bg-sky-50 text-sky-700 border-sky-200"
                : "bg-purple-50 text-purple-700 border-purple-200";
              const methodLabel = isCash ? "Tunai" : isQris ? "QRIS" : "Transfer";

              return (
                <div key={tx.id} className="py-2.5 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div
                      className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${
                        tx.type === "in"
                          ? "bg-emerald-50 text-emerald-600"
                          : "bg-red-50 text-red-600"
                      }`}
                    >
                      <Icon
                        name={tx.type === "in" ? "arrow_downward" : "arrow_upward"}
                        className="text-[16px]"
                      />
                    </div>
                    <div className="min-w-0">
                      <p className="font-body-bold text-caption text-text-primary truncate">
                        {tx.label}
                      </p>
                      <p className="text-[11px] text-text-muted tabular-nums">
                        {new Date(tx.createdAt).toLocaleString("id-ID", {
                          dateStyle: "medium",
                          timeStyle: "short",
                        })}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span
                      className={`font-micro-badge text-[10px] px-2 py-0.5 rounded-full border font-semibold ${badgeStyle}`}
                    >
                      {methodLabel}
                    </span>
                    <span
                      className={`font-body-bold text-caption tabular-nums ${
                        tx.type === "in" ? "text-success-text" : "text-danger-text"
                      }`}
                    >
                      {tx.type === "in" ? "+" : "-"}
                      {formatRupiah(tx.amount)}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Top layanan */}
      {topServices.length > 0 && (
        <div className="clay-card rounded-[10px] p-4 flex flex-col gap-3 lg:mt-2">
          <h3 className="font-headline-2 text-headline-2 text-text-primary">Layanan Terlaris</h3>
          <div className="flex flex-col gap-2">
            {topServices.map(([name, data]) => (
              <div key={name} className="flex items-center justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <p className="font-body text-body text-text-primary truncate">{name}</p>
                  <p className="font-caption text-caption text-text-muted tabular-nums">{data.count}x dikerjakan</p>
                </div>
                <p className="font-body-bold text-body-bold text-text-primary shrink-0 tabular-nums">
                  {formatRupiah(data.revenue)}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {filteredOrders.length === 0 && (
        <div className="clay-card rounded-[10px] p-8 flex flex-col items-center text-center gap-2">
          <Icon name="inbox" className="text-[40px] text-text-muted" />
          <p className="font-body text-body text-text-secondary">Belum ada transaksi pada periode ini.</p>
        </div>
      )}
    </div>
  );
}
