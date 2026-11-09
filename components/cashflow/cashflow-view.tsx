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
  by_method: { method: string; masuk: number; keluar: number }[];
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
    <div className="px-gutter py-4 flex flex-col gap-4">
      {/* Filter */}
      <div className="clay-card p-4 flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="font-headline-2 text-headline-2 text-text-primary">Periode</h2>
          {pending && <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />}
        </div>
        <div className="flex gap-2 flex-wrap">
          {(["bulan_ini","bulan_lalu","3bulan","tahun_ini"] as const).map((p) => (
            <button key={p} type="button" onClick={() => applyPreset(p)}
              className="px-3 h-9 rounded-full bg-surface-container-low text-text-secondary font-caption text-caption active:scale-95 transition-transform">
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

      {report && (
        <>
          {/* Net cash hero */}
          <div className={`relative overflow-hidden rounded-[20px] p-5 clay-glow ${net >= 0 ? "primary-gradient text-on-primary" : "bg-danger-surface"}`}>
            <div className="relative z-10">
              <p className="font-caption text-caption opacity-80">Net Arus Kas</p>
              <p className="font-metric-display text-metric-display text-white tracking-tight leading-none mt-1">
                {formatRupiah(net)}
              </p>
              <p className="font-caption text-caption opacity-80 mt-1">
                {fmtDate(from)} — {fmtDate(to)}
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

          {/* Per Metode */}
          {(report.by_method ?? []).length > 0 && (
            <div className="clay-card p-4 flex flex-col gap-3">
              <h3 className="font-headline-2 text-headline-2 text-text-primary">Per Metode Pembayaran</h3>
              {report.by_method.map((m) => (
                <div key={m.method} className="flex items-center justify-between py-1.5 border-b border-outline-variant/40 last:border-0">
                  <span className="font-caption text-caption text-text-secondary">{METHOD_LABEL[m.method] ?? m.method}</span>
                  <div className="text-right">
                    <p className="font-caption text-caption text-success-text">+{formatRupiah(m.masuk)}</p>
                    {m.keluar > 0 && <p className="font-caption text-caption text-danger-text">-{formatRupiah(m.keluar)}</p>}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Detail transaksi toggle */}
          <button type="button" onClick={() => setShowTx((v) => !v)}
            className="clay-card p-4 flex items-center justify-between active:scale-[0.99] transition-transform">
            <span className="font-body-bold text-body-bold text-text-primary">
              Detail Transaksi ({(report.transactions ?? []).length})
            </span>
            <Icon name={showTx ? "expand_more" : "chevron_right"} className="text-text-muted text-[20px]" />
          </button>

          {showTx && (
            <div className="clay-card flex flex-col divide-y divide-outline-variant/40">
              {(report.transactions ?? []).map((tx) => (
                <div key={tx.id} className="px-4 py-3 flex items-center justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="font-caption text-caption text-text-primary truncate">{tx.category}</p>
                    {tx.description && <p className="font-micro-badge text-micro-badge text-text-muted truncate">{tx.description}</p>}
                    <p className="font-micro-badge text-micro-badge text-text-muted">{tx.date} · {METHOD_LABEL[tx.payment_method] ?? tx.payment_method}</p>
                  </div>
                  <p className={`font-body-bold text-body-bold shrink-0 ${tx.type === "in" ? "text-success-text" : "text-danger-text"}`}>
                    {tx.type === "in" ? "+" : "-"}{formatRupiah(tx.amount)}
                  </p>
                </div>
              ))}
            </div>
          )}

          {/* Export */}
          <button type="button" onClick={exportExcel}
            className="w-full py-4 rounded-2xl bg-success-base text-white font-body-bold text-body-bold flex items-center justify-center gap-2 active:scale-95 transition-transform">
            <Icon name="download" className="text-[22px]" />
            Export Excel (.xlsx)
          </button>
        </>
      )}
    </div>
  );
}
