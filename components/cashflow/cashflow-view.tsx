"use client";

import { useState, useTransition } from "react";
import { createClient } from "@/lib/supabase/client";
import { Icon } from "@/components/ui/icon";
import { formatRupiah } from "@/lib/format";

type CashFlowReport = {
  period: { from: string; to: string };
  inflow: { from_orders: number; other: number; total: number };
  outflow: { bahan: number; konsumsi: number; operasional: number; lainnya: number; total: number };
  net_cash: number;
  by_method: { method: string; masuk: number; keluar: number; count_in?: number; count_out?: number }[];
  daily: { date: string; masuk: number; keluar: number; net: number }[];
  transactions: {
    id: string; date: string; type: string; amount: number;
    category: string; description: string | null;
    payment_method: string; order_id: string | null;
  }[];
  generated_at: string;
};

const METHOD_LABEL: Record<string, string> = {
  cash: "Tunai", qris: "QRIS", bank_transfer: "Transfer Bank",
};

function formatDate(d: Date): string { return d.toISOString().slice(0, 10); }
function fmtDate(s: string): string {
  return new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeZone: "Asia/Jakarta" }).format(new Date(s));
}

export function CashFlowView({
  initialReport, branchId, defaultFrom, defaultTo, error: initErr,
}: {
  initialReport: CashFlowReport | null;
  branchId: string | null;
  defaultFrom: string;
  defaultTo: string;
  error: string | null;
}) {
  const [report,  setReport]  = useState<CashFlowReport | null>(initialReport);
  const [from,    setFrom]    = useState(defaultFrom);
  const [to,      setTo]      = useState(defaultTo);
  const [showTx,  setShowTx]  = useState(false);
  const [methodFilter, setMethodFilter] = useState<"all" | "cash" | "qris" | "bank_transfer">("all");
  const [error,   setError]   = useState<string | null>(initErr);
  const [pending, startTransition] = useTransition();

  function applyPreset(p: "bulan_ini"|"bulan_lalu"|"3bulan"|"tahun_ini") {
    const now = new Date();
    let f: Date, t = now;
    if (p === "bulan_ini")  { f = new Date(now.getFullYear(), now.getMonth(), 1); }
    else if (p === "bulan_lalu") { f = new Date(now.getFullYear(), now.getMonth()-1, 1); t = new Date(now.getFullYear(), now.getMonth(), 0); }
    else if (p === "3bulan") { f = new Date(now.getFullYear(), now.getMonth()-2, 1); }
    else { f = new Date(now.getFullYear(), 0, 1); }
    setFrom(formatDate(f)); setTo(formatDate(t));
    fetchReport(formatDate(f), formatDate(t));
  }

  function fetchReport(f: string, t: string) {
    startTransition(async () => {
      setError(null);
      const supabase = createClient();
      const { data, error: rpcErr } = await (supabase as any).rpc("get_cash_flow_statement", {
        ...(branchId ? { p_branch_id: branchId } : {}),
        p_from: f, p_to: t,
      });
      if (rpcErr) { setError(rpcErr.message); return; }
      setReport(data ?? null);
    });
  }

  async function exportExcel() {
    if (!report) return;
    const XLSX = await import("xlsx");
    const wb = XLSX.utils.book_new();

    // Sheet 1: Ringkasan
    const summary = [
      ["LAPORAN ARUS KAS - RB AUTOLUXE"],
      ["Periode:", `${fmtDate(from)} s/d ${fmtDate(to)}`],
      [],
      ["ARUS KAS MASUK"],
      ["Dari pembayaran order", report.inflow.from_orders],
      ["Pemasukan lainnya",     report.inflow.other],
      ["TOTAL KAS MASUK",       report.inflow.total],
      [],
      ["ARUS KAS KELUAR"],
      ["Bahan & Perlengkapan",  report.outflow.bahan],
      ["Konsumsi Staf",         report.outflow.konsumsi],
      ["Operasional Umum",      report.outflow.operasional],
      ["Lainnya",               report.outflow.lainnya],
      ["TOTAL KAS KELUAR",      report.outflow.total],
      [],
      ["NET ARUS KAS",          report.net_cash],
    ];
    const wsSummary = XLSX.utils.aoa_to_sheet(summary);
    wsSummary["!cols"] = [{ wch: 28 }, { wch: 18 }];
    XLSX.utils.book_append_sheet(wb, wsSummary, "Ringkasan");

    // Sheet 2: Per Metode Pembayaran
    const methodData = [
      ["Metode", "Masuk", "Keluar", "Net"],
      ...report.by_method.map((m) => [
        METHOD_LABEL[m.method] ?? m.method,
        m.masuk, m.keluar, m.masuk - m.keluar,
      ]),
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(methodData), "Per Metode");

    // Sheet 3: Trend Harian
    const dailyData = [
      ["Tanggal", "Masuk", "Keluar", "Net Harian"],
      ...(report.daily ?? []).map((d) => [d.date, d.masuk, d.keluar, d.net]),
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(dailyData), "Trend Harian");

    // Sheet 4: Detail Transaksi
    const txData = [
      ["Tanggal", "Jenis", "Kategori", "Keterangan", "Metode", "Jumlah"],
      ...(report.transactions ?? []).map((t) => [
        t.date,
        t.type === "in" ? "Masuk" : "Keluar",
        t.category,
        t.description ?? "",
        METHOD_LABEL[t.payment_method] ?? t.payment_method,
        t.type === "in" ? t.amount : -t.amount,
      ]),
    ];
    const wsTx = XLSX.utils.aoa_to_sheet(txData);
    wsTx["!cols"] = [{wch:12},{wch:8},{wch:22},{wch:30},{wch:14},{wch:14}];
    XLSX.utils.book_append_sheet(wb, wsTx, "Transaksi");

    const fileName = `ArusKas_${from}_${to}.xlsx`;
    XLSX.writeFile(wb, fileName);
  }

  const inflow  = report?.inflow;
  const outflow = report?.outflow;
  const net     = report?.net_cash ?? 0;

  return (
    <div className="px-gutter py-4 flex flex-col gap-4 lg:grid lg:grid-cols-3 lg:gap-6 lg:px-6 lg:py-6 lg:items-start">
      {/* Left column: filter + summary */}
      <div className="lg:col-span-1 flex flex-col gap-4">
      {/* Filter */}
      <div className="clay-card p-4 flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="font-headline-2 text-headline-2 text-text-primary">Periode</h2>
          {pending && <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />}
        </div>
        <div className="flex gap-2 flex-wrap">
          {(["bulan_ini","bulan_lalu","3bulan","tahun_ini"] as const).map((p) => (
            <button key={p} type="button" onClick={() => applyPreset(p)}
              className="px-3 h-9 rounded-full bg-surface-container-low text-text-secondary font-caption text-caption transition-transform">
              {p === "bulan_ini" ? "Bulan Ini" : p === "bulan_lalu" ? "Bulan Lalu" : p === "3bulan" ? "3 Bulan" : "Tahun Ini"}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1">
            <span className="font-caption text-caption text-text-muted">Dari</span>
            <input type="date" value={from} onChange={(e) => { setFrom(e.target.value); fetchReport(e.target.value, to); }}
              className="h-11 px-3 rounded-xl bg-surface-container-low font-body text-body text-text-primary outline-none" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-caption text-caption text-text-muted">Sampai</span>
            <input type="date" value={to} onChange={(e) => { setTo(e.target.value); fetchReport(from, e.target.value); }}
              className="h-11 px-3 rounded-xl bg-surface-container-low font-body text-body text-text-primary outline-none" />
          </label>
        </div>
      </div>

      {error && (
        <div className="p-3 rounded-xl bg-danger-surface text-danger-text font-caption text-caption flex items-center gap-2">
          <Icon name="error" className="text-[18px] shrink-0" />{error}
        </div>
      )}
      </div>{/* end left column */}

      {/* Right column: report content */}
      <div className="lg:col-span-2 flex flex-col gap-4">
      {error && (
        <div className="p-3 rounded-xl bg-danger-surface text-danger-text font-caption text-caption flex items-center gap-2 lg:hidden">
          <Icon name="error" className="text-[18px] shrink-0" />{error}
        </div>
      )}

      {report && (
        <>
          {/* Net cash hero */}
          <div className={`relative overflow-hidden rounded-[10px] p-5 clay-glow ${net >= 0 ? "primary-gradient text-on-primary" : "bg-danger-surface"}`}>
            <div className="relative z-10">
              <p className="font-caption text-caption opacity-80">Net Arus Kas</p>
              <p className="font-metric-display text-metric-display text-white tracking-tight leading-none mt-1">
                {formatRupiah(net)}
              </p>
              <p className="font-caption text-caption opacity-80 mt-1">
                {fmtDate(from)} hingga {fmtDate(to)}
              </p>
            </div>
          </div>

          {/* Inflow vs Outflow */}
          <div className="grid grid-cols-2 gap-3">
            <div className="clay-card p-4 flex flex-col gap-1">
              <div className="w-9 h-9 rounded-xl bg-success-surface flex items-center justify-center">
                <Icon name="arrow_forward" className="text-success-text text-[20px]" />
              </div>
              <p className="font-caption text-caption text-text-muted mt-2">Total Masuk</p>
              <p className="font-headline-2 text-headline-2 text-success-text">{formatRupiah(inflow?.total ?? 0)}</p>
              <p className="font-micro-badge text-micro-badge text-text-muted">Order: {formatRupiah(inflow?.from_orders ?? 0)}</p>
            </div>
            <div className="clay-card p-4 flex flex-col gap-1">
              <div className="w-9 h-9 rounded-xl bg-danger-surface flex items-center justify-center">
                <Icon name="arrow_back" className="text-danger-text text-[20px]" />
              </div>
              <p className="font-caption text-caption text-text-muted mt-2">Total Keluar</p>
              <p className="font-headline-2 text-headline-2 text-danger-text">{formatRupiah(outflow?.total ?? 0)}</p>
              <p className="font-micro-badge text-micro-badge text-text-muted">Bahan: {formatRupiah(outflow?.bahan ?? 0)}</p>
            </div>
          </div>

          {/* Rincian outflow */}
          <div className="clay-card p-4 flex flex-col gap-3">
            <h3 className="font-headline-2 text-headline-2 text-text-primary">Rincian Pengeluaran</h3>
            {[
              { label: "Bahan & Perlengkapan", value: outflow?.bahan ?? 0 },
              { label: "Konsumsi Staf",         value: outflow?.konsumsi ?? 0 },
              { label: "Operasional Umum",       value: outflow?.operasional ?? 0 },
              { label: "Lainnya",                value: outflow?.lainnya ?? 0 },
            ].map((r) => (
              <div key={r.label} className="flex items-center justify-between py-1.5 border-b border-outline-variant/40 last:border-0">
                <span className="font-caption text-caption text-text-secondary">{r.label}</span>
                <span className="font-body-bold text-body-bold text-text-primary">{formatRupiah(r.value)}</span>
              </div>
            ))}
          </div>

          {/* Per Metode Pembayaran Grid */}
          {(report.by_method ?? []).length > 0 && (
            <div className="clay-card p-4 flex flex-col gap-3">
              <div className="flex items-center gap-2">
                <Icon name="account_balance_wallet" className="text-primary text-[20px]" />
                <h3 className="font-headline-2 text-headline-2 text-text-primary">Per Metode Pembayaran</h3>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                {report.by_method.map((m) => {
                  const isCash = m.method === "cash";
                  const isQris = m.method === "qris";
                  const dotColor = isCash ? "bg-emerald-500" : isQris ? "bg-sky-500" : "bg-purple-500";
                  const badgeBg = isCash ? "bg-emerald-50 text-emerald-700" : isQris ? "bg-sky-50 text-sky-700" : "bg-purple-50 text-purple-700";

                  return (
                    <div key={m.method} className="p-3 rounded-[8px] bg-surface-variant border border-border-subtle flex flex-col gap-1.5">
                      <div className="flex items-center justify-between">
                        <span className="font-body-bold text-caption text-text-primary flex items-center gap-1.5">
                          <span className={`w-2 h-2 rounded-full ${dotColor}`} />
                          {METHOD_LABEL[m.method] ?? m.method}
                        </span>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold ${badgeBg}`}>
                          {m.count_in || 0} in
                        </span>
                      </div>
                      <div className="flex flex-col gap-0.5 pt-1 border-t border-border-subtle text-caption">
                        <div className="flex items-center justify-between">
                          <span className="text-text-muted">Masuk:</span>
                          <span className="font-body-bold text-success-text tabular-nums">+{formatRupiah(m.masuk)}</span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-text-muted">Keluar:</span>
                          <span className="font-body-bold text-danger-text tabular-nums">-{formatRupiah(m.keluar)}</span>
                        </div>
                        <div className="flex items-center justify-between pt-0.5 border-t border-border-subtle/50">
                          <span className="font-semibold text-text-secondary">Net:</span>
                          <span className="font-bold text-text-primary tabular-nums">{formatRupiah(m.masuk - m.keluar)}</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Detail transaksi toggle & list */}
          <div className="clay-card p-4 flex flex-col gap-3">
            <div className="flex items-center justify-between cursor-pointer" onClick={() => setShowTx((v) => !v)}>
              <span className="font-body-bold text-body-bold text-text-primary flex items-center gap-2">
                <Icon name="receipt_long" className="text-primary text-[20px]" />
                Detail Riwayat Transaksi ({(report.transactions ?? []).length})
              </span>
              <Icon name={showTx ? "expand_more" : "chevron_right"} className="text-text-muted text-[20px]" />
            </div>

            {showTx && (
              <div className="flex flex-col gap-3 pt-2 border-t border-border-subtle">
                {/* Method Filter Filter buttons */}
                <div className="flex gap-1.5 overflow-x-auto no-scrollbar">
                  {(
                    [
                      { key: "all", label: "Semua" },
                      { key: "cash", label: "Tunai" },
                      { key: "qris", label: "QRIS" },
                      { key: "bank_transfer", label: "Transfer" },
                    ] as const
                  ).map((f) => (
                    <button
                      key={f.key}
                      type="button"
                      onClick={() => setMethodFilter(f.key)}
                      className={`px-3 py-1 text-xs rounded-full border transition-all ${
                        methodFilter === f.key
                          ? "bg-primary text-white border-primary shadow-sm"
                          : "bg-surface-variant text-text-secondary border-border-subtle hover:bg-surface"
                      }`}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>

                {/* Transaction list */}
                {(() => {
                  const filtered = (report.transactions ?? []).filter((tx) =>
                    methodFilter === "all" ? true : tx.payment_method === methodFilter
                  );

                  if (filtered.length === 0) {
                    return (
                      <p className="p-4 text-center text-text-muted text-caption">
                        Tidak ada transaksi dengan metode pembayaran ini.
                      </p>
                    );
                  }

                  return (
                    <div className="flex flex-col divide-y divide-border-subtle">
                      {filtered.map((tx) => {
                        const isCash = tx.payment_method === "cash";
                        const isQris = tx.payment_method === "qris";
                        const badgeStyle = isCash
                          ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                          : isQris
                          ? "bg-sky-50 text-sky-700 border-sky-200"
                          : "bg-purple-50 text-purple-700 border-purple-200";

                        return (
                          <div key={tx.id} className="py-2.5 flex items-center justify-between gap-2">
                            <div className="flex-1 min-w-0">
                              <p className="font-caption text-caption text-text-primary truncate">
                                {tx.description || tx.category}
                              </p>
                              <p className="text-[11px] text-text-muted tabular-nums">
                                {tx.date} · {tx.category}
                              </p>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              <span className={`font-micro-badge text-[10px] px-2 py-0.5 rounded-full border font-semibold ${badgeStyle}`}>
                                {METHOD_LABEL[tx.payment_method] ?? tx.payment_method}
                              </span>
                              <p className={`font-body-bold text-caption tabular-nums shrink-0 ${tx.type === "in" ? "text-success-text" : "text-danger-text"}`}>
                                {tx.type === "in" ? "+" : "-"}{formatRupiah(tx.amount)}
                              </p>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  );
                })()}
              </div>
            )}
          </div>

          {/* Export */}
          <button type="button" onClick={exportExcel}
            className="w-full py-4 lg:py-2.5 rounded-[8px] primary-gradient clay-glow text-white font-body-bold text-body-bold flex items-center justify-center gap-2 hover:opacity-95 transition-opacity">
            <Icon name="download" className="text-[22px]" />
            Export Excel (.xlsx)
          </button>
        </>
      )}
      </div>{/* end right column */}
    </div>
  );
}
