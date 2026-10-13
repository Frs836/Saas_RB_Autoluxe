"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { formatDateWib, todayWibIso } from "@/lib/format";
import { createClient } from "@/lib/supabase/client";

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
          p_proof_photo_url: null,
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
      <div className="pb-[calc(68px+env(safe-area-inset-bottom)+24px)] px-gutter pt-4 space-y-space-lg">
        <section className="clay-card flex flex-col gap-space-md p-space-lg">
          <div className="flex items-center justify-between">
            <h2 className="font-headline-2 text-headline-2 text-text-primary">Klaim Garansi</h2>
            <span className="px-2 py-0.5 rounded-full bg-brand-50 text-brand-600 font-micro-badge text-micro-badge">
              Berdasarkan Order Completed
            </span>
          </div>

          <form onSubmit={onSubmit} className="flex flex-col gap-space-md">
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
                  className="flex-1 h-11 px-3 rounded-xl bg-surface-container-low font-body-regular text-body-regular text-text-primary outline-none focus:ring-2 focus:ring-brand-400"
                />
                <button
                  type="submit"
                  className="h-11 px-4 rounded-xl bg-brand-50 text-brand-700 font-caption text-caption flex items-center gap-1 active:scale-95 transition-transform"
                >
                  <span className="material-symbols-outlined text-[16px]">search</span>
                  Cari
                </button>
              </form>
              {search ? (
                <button
                  type="button"
                  onClick={() => router.push("/garansi")}
                  className="self-start font-micro-badge text-micro-badge text-brand-700"
                >
                  Bersihkan pencarian
                </button>
              ) : null}
            </div>

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
                className="h-12 rounded-xl bg-surface px-3 font-body-regular text-body-regular text-text-primary shadow-[inset_0px_2px_4px_rgba(15,23,42,0.06)]"
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
              <div className="rounded-xl bg-surface-container-low px-3 py-2.5 flex flex-col gap-1">
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
                className="rounded-xl bg-surface px-3 py-2 font-body-regular text-body-regular text-text-primary shadow-[inset_0px_2px_4px_rgba(15,23,42,0.06)]"
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
              className="h-[50px] rounded-full bg-primary-gradient text-on-primary font-body-bold text-body-bold shadow-[0px_10px_22px_rgba(37,99,235,0.24)] disabled:opacity-60"
            >
              {loading ? "Mengirim..." : "Ajukan Klaim Garansi"}
            </button>
          </form>
        </section>

        <section className="clay-card flex flex-col gap-space-md p-space-lg">
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
                  className="flex flex-col gap-space-xs py-3 border-b border-border-subtle last:border-b-0"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-body-bold text-body-bold text-text-primary">
                      {orders.find((o) => o.id === claim.orderId)?.orderNumber ??
                        claim.orderId.slice(0, 8)}
                    </span>
                    <span
                      className={`self-start px-2 py-0.5 rounded-full font-micro-badge text-micro-badge uppercase ${CLAIM_STATUS_STYLE[claim.status] ?? "bg-surface-container text-text-secondary"}`}
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

        <section className="clay-card flex flex-col gap-space-md p-space-lg">
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
                    className="flex flex-col gap-space-xs py-3 border-b border-border-subtle last:border-b-0"
                  >
                    <p className="font-body-bold text-body-bold text-text-primary">
                      {w.warrantyCode}
                    </p>
                    <div className="flex items-center justify-between font-caption text-caption text-text-muted">
                      <span>Mulai: {formatDateWib(w.startDate)}</span>
                      <span>Berakhir: {formatDateWib(w.endDate)}</span>
                    </div>
                    <span
                      className={`self-start px-2 py-0.5 rounded-full font-micro-badge text-micro-badge uppercase ${
                        expired
                          ? "bg-danger-surface text-danger-text"
                          : "bg-success-surface text-success-text"
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
      </div>
    </div>
  );
}