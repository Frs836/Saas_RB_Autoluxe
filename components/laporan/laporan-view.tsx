"use client";

import { useState } from "react";
import { Icon } from "@/components/ui/icon";

type Series = { label: string; income: number; expense: number };

export type PaymentMethodSummary = {
  method: "cash" | "qris" | "bank_transfer";
  label: string;
  income: number;
  expense: number;
  net: number;
  incomeCount: number;
  expenseCount: number;
};

export type FinancialTransaction = {
  id: string;
  type: "in" | "out";
  amount: number;
  category: string;
  description: string;
  paymentMethod: "cash" | "qris" | "bank_transfer";
  createdAt: string;
  orderNumber: string | null;
  licensePlate: string | null;
};

export type LaporanData = {
  finance: {
    income: number;
    expense: number;
    net: number;
    monthly: Series[];
    byCategory: { category: string; type: string; amount: number; count: number }[];
    byPaymentMethod: PaymentMethodSummary[];
    transactions: FinancialTransaction[];
  };
  branchRevenue: { branchName: string; orders: number; revenue: number }[];
  unitsSold: { name: string; qty: number; revenue: number }[];
  receivables: { count: number; total: number };
  stock: {
    total: number;
    lowCount: number;
    low: {
      itemName: string;
      branchName: string;
      current: number;
      unit: string;
      min: number;
    }[];
    movement: {
      itemName: string;
      logType: string;
      quantity: number;
      balanceAfter: number;
      createdAt: string;
    }[];
  };
  /** true bila rincian unit terjual hanya mencakup 500 order terbaru */
  unitsSoldCapped?: boolean;
  generatedAt: string;
};

function rupiah(value: number) {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(value);
}

export function LaporanView({ data }: { data: LaporanData }) {
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  // Filter untuk riwayat transaksi finansial
  const [methodFilter, setMethodFilter] = useState<"all" | "cash" | "qris" | "bank_transfer">("all");
  const [typeFilter, setTypeFilter] = useState<"all" | "in" | "out">("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [displayCount, setDisplayCount] = useState(15);

  const maxMonthly = Math.max(
    1,
    ...data.finance.monthly.map((m) => Math.max(m.income, m.expense)),
  );
  const maxBranch = Math.max(
    1,
    ...data.branchRevenue.map((b) => b.revenue),
  );

  async function handleExport() {
    setExporting(true);
    setExportError(null);
    try {
      const XLSX = await import("xlsx");

      const financeSheet = [
        ["Ringkasan Finansial", ""],
        ["Total Pemasukan", data.finance.income],
        ["Total Pengeluaran", data.finance.expense],
        ["Laba Bersih", data.finance.net],
        [],
        ["Periode", "Pemasukan", "Pengeluaran"],
        ...data.finance.monthly.map((m) => [m.label, m.income, m.expense]),
        [],
        ["Rincian per Kategori", "Jenis", "Jumlah Transaksi", "Nominal"],
        ...data.finance.byCategory.map((c) => [
          c.category,
          c.type === "in" ? "Masuk" : "Keluar",
          c.count,
          c.amount,
        ]),
      ];

      const methodSheet = [
        ["Metode Pembayaran", "Pemasukan (Masuk)", "Pengeluaran (Keluar)", "Net Kas", "Trx Masuk", "Trx Keluar"],
        ...(data.finance.byPaymentMethod ?? []).map((m) => [
          m.label,
          m.income,
          m.expense,
          m.net,
          m.incomeCount,
          m.expenseCount,
        ]),
      ];

      const transactionSheet = [
        ["Waktu", "Jenis", "Kategori", "Keterangan", "Metode Pembayaran", "Nominal"],
        ...(data.finance.transactions ?? []).map((t) => [
          new Date(t.createdAt).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" }),
          t.type === "in" ? "Masuk" : "Keluar",
          t.category,
          t.description || "-",
          t.paymentMethod === "cash" ? "Tunai (Cash)" : t.paymentMethod === "qris" ? "QRIS" : "Transfer Bank",
          t.type === "in" ? t.amount : -t.amount,
        ]),
      ];

      const branchSheet = [
        ["Cabang", "Jumlah Order", "Omzet"],
        ...data.branchRevenue.map((b) => [
          b.branchName,
          b.orders,
          b.revenue,
        ]),
      ];

      const unitsSheet = [
        ["Layanan", "Unit Terjual", "Omzet"],
        ...data.unitsSold.map((u) => [u.name, u.qty, u.revenue]),
      ];

      const receivableSheet = [
        ["Ringkasan Tagihan", ""],
        ["Jumlah Order Belum Lunas", data.receivables.count],
        ["Total Tagihan", data.receivables.total],
      ];

      const stockSheet = [
        ["Barang", "Cabang", "Stok Saat Ini", "Satuan", "Batas Minimum"],
        ...data.stock.low.map((s) => [
          s.itemName,
          s.branchName,
          s.current,
          s.unit,
          s.min,
        ]),
      ];

      const movementSheet = [
        ["Waktu", "Barang", "Jenis Mutasi", "Jumlah", "Saldo Setelah"],
        ...data.stock.movement.map((m) => [
          new Date(m.createdAt).toISOString(),
          m.itemName,
          m.logType,
          m.quantity,
          m.balanceAfter,
        ]),
      ];

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(
        wb,
        XLSX.utils.aoa_to_sheet(financeSheet),
        "Finansial",
      );
      XLSX.utils.book_append_sheet(
        wb,
        XLSX.utils.aoa_to_sheet(methodSheet),
        "Per Metode",
      );
      XLSX.utils.book_append_sheet(
        wb,
        XLSX.utils.aoa_to_sheet(transactionSheet),
        "Riwayat Transaksi",
      );
      XLSX.utils.book_append_sheet(
        wb,
        XLSX.utils.aoa_to_sheet(branchSheet),
        "Omzet Cabang",
      );
      XLSX.utils.book_append_sheet(
        wb,
        XLSX.utils.aoa_to_sheet(unitsSheet),
        "Unit Terjual",
      );
      XLSX.utils.book_append_sheet(
        wb,
        XLSX.utils.aoa_to_sheet(receivableSheet),
        "Tagihan",
      );
      XLSX.utils.book_append_sheet(
        wb,
        XLSX.utils.aoa_to_sheet(stockSheet),
        "Stok Kritis",
      );
      XLSX.utils.book_append_sheet(
        wb,
        XLSX.utils.aoa_to_sheet(movementSheet),
        "Mutasi Stok",
      );

      const stamp = new Date(data.generatedAt)
        .toISOString()
        .slice(0, 10);
      XLSX.writeFile(wb, `Laporan-RB-Autoluxe-${stamp}.xlsx`);
    } catch {
      setExportError("Gagal membuat berkas Excel. Coba lagi.");
    } finally {
      setExporting(false);
    }
  }

  const allTx = data.finance.transactions ?? [];
  const filteredTx = allTx.filter((t) => {
    if (methodFilter !== "all" && t.paymentMethod !== methodFilter) return false;
    if (typeFilter !== "all" && t.type !== typeFilter) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchDesc = (t.description || "").toLowerCase().includes(q);
      const matchCat = (t.category || "").toLowerCase().includes(q);
      const matchPlate = (t.licensePlate || "").toLowerCase().includes(q);
      const matchOrder = (t.orderNumber || "").toLowerCase().includes(q);
      if (!matchDesc && !matchCat && !matchPlate && !matchOrder) return false;
    }
    return true;
  });

  const visibleTx = filteredTx.slice(0, displayCount);

  return (
    <div className="flex-1 px-gutter pt-4 pb-nav-plain lg:pb-8 flex flex-col gap-4">
      {/* Row 1 desktop: chart (col-span-2) + tagihan (col-span-1) */}
      <div className="lg:grid lg:grid-cols-3 lg:gap-4 flex flex-col gap-4">
      <section className="bg-surface rounded-[10px] p-4 clay-card lg:col-span-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Icon name="account_balance_wallet" className="text-primary text-[20px]" />
            <span className="font-headline-2 text-headline-2 text-text-primary">
              Ringkasan Finansial
            </span>
          </div>
          <button
            type="button"
            onClick={handleExport}
            disabled={exporting}
            className="inline-flex items-center gap-1.5 min-h-[44px] px-3.5 rounded-[8px] primary-gradient clay-glow text-white font-body-bold text-caption hover:opacity-95 transition-opacity disabled:opacity-70"
          >
            <Icon name="download" className="text-[18px]" />
            {exporting ? "Menyiapkan..." : "Ekspor Excel"}
          </button>
        </div>

        <div className="grid grid-cols-1 gap-2.5 mt-3 lg:grid-cols-3 lg:gap-4">
          <div className="rounded-[8px] bg-success-surface border border-emerald-200 p-3 flex items-center justify-between">
            <span className="font-caption text-caption text-success-text">
              Total Pemasukan
            </span>
            <span className="font-body-bold text-body-bold text-success-text tabular-nums">
              {rupiah(data.finance.income)}
            </span>
          </div>
          <div className="rounded-[8px] bg-danger-surface border border-red-200 p-3 flex items-center justify-between">
            <span className="font-caption text-caption text-danger-text">
              Total Pengeluaran
            </span>
            <span className="font-body-bold text-body-bold text-danger-text tabular-nums">
              {rupiah(data.finance.expense)}
            </span>
          </div>
          <div className="rounded-[8px] bg-brand-50 border border-brand-200 p-3 flex items-center justify-between">
            <span className="font-caption text-caption text-primary">
              Laba Bersih
            </span>
            <span className="font-body-bold text-body-bold text-primary tabular-nums">
              {rupiah(data.finance.net)}
            </span>
          </div>
        </div>

        {exportError ? (
          <p className="font-caption text-caption text-danger-text mt-2">
            {exportError}
          </p>
        ) : null}

        <div className="mt-4">
          <p className="font-body-bold text-body-bold text-text-secondary mb-2">
            Arus Kas 6 Bulan Terakhir
          </p>
          <div className="flex items-end justify-between gap-2 h-28">
            {data.finance.monthly.map((m) => (
              <div
                key={m.label}
                className="flex-1 flex flex-col items-center gap-1.5"
              >
                <div className="w-full flex items-end justify-center gap-0.5 h-20">
                  <div
                    className="w-2.5 rounded-t bg-success-base"
                    style={{ height: `${(m.income / maxMonthly) * 100}%` }}
                    title={`Masuk ${rupiah(m.income)}`}
                  />
                  <div
                    className="w-2.5 rounded-t bg-danger-base"
                    style={{ height: `${(m.expense / maxMonthly) * 100}%` }}
                    title={`Keluar ${rupiah(m.expense)}`}
                  />
                </div>
                <span className="font-caption text-caption text-text-muted">
                  {m.label.split(" ")[0]}
                </span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-surface rounded-[10px] p-4 clay-card lg:col-span-1">
        <div className="flex items-center gap-2 mb-3">
          <Icon name="receipt_long" className="text-primary text-[20px]" />
          <span className="font-headline-2 text-headline-2 text-text-primary">
            Piutang Belum Lunas
          </span>
        </div>
        <div className="rounded-[8px] bg-warning-surface border border-amber-200 p-3 flex items-center justify-between">
          <span className="font-caption text-caption text-warning-text tabular-nums">
            {data.receivables.count} order belum lunas
          </span>
          <span className="font-body-bold text-body-bold text-warning-text tabular-nums">
            {rupiah(data.receivables.total)}
          </span>
        </div>
      </section>
      </div>

      {/* Section Rincian Finansial per Metode Pembayaran (Cash, QRIS, Transfer) */}
      <section className="bg-surface rounded-[10px] p-4 clay-card">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Icon name="account_balance_wallet" className="text-primary text-[20px]" />
            <span className="font-headline-2 text-headline-2 text-text-primary">
              Rincian per Metode Pembayaran
            </span>
          </div>
          <span className="font-caption text-caption text-text-muted">
            3 Saluran Kas
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {(data.finance.byPaymentMethod ?? []).map((m) => {
            const isCash = m.method === "cash";
            const isQris = m.method === "qris";
            const iconName = isCash ? "payments" : isQris ? "qr_code_scanner" : "account_balance";
            const cardBg = isCash
              ? "bg-emerald-50/50 border-emerald-200"
              : isQris
              ? "bg-purple-50/50 border-purple-200"
              : "bg-blue-50/50 border-blue-200";
            const badgeCls = isCash
              ? "bg-emerald-100 text-emerald-800"
              : isQris
              ? "bg-purple-100 text-purple-800"
              : "bg-blue-100 text-blue-800";
            const iconCls = isCash
              ? "text-emerald-700 bg-emerald-100"
              : isQris
              ? "text-purple-700 bg-purple-100"
              : "text-blue-700 bg-blue-100";

            return (
              <div key={m.method} className={`rounded-[10px] border p-3.5 flex flex-col justify-between gap-3 ${cardBg}`}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className={`w-8 h-8 rounded-[8px] flex items-center justify-center shrink-0 ${iconCls}`}>
                      <Icon name={iconName} className="text-[18px]" />
                    </div>
                    <div>
                      <p className="font-body-bold text-body-bold text-text-primary leading-tight">{m.label}</p>
                      <p className="font-caption text-caption text-text-muted leading-none mt-0.5">
                        {m.incomeCount + m.expenseCount} transaksi
                      </p>
                    </div>
                  </div>
                  <span className={`px-2 py-0.5 rounded-[6px] font-caption text-[11px] font-semibold ${badgeCls}`}>
                    Net {rupiah(m.net)}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-2 pt-2 border-t border-black/5">
                  <div className="flex flex-col">
                    <span className="font-caption text-[11px] text-text-muted">Masuk</span>
                    <span className="font-body-bold text-caption text-success-text tabular-nums">
                      +{rupiah(m.income)}
                    </span>
                    <span className="font-caption text-[10px] text-text-muted">
                      {m.incomeCount} trx
                    </span>
                  </div>
                  <div className="flex flex-col text-right">
                    <span className="font-caption text-[11px] text-text-muted">Keluar</span>
                    <span className="font-body-bold text-caption text-danger-text tabular-nums">
                      -{rupiah(m.expense)}
                    </span>
                    <span className="font-caption text-[10px] text-text-muted">
                      {m.expenseCount} trx
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Section Riwayat & Detail Transaksi Finansial */}
      <section className="bg-surface rounded-[10px] p-4 clay-card">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-2.5 mb-3">
          <div className="flex items-center gap-2">
            <Icon name="receipt" className="text-primary text-[20px]" />
            <div>
              <span className="font-headline-2 text-headline-2 text-text-primary block">
                Riwayat Transaksi Finansial
              </span>
              <span className="font-caption text-caption text-text-muted block">
                Daftar pembayaran order, kas masuk, dan kas keluar ({filteredTx.length} transaksi)
              </span>
            </div>
          </div>

          {/* Search box */}
          <div className="relative min-w-[220px]">
            <Icon name="search" className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted text-[18px]" />
            <input
              type="text"
              placeholder="Cari order, plat, keterangan..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full h-9 pl-9 pr-3 rounded-[8px] border border-border bg-surface-container-low font-caption text-caption text-text-primary outline-none focus:border-primary"
            />
          </div>
        </div>

        {/* Filter Bar */}
        <div className="flex flex-wrap items-center gap-2 mb-3.5 pb-2.5 border-b border-border/50">
          <span className="font-caption text-[11px] text-text-muted font-medium mr-1">Metode:</span>
          {[
            { id: "all", label: "Semua" },
            { id: "cash", label: "Tunai" },
            { id: "qris", label: "QRIS" },
            { id: "bank_transfer", label: "Transfer" },
          ].map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setMethodFilter(f.id as any)}
              className={`px-3 py-1 rounded-full text-caption transition-colors ${
                methodFilter === f.id
                  ? "bg-primary text-white font-semibold"
                  : "bg-surface-container-low text-text-secondary hover:bg-surface-container"
              }`}
            >
              {f.label}
            </button>
          ))}

          <span className="font-caption text-[11px] text-text-muted font-medium ml-2 mr-1">Tipe:</span>
          {[
            { id: "all", label: "Semua" },
            { id: "in", label: "Masuk (+)" },
            { id: "out", label: "Keluar (-)" },
          ].map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setTypeFilter(f.id as any)}
              className={`px-3 py-1 rounded-full text-caption transition-colors ${
                typeFilter === f.id
                  ? "bg-brand-600 text-white font-semibold"
                  : "bg-surface-container-low text-text-secondary hover:bg-surface-container"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        {/* Transaction items */}
        {visibleTx.length === 0 ? (
          <div className="py-8 text-center font-caption text-caption text-text-muted">
            Tidak ada transaksi yang cocok dengan filter.
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {visibleTx.map((tx) => {
              const isCash = tx.paymentMethod === "cash";
              const isQris = tx.paymentMethod === "qris";
              const methodBadgeCls = isCash
                ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                : isQris
                ? "bg-purple-50 text-purple-700 border-purple-200"
                : "bg-blue-50 text-blue-700 border-blue-200";
              const methodLabel = isCash ? "Tunai" : isQris ? "QRIS" : "Transfer";

              const formattedDate = new Date(tx.createdAt).toLocaleDateString("id-ID", {
                timeZone: "Asia/Jakarta",
                day: "numeric",
                month: "short",
                year: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              });

              return (
                <div
                  key={tx.id}
                  className="p-3 rounded-[8px] bg-surface-variant/40 hover:bg-surface-variant border border-border-subtle flex items-center justify-between gap-3 transition-colors"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div
                      className={`w-8 h-8 rounded-[8px] flex items-center justify-center shrink-0 ${
                        tx.type === "in" ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"
                      }`}
                    >
                      <Icon name={tx.type === "in" ? "arrow_downward" : "arrow_upward"} className="text-[18px]" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-body-bold text-caption text-text-primary truncate">
                          {tx.description || tx.category}
                        </p>
                        <span className={`px-2 py-0.5 rounded-[4px] border text-[11px] font-medium shrink-0 ${methodBadgeCls}`}>
                          {methodLabel}
                        </span>
                      </div>
                      <p className="font-caption text-[11px] text-text-muted mt-0.5">
                        {tx.category} · {formattedDate} WIB
                      </p>
                    </div>
                  </div>

                  <span
                    className={`font-body-bold text-body-bold shrink-0 tabular-nums ${
                      tx.type === "in" ? "text-success-text" : "text-danger-text"
                    }`}
                  >
                    {tx.type === "in" ? "+" : "-"}{rupiah(tx.amount)}
                  </span>
                </div>
              );
            })}

            {filteredTx.length > displayCount && (
              <button
                type="button"
                onClick={() => setDisplayCount((c) => c + 15)}
                className="w-full py-2.5 mt-2 rounded-[8px] bg-surface-container-low hover:bg-surface-container font-caption text-caption text-primary font-semibold transition-colors"
              >
                Muat Lebih Banyak ({filteredTx.length - displayCount} transaksi tersisa)
              </button>
            )}
          </div>
        )}
      </section>

      {/* Row 2 desktop: omzet cabang + rincian keuangan + unit terjual */}
      <div className="lg:grid lg:grid-cols-3 lg:gap-4 flex flex-col gap-4">
      <section className="bg-surface rounded-[10px] p-4 clay-card">
        <div className="flex items-center gap-2 mb-3">
          <Icon name="storefront" className="text-primary text-[20px]" />
          <span className="font-headline-2 text-headline-2 text-text-primary">
            Omzet per Cabang
          </span>
        </div>
        <div className="flex flex-col gap-3">
          {data.branchRevenue.length === 0 ? (
            <p className="font-caption text-caption text-text-muted">
              Belum ada order selesai di cabang ini.
            </p>
          ) : (
            data.branchRevenue.map((b) => (
              <div key={b.branchName}>
                <div className="flex items-center justify-between mb-1">
                  <span className="font-body-bold text-body-bold text-text-primary">
                    {b.branchName}
                  </span>
                  <span className="font-body-bold text-body-bold text-primary tabular-nums">
                    {rupiah(b.revenue)}
                  </span>
                </div>
                <div className="h-2 rounded-[4px] bg-surface-variant overflow-hidden">
                  <div
                    className="h-full rounded-[4px] primary-gradient"
                    style={{ width: `${(b.revenue / maxBranch) * 100}%` }}
                  />
                </div>
                <span className="font-caption text-caption text-text-muted tabular-nums">
                  {b.orders} order selesai
                </span>
              </div>
            ))
          )}
        </div>
      </section>

      {/* Rincian Keuangan */}
      <section className="bg-surface rounded-[10px] p-4 clay-card">
        <div className="flex items-center gap-2 mb-3">
          <Icon name="payments" className="text-primary text-[20px]" />
          <span className="font-headline-2 text-headline-2 text-text-primary">
            Rincian Keuangan per Kategori
          </span>
        </div>
        {data.finance.byCategory.length === 0 ? (
          <p className="font-caption text-caption text-text-muted">
            Belum ada transaksi kas tercatat.
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {data.finance.byCategory.map((c) => (
              <div
                key={`${c.type}-${c.category}`}
                className="flex items-center justify-between rounded-[8px] bg-surface-variant border border-border-subtle px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="font-body-bold text-caption text-text-primary">
                    {c.category}
                  </p>
                  <p className="font-caption text-caption text-text-muted tabular-nums">
                    {c.type === "in" ? "Masuk" : "Keluar"} · {c.count}x
                  </p>
                </div>
                <span
                  className={`font-body-bold text-body-bold shrink-0 tabular-nums ${
                    c.type === "in" ? "text-success-text" : "text-danger-text"
                  }`}
                >
                  {rupiah(c.amount)}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Unit Terjual */}
      <section className="bg-surface rounded-[10px] p-4 clay-card">
        <div className="flex items-center gap-2 mb-3">
          <Icon name="inventory_2" className="text-brand-600 text-[20px]" />
          <span className="font-headline-2 text-headline-2 text-text-primary">
            Unit Terjual per Layanan
          </span>
        </div>
        {data.unitsSoldCapped ? (
          <div className="flex items-start gap-2 rounded-xl bg-warning-surface px-3 py-2 mb-3">
            <Icon name="info" className="text-warning-text text-[16px] shrink-0 mt-0.5" />
            <p className="font-caption text-caption text-warning-text">
              Data rincian layanan hanya mencakup 500 order selesai terbaru.
              Untuk laporan lengkap, gunakan filter tanggal atau ekspor Excel.
            </p>
          </div>
        ) : null}
        {data.unitsSold.length === 0 ? (
          <p className="font-caption text-caption text-text-muted">
            Belum ada layanan terjual pada order selesai.
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {data.unitsSold.map((u) => (
              <div
                key={u.name}
                className="flex items-center justify-between rounded-xl bg-surface-container/60 px-3 py-2"
              >
                <p className="font-body-bold text-caption text-text-primary truncate">
                  {u.name}
                </p>
                <div className="text-right shrink-0">
                  <p className="font-body-bold text-body-bold text-brand-600">
                    {u.qty} unit
                  </p>
                  <p className="font-caption text-caption text-text-muted">
                    {rupiah(u.revenue)}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
      </div>{/* end omzet+rincian+units row */}

      {/* Row 3 desktop: stok (full width on mobile, centered on desktop) */}
      <section className="bg-surface rounded-[20px] p-4 clay-card border border-white/80">
        <div className="flex items-center gap-2 mb-3">
          <Icon name="inventory_2" className="text-brand-600 text-[20px]" />
          <span className="font-headline-2 text-headline-2 text-text-primary">
            Analisis Stok
          </span>
        </div>
        <div className="grid grid-cols-2 gap-2.5">
          <div className="rounded-2xl bg-surface-container/60 p-3">
            <p className="font-caption text-caption text-text-muted">
              Total Item
            </p>
            <p className="font-headline-2 text-headline-2 text-text-primary">
              {data.stock.total}
            </p>
          </div>
          <div className="rounded-2xl bg-warning-surface p-3">
            <p className="font-caption text-caption text-warning-text">
              Stok Kritis
            </p>
            <p className="font-headline-2 text-headline-2 text-warning-text">
              {data.stock.lowCount}
            </p>
          </div>
        </div>
        {data.stock.low.length > 0 ? (
          <div className="flex flex-col gap-2 mt-3">
            {data.stock.low.map((s) => (
              <div
                key={`${s.branchName}-${s.itemName}`}
                className="flex items-center justify-between rounded-xl bg-surface-container/60 p-2.5"
              >
                <div className="min-w-0">
                  <p className="font-body-bold text-caption text-text-primary truncate">
                    {s.itemName}
                  </p>
                  <p className="font-caption text-caption text-text-muted">
                    {s.branchName}
                  </p>
                </div>
                <span className="font-caption text-caption text-danger-text font-semibold shrink-0">
                  {s.current} / {s.min} {s.unit}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="font-caption text-caption text-text-muted mt-3">
            Semua stok di atas batas minimum.
          </p>
        )}

        <div className="mt-4">
          <p className="font-body-bold text-body-bold text-text-secondary mb-2">
            Mutasi Stok Terakhir
          </p>
          {data.stock.movement.length === 0 ? (
            <p className="font-caption text-caption text-text-muted">
              Belum ada pergerakan stok tercatat.
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {data.stock.movement.map((m) => (
                <div
                  key={`${m.createdAt}-${m.itemName}-${m.logType}`}
                  className="flex items-center justify-between rounded-xl bg-surface-container/60 px-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="font-body-bold text-caption text-text-primary truncate">
                      {m.itemName}
                    </p>
                    <p className="font-caption text-caption text-text-muted">
                      {m.logType} · {new Date(m.createdAt).toLocaleString("id-ID", {
                        timeZone: "Asia/Jakarta",
                        dateStyle: "short",
                        timeStyle: "short",
                      })}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p
                      className={`font-body-bold text-body-bold ${
                        m.quantity < 0 ? "text-danger-text" : "text-success-text"
                      }`}
                    >
                      {m.quantity > 0 ? `+${m.quantity}` : m.quantity}
                    </p>
                    <p className="font-caption text-caption text-text-muted">
                      saldo {m.balanceAfter}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      <p className="font-caption text-caption text-text-muted text-center">
        Dibuat {new Date(data.generatedAt).toLocaleString("id-ID", {
          timeZone: "Asia/Jakarta",
        })}{" "}
        WIB
      </p>
    </div>
  );
}
