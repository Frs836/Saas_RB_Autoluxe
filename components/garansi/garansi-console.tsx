"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { formatDateWib, todayWibIso } from "@/lib/format";
import { createClient } from "@/lib/supabase/client";
import { Icon } from "@/components/ui/icon";

type Order = {
  id: string;
  orderNumber: string;
  customerName: string;
  vehiclePlate: string | null;
  totalPrice: number;
  completedAt: string | null;
};

type Warranty = {
  id: string;
  orderId: string | null;
  warrantyCode: string;
  startDate: string;
  endDate: string;
  status: string;
};

type ExistingClaim = {
  orderId: string;
  claimDate: string;
  status: string;
  problemDescription: string;
};

const CLAIM_STATUS_STYLE: Record<string, string> = {
  pending: "bg-warning-surface text-warning-text",
  approved: "bg-success-surface text-success-text",
  rejected: "bg-danger-surface text-danger-text",
};

const CLAIM_STATUS_LABEL: Record<string, string> = {
  pending: "Diproses",
  approved: "Disetujui",
  rejected: "Ditolak",
};

export function GaransiConsole({
  orders,
  warranties,
  claims,
  canManage,
  search,
}: {
  orders: Order[];
  warranties: Warranty[];
  claims: ExistingClaim[];
  canManage: boolean;
  search: string | null;
}) {
  const router = useRouter();
  const [selectedOrderId, setSelectedOrderId] = useState<string>("");
  const [problem, setProblem] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const warrantyByOrderId = useMemo(() => {
    const map = new Map<string, Warranty>();
    for (const warranty of warranties) {
      if (warranty.orderId) map.set(warranty.orderId, warranty);
    }
    return map;
  }, [warranties]);

  const claimByOrderId = useMemo(() => {
    const map = new Map<string, ExistingClaim>();
    for (const claim of claims) map.set(claim.orderId, claim);
    return map;
  }, [claims]);

  const selectedOrder = useMemo(
    () => orders.find((o) => o.id === selectedOrderId) ?? null,
    [orders, selectedOrderId],
  );

  // toISOString memakai UTC, sehingga antara 00:00 dan 07:00 WIB tanggalnya
  // masih kemarin. RPC create_warranty_claim memakai tanggal WIB, jadi kedua
  // sisi harus memakai basis yang sama.
  const today = todayWibIso();
  const selectedWarranty = selectedOrder
    ? (warrantyByOrderId.get(selectedOrder.id) ?? null)
    : null;

  const eligibility = useMemo(() => {
    if (!selectedOrder) return null;
    const existing = claimByOrderId.get(selectedOrder.id);
    if (existing?.status === "pending") {
      return { ok: false, reason: "Sudah ada klaim yang sedang diproses." };
    }
    if (!selectedWarranty) {
      return { ok: false, reason: "Order ini tidak memiliki sertifikat garansi." };
    }
    if (selectedWarranty.endDate < today) {
      return {
        ok: false,
        reason: `Masa garansi berakhir pada ${formatDateWib(selectedWarranty.endDate)}.`,
      };
    }
    if (selectedWarranty.status !== "active") {
      return {
        ok: false,
        reason: `Sertifikat garansi berstatus ${selectedWarranty.status}.`,
      };
    }
    return { ok: true, reason: null };
  }, [claimByOrderId, selectedOrder, selectedWarranty, today]);

  const canSubmit =
    canManage && Boolean(selectedOrder) && problem.trim().length >= 10 && !loading;

  const onSubmit = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      if (!selectedOrderId) return;

      setError(null);
      setSuccess(null);
      setLoading(true);

      try {
        const supabase = createClient();
        const { error: rpcError } = await supabase.rpc("create_warranty_claim", {
          p_order_id: selectedOrderId,
          p_problem_description: problem.trim(),
          p_proof_photo_url: undefined,
        });

        if (rpcError) {
          setError(rpcError.message);
          return;
        }

        setProblem("");
        setSelectedOrderId("");
        setSuccess("Klaim garansi diajukan dan menunggu peninjauan.");
        router.refresh();
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Terjadi kesalahan, coba lagi.",
        );
      } finally {
        setLoading(false);
      }
    },
    [problem, router, selectedOrderId],
  );

  return (
    <div className="min-h-screen bg-canvas">
      <div className="pb-nav-plain lg:pb-8 px-gutter pt-4 space-y-space-lg lg:grid lg:grid-cols-3 lg:gap-6 lg:px-6 lg:py-6 lg:items-start">
        <section className="clay-card rounded-[10px] flex flex-col gap-space-md p-space-lg lg:col-span-1 lg:sticky lg:top-20">
          <div className="flex items-center justify-between">
            <h2 className="font-headline-2 text-headline-2 text-text-primary">Klaim Garansi</h2>
            <span className="px-2.5 py-0.5 rounded-[6px] border border-brand-200 bg-brand-50 text-brand-600 font-micro-badge text-micro-badge">
              Berdasarkan Order Completed
            </span>
          </div>

          {/*
           * Formulir pencarian sengaja diletakkan di luar formulir klaim.
           *
           * Sebelumnya keduanya bersarang, yaitu form di dalam form.
           * HTML tidak memperbolehkan itu, dan browser menutup formulir luar
           * secara otomatis saat membaca HTML. Akibatnya pohon yang dibaca
           * browser tidak sama dengan yang diharap React, sehingga muncul
           * "A tree hydrated but some attributes of the server rendered HTML
           * did not match" beserta error "cannot be a descendant of form".
           */}
          <div className="flex flex-col gap-space-xs">
            <label className="font-caption text-caption text-text-secondary">
              Cari order (plat atau nomor order)
            </label>
            <form action="/garansi" method="get" className="flex gap-2">
              <input
                type="search"
                name="q"
                defaultValue={search ?? ""}
                placeholder="B 1234 XYZ atau RBA-2026..."
                className="flex-1 h-11 px-3.5 rounded-[8px] border border-border bg-surface font-body text-body text-text-primary outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
              />
              <button
                type="submit"
                className="h-11 px-4 rounded-[8px] border border-brand-200 bg-brand-50 text-brand-700 font-caption text-caption flex items-center gap-1 hover:bg-brand-100 transition-colors"
              >
                <Icon name="search" className="text-[16px]" />
                Cari
              </button>
            </form>
            {search ? (
              <button
                type="button"
                onClick={() => router.push("/garansi")}
                className="self-start font-micro-badge text-micro-badge text-brand-700 hover:underline"
              >
                Bersihkan pencarian
              </button>
            ) : null}
          </div>

          <form onSubmit={onSubmit} className="flex flex-col gap-space-md">
            <div className="flex flex-col gap-space-xs">
              <label className="font-caption text-caption text-text-secondary">
                Pilih Order (Completed)
              </label>
              <select
                value={selectedOrderId}
                onChange={(e) => {
                  setSelectedOrderId(e.target.value);
                  setError(null);
                  setSuccess(null);
                }}
                className="h-11 rounded-[8px] border border-border bg-surface px-3 font-body text-body text-text-primary outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
              >
                <option value="">Pilih order...</option>
                {orders.map((order) => (
                  <option key={order.id} value={order.id}>
                    {order.orderNumber} - {order.vehiclePlate} - {order.customerName}
                  </option>
                ))}
              </select>
              {orders.length === 0 ? (
                <span className="font-micro-badge text-micro-badge text-text-muted">
                  {search
                    ? "Tidak ada order yang cocok dengan pencarian."
                    : "Belum ada order selesai."}
                </span>
              ) : null}
            </div>

            {selectedOrder && selectedWarranty ? (
              <div className="rounded-[8px] bg-surface-container-low border border-border px-3.5 py-2.5 flex flex-col gap-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-caption text-caption text-text-secondary">
                    Sertifikat
                  </span>
                  <span className="font-body-bold text-body-bold text-text-primary font-mono">
                    {selectedWarranty.warrantyCode}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="font-caption text-caption text-text-secondary">
                    Berlaku sampai
                  </span>
                  <span className="font-caption text-caption text-text-primary">
                    {formatDateWib(selectedWarranty.endDate)}
                  </span>
                </div>
              </div>
            ) : null}

            <div className="flex flex-col gap-space-xs">
              <label className="font-caption text-caption text-text-secondary">
                Detail Keluhan
              </label>
              <textarea
                value={problem}
                onChange={(e) => setProblem(e.target.value)}
                placeholder="Deskripsikan kerusakan/keluhan pelanggan (minimal 10 karakter)"
                rows={3}
                className="rounded-[8px] border border-border bg-surface px-3.5 py-2.5 font-body text-body text-text-primary outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
              />
              {problem.length > 0 && problem.trim().length < 10 ? (
                <p className="font-caption text-caption text-warning-text">
                  Detail keluhan masih terlalu pendek ({problem.trim().length}/10).
                </p>
              ) : null}
            </div>

            {eligibility && !eligibility.ok ? (
              <p className="font-caption text-caption text-danger-text">
                {eligibility.reason}
              </p>
            ) : null}
            {error && (
              <p className="font-caption text-caption text-danger-text">{error}</p>
            )}
            {success && (
              <p className="font-caption text-caption text-success-text">{success}</p>
            )}

            <button
              type="submit"
              disabled={!canSubmit || (eligibility ? !eligibility.ok : true)}
              className="h-11 rounded-[8px] primary-gradient clay-glow text-white font-body-bold text-body-bold hover:opacity-90 transition-opacity disabled:opacity-60"
            >
              {loading ? "Mengirim..." : "Ajukan Klaim Garansi"}
            </button>
          </form>
        </section>

        <div className="lg:col-span-2 flex flex-col gap-space-lg">
        <section className="clay-card rounded-[10px] flex flex-col gap-space-md p-space-lg">
          <div className="flex items-center justify-between">
            <h2 className="font-headline-2 text-headline-2 text-text-primary">
              Riwayat Klaim
            </h2>
            <span className="font-caption text-caption text-text-muted">
              {claims.length} klaim
            </span>
          </div>
          <div className="flex flex-col gap-space-sm">
            {claims.length === 0 ? (
              <div className="py-8 text-center font-caption text-caption text-text-muted">
                Belum ada klaim
              </div>
            ) : (
              claims.map((claim) => (
                <div
                  key={`${claim.orderId}-${claim.claimDate}`}
                  className="flex flex-col gap-space-xs py-3 border-b border-border last:border-b-0"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-body-bold text-body-bold text-text-primary">
                      {orders.find((o) => o.id === claim.orderId)?.orderNumber ??
                        claim.orderId.slice(0, 8)}
                    </span>
                    <span
                      className={`self-start px-2 py-0.5 rounded-[6px] border font-micro-badge text-micro-badge uppercase ${CLAIM_STATUS_STYLE[claim.status] ?? "bg-surface-container text-text-secondary border-border"}`}
                    >
                      {CLAIM_STATUS_LABEL[claim.status] ?? claim.status}
                    </span>
                  </div>
                  <p className="font-caption text-caption text-text-secondary">
                    {claim.problemDescription}
                  </p>
                  <p className="font-caption text-caption text-text-muted">
                    Diajukan {formatDateWib(claim.claimDate)}
                  </p>
                </div>
              ))
            )}
          </div>
        </section>

        <section className="clay-card rounded-[10px] flex flex-col gap-space-md p-space-lg">
          <div className="flex items-center justify-between">
            <h2 className="font-headline-2 text-headline-2 text-text-primary">
              Sertifikat Garansi Aktif
            </h2>
            <span className="font-caption text-caption text-text-muted">
              {warranties.length} item
            </span>
          </div>
          <div className="flex flex-col gap-space-sm">
            {warranties.length === 0 ? (
              <div className="py-8 text-center font-caption text-caption text-text-muted">
                Belum ada garansi terbit
              </div>
            ) : (
              warranties.map((w) => {
                const expired = w.endDate < today;
                return (
                  <div
                    key={w.id}
                    className="flex flex-col gap-space-xs py-3 border-b border-border last:border-b-0"
                  >
                    <p className="font-body-bold text-body-bold text-text-primary">
                      {w.warrantyCode}
                    </p>
                    <div className="flex items-center justify-between font-caption text-caption text-text-muted">
                      <span>Mulai: {formatDateWib(w.startDate)}</span>
                      <span>Berakhir: {formatDateWib(w.endDate)}</span>
                    </div>
                    <span
                      className={`self-start px-2 py-0.5 rounded-[6px] border font-micro-badge text-micro-badge uppercase ${
                        expired
                          ? "bg-red-50 text-red-700 border-red-200"
                          : "bg-emerald-50 text-emerald-700 border-emerald-200"
                      }`}
                    >
                      {expired ? "expired" : w.status}
                    </span>
                  </div>
                );
              })
            )}
          </div>
        </section>
        </div>{/* end right col-span-2 */}
      </div>
    </div>
  );
}