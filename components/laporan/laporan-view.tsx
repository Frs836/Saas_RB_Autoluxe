"use client";

import { useState } from "react";

type Series = { label: string; income: number; expense: number };

export type LaporanData = {
  finance: {
    income: number;
    expense: number;
    net: number;
    monthly: Series[];
  };
  branchRevenue: { branchName: string; orders: number; revenue: number }[];
  commission: {
    name: string;
    roleLabel: string;
    orders: number;
    revenue: number;
    commission: number;
    hasRule: boolean;
  }[];
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
  };
  generatedAt: string;
};

function rupiah(value: number) {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(value);
}

function compact(value: number) {
  if (Math.abs(value) >= 1_000_000)
    return `Rp${(value / 1_000_000).toFixed(1).replace(".", ",")} jt`;
  if (Math.abs(value) >= 1_000)
    return `Rp${(value / 1_000).toFixed(0)} rb`;
  return `Rp${value}`;
}

export function LaporanView({ data }: { data: LaporanData }) {
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

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
      ];

      const branchSheet = [
        ["Cabang", "Jumlah Order", "Omzet"],
        ...data.branchRevenue.map((b) => [
          b.branchName,
          b.orders,
          b.revenue,
        ]),
      ];

      const commissionSheet = [
        ["Nama", "Peran", "Order Selesai", "Omzet Ditangani", "Komisi"],
        ...data.commission.map((c) => [
          c.name,
          c.roleLabel,
          c.orders,
          c.revenue,
          c.hasRule ? c.commission : 0,
        ]),
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

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(
        wb,
        XLSX.utils.aoa_to_sheet(financeSheet),
        "Finansial",
      );
      XLSX.utils.book_append_sheet(
        wb,
        XLSX.utils.aoa_to_sheet(branchSheet),
        "Omzet Cabang",
      );
      XLSX.utils.book_append_sheet(
        wb,
        XLSX.utils.aoa_to_sheet(commissionSheet),
        "Komisi Tim",
      );
      XLSX.utils.book_append_sheet(
        wb,
        XLSX.utils.aoa_to_sheet(stockSheet),
        "Stok Kritis",
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

  return (
    <div className="flex-1 px-gutter pt-4 pb-[calc(68px+env(safe-area-inset-bottom)+24px)] flex flex-col gap-4">
      <section className="bg-surface rounded-[20px] p-4 clay-card border border-white/80">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-brand-600 text-[20px]">
              account_balance_wallet
            </span>
            <span className="font-headline-2 text-headline-2 text-text-primary">
              Ringkasan Finansial
            </span>
          </div>
          <button
            type="button"
            onClick={handleExport}
            disabled={exporting}
            className="inline-flex items-center gap-1.5 min-h-11 px-3 rounded-full primary-gradient text-white font-body-bold text-caption active:scale-[0.98] transition-transform disabled:opacity-70"
          >
            <span className="material-symbols-outlined text-[18px]">
              download
            </span>
            {exporting ? "Menyiapkan..." : "Excel"}
          </button>
        </div>

        <div className="grid grid-cols-1 gap-2.5 mt-3">
          <div className="rounded-2xl bg-success-surface p-3 flex items-center justify-between">
            <span className="font-caption text-caption text-success-text">
              Total Pemasukan
            </span>
            <span className="font-body-bold text-body-bold text-success-text">
              {rupiah(data.finance.income)}
            </span>
          </div>
          <div className="rounded-2xl bg-danger-surface p-3 flex items-center justify-between">
            <span className="font-caption text-caption text-danger-text">
              Total Pengeluaran
            </span>
            <span className="font-body-bold text-body-bold text-danger-text">
              {rupiah(data.finance.expense)}
            </span>
          </div>
          <div className="rounded-2xl bg-brand-50 p-3 flex items-center justify-between">
            <span className="font-caption text-caption text-brand-700">
              Laba Bersih
            </span>
            <span className="font-body-bold text-body-bold text-brand-700">
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
            Tren 6 Bulan
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

      <section className="bg-surface rounded-[20px] p-4 clay-card border border-white/80">
        <div className="flex items-center gap-2 mb-3">
          <span className="material-symbols-outlined text-brand-600 text-[20px]">
            storefront
          </span>
          <span className="font-headline-2 text-headline-2 text-text-primary">
            Omzet per Cabang
          </span>
        </div>
        <div className="flex flex-col gap-3">
          {data.branchRevenue.length === 0 ? (
            <p className="font-caption text-caption text-text-muted">
              Belum ada order selesai.
            </p>
          ) : (
            data.branchRevenue.map((b) => (
              <div key={b.branchName}>
                <div className="flex items-center justify-between mb-1">
                  <span className="font-body-bold text-body-bold text-text-primary">
                    {b.branchName}
                  </span>
                  <span className="font-body-bold text-body-bold text-brand-600">
                    {rupiah(b.revenue)}
                  </span>
                </div>
                <div className="h-2 rounded-full bg-surface-container overflow-hidden">
                  <div
                    className="h-full rounded-full primary-gradient"
                    style={{ width: `${(b.revenue / maxBranch) * 100}%` }}
                  />
                </div>
                <span className="font-caption text-caption text-text-muted">
                  {b.orders} order selesai
                </span>
              </div>
            ))
          )}
        </div>
      </section>

      <section className="bg-surface rounded-[20px] p-4 clay-card border border-white/80">
        <div className="flex items-center gap-2 mb-3">
          <span className="material-symbols-outlined text-brand-600 text-[20px]">
            groups
          </span>
          <span className="font-headline-2 text-headline-2 text-text-primary">
            Rekap Komisi Tim
          </span>
        </div>
        <div className="flex flex-col gap-2.5">
          {data.commission.length === 0 ? (
            <p className="font-caption text-caption text-text-muted">
              Belum ada staf dengan order selesai atau aturan komisi.
            </p>
          ) : (
            data.commission.map((c) => (
              <div
                key={c.name}
                className="rounded-2xl bg-surface-container/60 p-3"
              >
                <div className="flex items-center justify-between">
                  <div className="min-w-0">
                    <p className="font-body-bold text-body-bold text-text-primary truncate">
                      {c.name}
                    </p>
                    <p className="font-caption text-caption text-text-muted">
                      {c.roleLabel} · {c.orders} order
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-caption text-caption text-text-muted">
                      Komisi
                    </p>
                    <p className="font-body-bold text-body-bold text-brand-600">
                      {c.hasRule ? rupiah(c.commission) : "Tanpa aturan"}
                    </p>
                  </div>
                </div>
                <p className="font-caption text-caption text-text-secondary mt-1">
                  Omzet ditangani {compact(c.revenue)}
                </p>
              </div>
            ))
          )}
        </div>
      </section>

      <section className="bg-surface rounded-[20px] p-4 clay-card border border-white/80">
        <div className="flex items-center gap-2 mb-3">
          <span className="material-symbols-outlined text-brand-600 text-[20px]">
            inventory_2
          </span>
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
