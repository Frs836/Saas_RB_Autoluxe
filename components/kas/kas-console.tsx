"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { formatRupiah, formatTimeWib } from "@/lib/format";
import { canvasToWebp, captureSquareCanvas } from "@/lib/attendance";
import { createClient } from "@/lib/supabase/client";

type PettyCashRow = {
  id: string;
  createdAt: string;
  amount: number;
  category: string;
  description: string | null;
  paymentMethod: string;
  proofPhotoUrl: string | null;
};

type Handoff = {
  id: string;
  opening: number;
  status: string;
  expected: number | null;
  actual: number | null;
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

const PAYMENT_OPTIONS = [
  { value: "cash", label: "Tunai" },
  { value: "qris", label: "QRIS" },
  { value: "bank_transfer", label: "Transfer" },
];

export function KasConsole({
  pettyCash,
  handoff,
  canManage,
  branchName,
}: {
  pettyCash: PettyCashRow[];
  handoff: Handoff | null;
  canManage: boolean;
  branchName: string;
}) {
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [form, setForm] = useState<FormState>({
    type: "out",
    amount: "",
    category: "Perlengkapan Wash",
    description: "",
    paymentMethod: "cash",
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [proofPath, setProofPath] = useState<string | null>(null);

  const totalOut = useMemo(
    () => pettyCash.reduce((sum, row) => sum + Number(row.amount || 0), 0),
    [pettyCash],
  );

  const needsProof = form.type === "out";
  const disabled = !canManage || loading;
  const handoffId = handoff?.id ?? null;

  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  const openCamera = useCallback(async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
        audio: false,
      });
      streamRef.current = stream;
      setCameraOpen(true);
      requestAnimationFrame(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          void videoRef.current.play();
        }
      });
    } catch {
      setError("Kamera tidak dapat dibuka. Pastikan izin kamera diberikan.");
    }
  }, []);

  const closeCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setCameraOpen(false);
  }, []);

  const captureProof = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      if (!videoRef.current) throw new Error("Kamera belum siap.");
      const canvas = captureSquareCanvas(videoRef.current, 1024);
      const blob = await canvasToWebp(canvas, 0.8);

      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Sesi berakhir. Silakan masuk kembali.");

      const path = `${user.id}/${Date.now()}.webp`;
      const { error: upErr } = await supabase.storage
        .from("cash-proofs")
        .upload(path, blob, { contentType: "image/webp", upsert: true });
      if (upErr) throw new Error(`Gagal mengunggah bukti: ${upErr.message}`);

      setProofPath(path);
      closeCamera();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal mengambil foto.");
    } finally {
      setLoading(false);
    }
  }, [closeCamera]);

  const onSubmit = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      setError(null);
      setSuccess(null);

      const amount = Number(form.amount.replace(/\D/g, ""));
      if (!amount || amount <= 0) {
        setError("Nominal harus lebih dari 0");
        return;
      }
      if (needsProof && !proofPath) {
        setError("Foto nota wajib dilampirkan untuk pengeluaran kas.");
        return;
      }

      setLoading(true);
      try {
        const supabase = createClient();
        const { error: rpcError } = await supabase.rpc("create_cash_transaction", {
          p_type: form.type,
          p_amount: amount,
          p_category: form.category,
          p_description: form.description.trim() || null,
          p_payment_method: form.paymentMethod,
          p_proof_photo_url: proofPath,
          p_shift_handoff_id: handoffId,
        });

        if (rpcError) {
          setError(rpcError.message);
          return;
        }

        setForm((prev) => ({
          ...prev,
          amount: "",
          description: "",
          category: prev.type === "out" ? "Perlengkapan Wash" : "Lainnya",
        }));
        setProofPath(null);
        setSuccess(
          form.type === "out"
            ? "Pengeluaran kas tercatat beserta bukti nota."
            : "Pemasukan kas tercatat.",
        );
        router.refresh();
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Terjadi kesalahan, coba lagi.",
        );
      } finally {
        setLoading(false);
      }
    },
    [form, handoffId, needsProof, proofPath, router],
  );

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
                    onClick={() => {
                      setForm((f) => ({ ...f, type: "out", category: "Perlengkapan Wash" }));
                      setProofPath(null);
                    }}
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
                    onClick={() => {
                      setForm((f) => ({ ...f, type: "in", category: "Lainnya" }));
                      setProofPath(null);
                    }}
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
                <label className="font-caption text-caption text-text-secondary">
                  Metode Pembayaran
                </label>
                <div className="grid grid-cols-3 gap-space-xs">
                  {PAYMENT_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() =>
                        setForm((f) => ({ ...f, paymentMethod: option.value }))
                      }
                      className={`h-11 rounded-xl font-caption text-caption transition-colors ${
                        form.paymentMethod === option.value
                          ? "bg-primary text-white shadow-[0px_8px_16px_rgba(37,99,235,0.25)]"
                          : "bg-surface-container-low text-text-secondary shadow-[inset_0px_2px_4px_rgba(255,255,255,0.95)]"
                      }`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex flex-col gap-space-xs">
                <label className="font-caption text-caption text-text-secondary">Nominal</label>
                <div className="relative flex items-center h-12 rounded-xl bg-surface shadow-[inset_0px_2px_4px_rgba(15,23,42,0.06)] px-3">
                  <span className="font-body-bold text-headline-2 text-primary-container pr-2">Rp</span>
                  <input
                    value={form.amount}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, amount: e.target.value.replace(/\D/g, "") }))
                    }
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

              {needsProof ? (
                <div className="flex flex-col gap-space-xs">
                  <label className="font-caption text-caption text-text-secondary">
                    Bukti Nota (wajib)
                  </label>
                  {proofPath ? (
                    <div className="flex items-center justify-between gap-2 rounded-xl bg-success-surface text-success-text px-3 py-2.5">
                      <span className="flex items-center gap-2 font-caption text-caption">
                        <span className="material-symbols-outlined text-[18px]">
                          check_circle
                        </span>
                        Foto nota terlampir
                      </span>
                      <button
                        type="button"
                        onClick={() => setProofPath(null)}
                        className="font-micro-badge text-micro-badge font-semibold uppercase"
                      >
                        Ganti
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={openCamera}
                      className="h-12 rounded-xl bg-surface-container-low text-text-secondary font-caption text-caption flex items-center justify-center gap-2 shadow-[inset_0px_2px_4px_rgba(255,255,255,0.95)]"
                    >
                      <span className="material-symbols-outlined text-[18px]">
                        photo_camera
                      </span>
                      Ambil foto nota
                    </button>
                  )}
                </div>
              ) : null}

              {error && <p className="font-caption text-caption text-danger-text">{error}</p>}
              {success && (
                <p className="font-caption text-caption text-success-text">{success}</p>
              )}

              <button
                type="submit"
                disabled={disabled}
                className="h-[50px] rounded-full bg-primary-gradient text-on-primary font-body-bold text-body-bold shadow-[0px_10px_22px_rgba(37,99,235,0.24)] disabled:opacity-60"
              >
                {loading ? "Menyimpan..." : "Simpan Transaksi"}
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
                    <p className="font-caption text-caption text-text-muted">
                      {formatTimeWib(row.createdAt)} WIB
                    </p>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>
      </div>

      {cameraOpen ? (
        <div className="fixed inset-0 z-[60] bg-black/80 flex flex-col items-center justify-center gap-4 p-gutter">
          <video
            ref={videoRef}
            playsInline
            muted
            className="w-full max-w-[420px] aspect-square object-cover rounded-3xl"
          />
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={closeCamera}
              className="h-12 px-5 rounded-full bg-white/15 text-white font-body-bold text-body-bold"
            >
              Batal
            </button>
            <button
              type="button"
              onClick={captureProof}
              disabled={loading}
              className="h-14 w-14 rounded-full bg-primary-gradient text-on-primary flex items-center justify-center clay-glow disabled:opacity-60"
              aria-label="Ambil foto"
            >
              <span className="material-symbols-outlined text-[28px]">photo_camera</span>
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}