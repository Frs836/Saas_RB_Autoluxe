"use client";

import { useCallback, useMemo, useState } from "react";
import { formatRupiah } from "@/lib/format";

type PettyCashRow = {
  id: string;
  createdAt: string;
  amount: number;
  category: string;
  description: string | null;
  paymentMethod: string;
  proofPhotoUrl: string | null;
};

type FormState = {
  type: "in" | "out";
  amount: string;
  category: string;
  description: string;
  paymentMethod: string;
};

const CATEGORIES_OUT = [
  "Perlengkapan Wash",
  "Bahan Detailing",
  "Konsumsi Staf",
  "Operasional Umum",
  "Lainnya",
];

export function KasConsole({
  pettyCash,
  handoff,
  canManage,
  branchName,
}: {
  pettyCash: PettyCashRow[];
  handoff: { opening: number; status: string; expected: number | null; actual: number | null } | null;
  canManage: boolean;
  branchName: string;
}) {
  const [form, setForm] = useState<FormState>({
    type: "out",
    amount: "",
    category: "Perlengkapan Wash",
    description: "",
    paymentMethod: "cash",
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const totalOut = useMemo(() => pettyCash.reduce((sum, row) => sum + Number(row.amount || 0), 0), [pettyCash]);

  const disabled = !canManage || loading;

  const onSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const amount = Number(form.amount.replace(/\D/g, ""));
    if (!amount || amount <= 0) {
      setError("Nominal harus lebih dari 0");
      return;
    }
    setLoading(true);
    // Placeholder: akan terhubung ke RPC/Supabase nanti
    setTimeout(() => {
      setLoading(false);
      setForm({ ...form, amount: "", description: "" });
    }, 500);
  }, [form]);

  return (
    <div className="min-h-screen bg-canvas">
      <div className="pb-[calc(68px+env(safe-area-inset-bottom)+24px)] px-gutter pt-4 space-y-space-lg">
        <section className="clay-card flex flex-col gap-space-md p-space-lg">
          <div className="flex items-center justify-between">
            <h2 className="font-headline-2 text-headline-2 text-text-primary">Ringkasan Kas</h2>
            <span className="font-caption text-caption text-text-muted">{branchName}</span>
          </div>
          <div className="grid grid-cols-2 gap-space-md">
            <div className="clay-card p-space-md flex flex-col gap-space-xs">
              <p className="font-caption text-caption text-text-muted">Saldo Awal Shift</p>
              <p className="font-metric text-metric-display text-text-primary">{formatRupiah(handoff?.opening ?? 0)}</p>
            </div>
            <div className="clay-card p-space-md flex flex-col gap-space-xs">
              <p className="font-caption text-caption text-text-muted">Total Pengeluaran Petty Cash</p>
              <p className="font-metric text-metric-display text-danger-text">{formatRupiah(totalOut)}</p>
            </div>
          </div>
          {handoff && (
            <div className="flex flex-wrap gap-space-sm font-caption text-caption text-text-secondary">
              <span>Status Shift: {handoff.status}</span>
              <span>Ekspektasi: {formatRupiah(handoff.expected ?? 0)}</span>
              <span>Fisik: {formatRupiah(handoff.actual ?? 0)}</span>
            </div>
          )}
        </section>

        {canManage && (
          <section className="clay-card flex flex-col gap-space-md p-space-lg">
            <div className="flex items-center justify-between">
              <h2 className="font-headline-2 text-headline-2 text-text-primary">Catat Transaksi Kas</h2>
              <span className="px-2 py-0.5 rounded-full bg-brand-50 text-brand-600 font-micro-badge text-micro-badge">Petty Cash</span>
            </div>
            <form onSubmit={onSubmit} className="flex flex-col gap-space-md">
              <div className="flex flex-col gap-space-xs">
                <label className="font-caption text-caption text-text-secondary">Jenis</label>
                <div className="grid grid-cols-2 gap-space-xs">
                  <button
                    type="button"
                    onClick={() => setForm((f) => ({ ...f, type: "out", category: "Perlengkapan Wash" }))}
                    className={`h-11 rounded-xl font-body-bold text-body-bold transition-colors ${
                      form.type === "out"
                        ? "bg-brand-500 text-on-primary shadow-[0px_8px_16px_rgba(37,99,235,0.25)]"
                        : "bg-surface-container-low text-text-secondary shadow-[inset_0px_2px_4px_rgba(255,255,255,0.95)]"
                    }`}
                  >
                    Pengeluaran
                  </button>
                  <button
                    type="button"
                    onClick={() => setForm((f) => ({ ...f, type: "in", category: "Lainnya" }))}
                    className={`h-11 rounded-xl font-body-bold text-body-bold transition-colors ${
                      form.type === "in"
                        ? "bg-success-base text-white shadow-[0px_8px_16px_rgba(16,185,129,0.25)]"
                        : "bg-surface-container-low text-text-secondary shadow-[inset_0px_2px_4px_rgba(255,255,255,0.95)]"
                    }`}
                  >
                    Pemasukan
                  </button>
                </div>
              </div>

              <div className="flex flex-col gap-space-xs">
                <label className="font-caption text-caption text-text-secondary">Kategori</label>
                <select
                  value={form.category}
                  onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
                  className="h-12 rounded-xl bg-surface px-3 font-body-regular text-body-regular text-text-primary shadow-[inset_0px_2px_4px_rgba(15,23,42,0.06)]"
                >
                  {CATEGORIES_OUT.map((cat) => (
                    <option key={cat} value={cat}>
                      {cat}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex flex-col gap-space-xs">
                <label className="font-caption text-caption text-text-secondary">Nominal</label>
                <div className="relative flex items-center h-12 rounded-xl bg-surface shadow-[inset_0px_2px_4px_rgba(15,23,42,0.06)] px-3">
                  <span className="font-body-bold text-headline-2 text-primary-container pr-2">Rp</span>
                  <input
                    value={form.amount}
                    onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value.replace(/\D/g, "") }))}
                    placeholder="120000"
                    inputMode="numeric"
                    className="w-full h-full bg-transparent font-headline-2 text-headline-2 font-semibold text-text-primary focus:outline-none"
                  />
                </div>
              </div>

              <div className="flex flex-col gap-space-xs">
                <label className="font-caption text-caption text-text-secondary">Keterangan</label>
                <input
                  value={form.description}
                  onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                  placeholder="Keterangan transaksi"
                  className="h-12 rounded-xl bg-surface px-3 font-body-regular text-body-regular text-text-primary shadow-[inset_0px_2px_4px_rgba(15,23,42,0.06)]"
                />
              </div>

              {error && <p className="font-caption text-caption text-danger-text">{error}</p>}
              <button
                type="submit"
                disabled={disabled}
                className="h-[50px] rounded-full bg-primary-gradient text-on-primary font-body-bold text-body-bold shadow-[0px_10px_22px_rgba(37,99,235,0.24)] disabled:opacity-60"
              >
                Simpan Transaksi
              </button>
            </form>
          </section>
        )}

        <section className="clay-card flex flex-col gap-space-md p-space-lg">
          <div className="flex items-center justify-between">
            <h2 className="font-headline-2 text-headline-2 text-text-primary">Riwayat Petty Cash</h2>
            <span className="font-caption text-caption text-text-muted">{pettyCash.length} transaksi</span>
          </div>
          <div className="flex flex-col gap-space-sm">
            {pettyCash.length === 0 ? (
              <div className="py-8 text-center font-caption text-caption text-text-muted">
                Belum ada transaksi
              </div>
            ) : (
              pettyCash.slice(0, 20).map((row) => (
                <div key={row.id} className="flex items-start justify-between gap-space-sm py-2 border-b border-border-subtle last:border-b-0">
                  <div className="flex flex-col min-w-0">
                    <p className="font-body-bold text-body-bold text-text-primary truncate">{row.category}</p>
                    <p className="font-caption text-caption text-text-muted truncate">{row.description || "-"}</p>
                    <p className="font-caption text-caption text-text-muted">{row.paymentMethod.toUpperCase()}</p>
                  </div>
                  <div className="text-right">
                    <p className="font-body-bold text-body-bold text-danger-text">{formatRupiah(row.amount)}</p>
                    <p className="font-caption text-caption text-text-muted">{row.createdAt.slice(11, 16)} WIB</p>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
