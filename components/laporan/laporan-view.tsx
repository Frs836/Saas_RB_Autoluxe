"use client";

import { useState } from "react";
import { Icon } from "@/components/ui/icon";

type Series = { label: string; income: number; expense: number };

export type LaporanData = {
  finance: {
    income: number;
    expense: number;
    net: number;
    monthly: Series[];
    byCategory: { category: string; type: string; amount: number; count: number }[];
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

  return (
    <div className="flex-1 px-gutter pt-4 pb-nav-plain flex flex-col gap-4">
      <section className="bg-surface rounded-[20px] p-4 clay-card border border-white/80">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Icon name="account_balance_wallet" className="text-brand-600 text-[20px]" />
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
            <Icon name="download" className="text-[18px]" />
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
          <Icon name="storefront" className="text-brand-600 text-[20px]" />
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
          <Icon name="payments" className="text-brand-600 text-[20px]" />
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
                className="flex items-center justify-between rounded-xl bg-surface-container/60 px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="font-body-bold text-caption text-text-primary">
                    {c.category}
                  </p>
                  <p className="font-caption text-caption text-text-muted">
                    {c.type === "in" ? "Masuk" : "Keluar"} · {c.count}×
                  </p>
                </div>
                <span
                  className={`font-body-bold text-body-bold shrink-0 ${
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

      <section className="bg-surface rounded-[20px] p-4 clay-card border border-white/80">
        <div className="flex items-center gap-2 mb-3">
          <Icon name="inventory_2" className="text-brand-600 text-[20px]" />
          <span className="font-headline-2 text-headline-2 text-text-primary">
            Unit Terjual per Layanan
          </span>
        </div>
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

      <section className="bg-surface rounded-[20px] p-4 clay-card border border-white/80">
        <div className="flex items-center gap-2 mb-3">
          <Icon name="receipt_long" className="text-brand-600 text-[20px]" />
          <span className="font-headline-2 text-headline-2 text-text-primary">
            Tagihan Belum Lunas
          </span>
        </div>
        <div className="rounded-2xl bg-warning-surface p-3 flex items-center justify-between">
          <span className="font-caption text-caption text-warning-text">
            {data.receivables.count} order belum lunas
          </span>
          <span className="font-body-bold text-body-bold text-warning-text">
            {rupiah(data.receivables.total)}
          </span>
        </div>
      </section>

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
