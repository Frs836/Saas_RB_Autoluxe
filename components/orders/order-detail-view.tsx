"use client";

import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { formatDateWib, formatRupiah, formatTimeWib } from "@/lib/format";
import { canvasToWebp, captureSquareCanvas } from "@/lib/attendance";
import { createClient } from "@/lib/supabase/client";
import { PAYMENT_LABELS } from "@/lib/pos";

export type InspectionPhoto = {
  id: string;
  phase: "before" | "process" | "after";
  photoPath: string;
  notes: string | null;
  inspectorId: string | null;
  inspectorName: string;
  createdAt: string;
};

export type OrderDetailOrder = {
  id: string;
  orderNumber: string;
  licensePlate: string;
  vehicleModel: string;
  vehicleSize: string;
  customerName: string;
  customerPhone: string | null;
  servicePackage: string;
  status: string;
  totalPrice: number;
  paymentMethod: string | null;
  paymentState: string | null;
  trackingToken: string;
  createdAt: string;
  completedAt: string | null;
  cancellationReason: string | null;
  createdByName: string;
  items: { name: string; price: number; quantity: number }[];
  team: { id: string; full_name: string; is_lead: boolean }[];
};

export type OrderDetailWarranty = {
  warrantyCode: string;
  startDate: string;
  endDate: string;
  status: string;
};

type Props = {
  order: OrderDetailOrder;
  inspections: InspectionPhoto[];
  warranty: OrderDetailWarranty | null;
  origin: string;
  canUpload: boolean;
  canDecideQc: boolean;
  canDeleteAny: boolean;
  viewerId: string;
  branchName: string;
};

const PHASES = [
  { key: "before", label: "Kondisi Awal", short: "Before", icon: "photo_camera" },
  { key: "process", label: "Proses Pengerjaan", short: "Proses", icon: "handyman" },
  { key: "after", label: "Hasil Akhir", short: "After", icon: "verified" },
] as const;

type PhaseKey = (typeof PHASES)[number]["key"];

const STATUS_META: Record<string, { label: string; cls: string; step: number }> = {
  queued: { label: "Dalam Antrean", cls: "bg-surface-container text-text-secondary", step: 0 },
  in_progress: { label: "Sedang Dikerjakan", cls: "bg-brand-50 text-brand-700", step: 1 },
  qc_review: { label: "Menunggu QC", cls: "bg-warning-surface text-warning-text", step: 2 },
  completed: { label: "Selesai", cls: "bg-success-surface text-success-text", step: 3 },
  cancelled: { label: "Dibatalkan", cls: "bg-danger-surface text-danger-text", step: -1 },
};

const STORAGE_PUBLIC_BASE = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/inspection-photos`;

export function OrderDetailView({
  order,
  inspections,
  warranty,
  origin,
  canUpload,
  canDecideQc,
  canDeleteAny,
  viewerId,
  branchName,
}: Props) {
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [phase, setPhase] = useState<PhaseKey>("before");
  const [notes, setNotes] = useState("");
  const [cameraOpen, setCameraOpen] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [brokenImages, setBrokenImages] = useState<Record<string, boolean>>({});

  const meta = STATUS_META[order.status] ?? STATUS_META.queued;
  const trackUrl = `${origin.replace(/\/$/, "")}/track/${order.trackingToken}`;

  const photoUrl = (path: string) =>
    path.startsWith("http") ? path : `${STORAGE_PUBLIC_BASE}/${path}`;

  const hasBefore = inspections.some((i) => i.phase === "before");

  const grouped = PHASES.map((p) => ({
    ...p,
    photos: inspections
      .filter((i) => i.phase === p.key)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
  }));

  const closeCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setCameraOpen(false);
    setPreview(null);
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

  const capture = useCallback(async () => {
    setError(null);
    try {
      if (!videoRef.current) throw new Error("Kamera belum siap.");
      const blob = await canvasToWebp(captureSquareCanvas(videoRef.current, 1024), 0.8);
      setPreview(URL.createObjectURL(blob));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal mengambil foto.");
    }
  }, []);

  const submitInspection = useCallback(async () => {
    setError(null);
    setSuccess(null);
    if (notes.trim().length < 5) {
      setError("Catatan kondisi kendaraan minimal 5 karakter.");
      return;
    }

    setBusy(true);
    try {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Sesi berakhir. Silakan masuk kembali.");

      const canvas = videoRef.current;
      const blob = await canvasToWebp(captureSquareCanvas(canvas as HTMLVideoElement, 1024), 0.8);

      // Path memuat tracking_token supaya bucket publik tidak bisa ditebak
      // tanpa mengetahui token order tersebut.
      const path = `${user.id}/${order.id}/${order.trackingToken}-${phase}-${Date.now()}.webp`;
      const { error: upErr } = await supabase.storage
        .from("inspection-photos")
        .upload(path, blob, { contentType: "image/webp", upsert: false });
      if (upErr) throw new Error(`Gagal mengunggah foto: ${upErr.message}`);

      const { error: rpcError } = await supabase.rpc("add_order_inspection", {
        p_order_id: order.id,
        p_phase: phase,
        p_photo_path: path,
        p_notes: notes.trim(),
      });
      if (rpcError) {
        await supabase.storage.from("inspection-photos").remove([path]);
        throw new Error(rpcError.message);
      }

      setNotes("");
      closeCamera();
      setSuccess("Foto inspeksi tersimpan.");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal menyimpan inspeksi.");
    } finally {
      setBusy(false);
    }
  }, [closeCamera, notes, order.id, order.trackingToken, phase, router]);

  async function changeStatus(next: string) {
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const supabase = createClient();
      const { data, error: rpcError } = await supabase.rpc("apply_order_status", {
        p_order_id: order.id,
        p_status: next,
      });
      if (rpcError) throw new Error(rpcError.message);

      const warrantyCode = typeof data === "string" ? data : null;
      setSuccess(
        next === "completed"
          ? warrantyCode
            ? `QC disetujui. Sertifikat garansi ${warrantyCode} terbit.`
            : "QC disetujui. Layanan ini tidak mendukung garansi."
          : next === "in_progress"
            ? "Order dikembalikan ke teknisi untuk dikerjakan ulang."
            : "Status order diperbarui.",
      );
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal mengubah status.");
    } finally {
      setBusy(false);
    }
  }

  async function deletePhoto(id: string) {
    setBusy(true);
    setError(null);
    try {
      const supabase = createClient();
      const { error: rpcError } = await supabase.rpc("delete_order_inspection", {
        p_inspection_id: id,
      });
      if (rpcError) throw new Error(rpcError.message);
      setSuccess("Foto dihapus.");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal menghapus foto.");
    } finally {
      setBusy(false);
    }
  }

  const primaryActions: { label: string; icon: string; status: string; cls: string }[] = [];
  if (order.status === "queued" && canUpload) {
    primaryActions.push({
      label: "Mulai Pengerjaan",
      icon: "play_arrow",
      status: "in_progress",
      cls: "bg-primary text-white",
    });
  }
  if (order.status === "in_progress" && canUpload) {
    primaryActions.push({
      label: "Ajukan QC",
      icon: "fact_check",
      status: "qc_review",
      cls: "bg-primary text-white",
    });
  }
  if (order.status === "qc_review" && canDecideQc) {
    primaryActions.push({
      label: "Setujui QC",
      icon: "verified",
      status: "completed",
      cls: "bg-success-base text-white",
    });
    primaryActions.push({
      label: "Kembalikan",
      icon: "replay",
      status: "in_progress",
      cls: "bg-warning-surface text-warning-text",
    });
  }

  return (
    <div className="flex flex-col w-full min-h-screen">
      <div className="sticky top-0 z-40 bg-surface/90 backdrop-blur-md pt-safe shadow-[0_1px_8px_rgba(0,0,0,0.04)]">
        <div className="h-16 px-gutter flex items-center gap-3">
          <button
            type="button"
            onClick={() => router.back()}
            aria-label="Kembali ke antrean"
            className="w-10 h-10 rounded-xl bg-surface-container-low flex items-center justify-center text-text-secondary active:scale-95 transition-transform"
          >
            <span className="material-symbols-outlined text-[22px]">arrow_back</span>
          </button>
          <div className="flex flex-col min-w-0">
            <span className="font-headline-2 text-headline-2 text-text-primary font-mono">
              {order.orderNumber}
            </span>
            <span className="font-caption text-caption text-text-muted truncate">
              {branchName}
            </span>
          </div>
          <span
            className={`ml-auto px-2.5 py-1 rounded-full font-caption text-caption ${meta.cls}`}
          >
            {meta.label}
          </span>
        </div>
      </div>

      <div className="px-gutter pt-4 pb-32 flex flex-col gap-4">
        <section className="clay-card p-4 flex flex-col gap-3">
          <div className="flex items-start gap-3">
            <div className="w-12 h-12 rounded-xl bg-surface-container flex items-center justify-center shrink-0 text-brand-600">
              <span className="material-symbols-outlined text-[26px]">
                {order.vehicleSize === "Motor" ? "two_wheeler" : "directions_car"}
              </span>
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <h1 className="font-headline-2 text-headline-2 text-text-primary truncate">
                  {order.vehicleModel}
                </h1>
                <span className="font-micro-badge text-micro-badge px-2 py-0.5 rounded bg-surface-container-high text-text-secondary font-mono shrink-0">
                  {order.licensePlate}
                </span>
              </div>
              <p className="font-caption text-caption text-brand-600 mt-0.5 truncate">
                {order.servicePackage}
              </p>
              <p className="font-caption text-caption text-text-muted mt-0.5 truncate">
                {order.customerName}
                {order.customerPhone ? ` - ${order.customerPhone}` : ""}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xl bg-surface-container-low px-3 py-2.5">
              <p className="font-caption text-caption text-text-muted">Total</p>
              <p className="font-headline-2 text-headline-2 text-primary">
                {formatRupiah(order.totalPrice)}
              </p>
            </div>
            <div className="rounded-xl bg-surface-container-low px-3 py-2.5">
              <p className="font-caption text-caption text-text-muted">Pembayaran</p>
              <p className="font-body-bold text-body-bold text-text-primary">
                {order.paymentState === "unpaid"
                  ? "Belum dibayar"
                  : (PAYMENT_LABELS[order.paymentMethod ?? ""] ?? "-")}
              </p>
            </div>
          </div>

          {order.items.length > 0 ? (
            <div className="flex flex-col gap-1.5 pt-1">
              {order.items.map((item) => (
                <div
                  key={item.name}
                  className="flex items-center justify-between font-body text-body"
                >
                  <span className="text-text-secondary truncate">
                    {item.quantity}x {item.name}
                  </span>
                  <span className="text-text-primary font-body-bold shrink-0">
                    {formatRupiah(item.price * item.quantity)}
                  </span>
                </div>
              ))}
            </div>
          ) : null}

          <div className="flex flex-wrap gap-2 pt-1">
            {order.team.length > 0 ? (
              <span className="px-2 py-1 rounded-full bg-surface-container text-text-secondary font-caption text-caption">
                Tim: {order.team.map((m) => m.full_name).join(", ")}
              </span>
            ) : (
              <span className="px-2 py-1 rounded-full bg-surface-container text-text-secondary font-caption text-caption">
                Belum ada teknisi
              </span>
            )}
            <span className="px-2 py-1 rounded-full bg-surface-container text-text-secondary font-caption text-caption">
              Dibuat {formatDateWib(order.createdAt)} {formatTimeWib(order.createdAt)}
            </span>
          </div>

          <a
            href={trackUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="self-start px-3 py-2 rounded-xl bg-brand-50 text-brand-700 font-caption text-caption flex items-center gap-1"
          >
            <span className="material-symbols-outlined text-[16px]">link</span>
            Buka halaman lacak pelanggan
          </a>

          {order.cancellationReason ? (
            <p className="font-caption text-caption text-danger-text">
              Alasan pembatalan: {order.cancellationReason}
            </p>
          ) : null}
        </section>

        <section className="clay-card p-4 flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h2 className="font-headline-2 text-headline-2 text-text-primary">
              Inspeksi &amp; Sertifikat
            </h2>
            <span className="font-caption text-caption text-text-muted">
              {inspections.length} foto
            </span>
          </div>

          {warranty ? (
            <div className="rounded-xl bg-success-surface text-success-text px-3 py-2.5 flex flex-col gap-0.5">
              <div className="flex items-center gap-1.5">
                <span className="material-symbols-outlined text-[18px]">verified</span>
                <span className="font-body-bold text-body-bold">
                  {warranty.warrantyCode}
                </span>
              </div>
              <span className="font-caption text-caption">
                Berlaku {formatDateWib(warranty.startDate)} sampai{" "}
                {formatDateWib(warranty.endDate)}
              </span>
            </div>
          ) : null}

          <div className="flex gap-2">
            {PHASES.map((p) => {
              const count = inspections.filter((i) => i.phase === p.key).length;
              return (
                <div
                  key={p.key}
                  className="flex-1 rounded-xl bg-surface-container-low px-2 py-2 text-center"
                >
                  <p className="font-micro-badge text-micro-badge text-text-muted uppercase">
                    {p.short}
                  </p>
                  <p className="font-headline-1 text-headline-1 text-text-primary">
                    {count}
                  </p>
                </div>
              );
            })}
          </div>

          {grouped.map((group) => (
            <div key={group.key} className="flex flex-col gap-2">
              <div className="flex items-center gap-1.5">
                <span className="material-symbols-outlined text-[16px] text-brand-600">
                  {group.icon}
                </span>
                <span className="font-caption text-caption font-semibold text-text-primary">
                  {group.label}
                </span>
                {!hasBefore && group.key === "after" ? (
                  <span className="font-micro-badge text-micro-badge text-warning-text">
                    perlu foto awal dulu
                  </span>
                ) : null}
              </div>

              {group.photos.length === 0 ? (
                <p className="font-caption text-caption text-text-muted pl-1">
                  Belum ada foto pada tahap ini.
                </p>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  {group.photos.map((photo) => (
                    <div
                      key={photo.id}
                      className="rounded-2xl overflow-hidden bg-surface-container"
                    >
                      {brokenImages[photo.id] ? (
                        <div className="aspect-[4/3] flex flex-col items-center justify-center gap-1 text-text-muted">
                          <span className="material-symbols-outlined text-[22px]">
                            broken_image
                          </span>
                          <span className="font-micro-badge text-micro-badge text-center px-2">
                            Foto tidak tersedia
                          </span>
                        </div>
                      ) : (
                        <img
                          src={photoUrl(photo.photoPath)}
                          alt={`${group.label} - ${photo.notes ?? order.licensePlate}`}
                          onError={() =>
                            setBrokenImages((prev) => ({ ...prev, [photo.id]: true }))
                          }
                          className="aspect-[4/3] w-full object-cover"
                          loading="lazy"
                        />
                      )}
                      <div className="px-2 py-1.5 bg-surface">
                        <p className="font-caption text-caption text-text-secondary line-clamp-2">
                          {photo.notes ?? "-"}
                        </p>
                        <div className="flex items-center justify-between gap-1 mt-0.5">
                          <span className="font-micro-badge text-micro-badge text-text-muted truncate">
                            {photo.inspectorName}
                          </span>
                          {(canDeleteAny || photo.inspectorId === viewerId) &&
                          order.status !== "completed" ? (
                            <button
                              type="button"
                              onClick={() => deletePhoto(photo.id)}
                              disabled={busy}
                              aria-label="Hapus foto"
                              className="text-danger-text disabled:opacity-50"
                            >
                              <span className="material-symbols-outlined text-[15px]">
                                delete
                              </span>
                            </button>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </section>
      </div>

      {primaryActions.length > 0 || canUpload ? (
        <div className="fixed bottom-0 left-0 right-0 z-40 px-gutter pb-3 pt-3 bg-surface/95 backdrop-blur-md border-t border-outline-variant">
          {error ? (
            <p className="mb-2 p-2 rounded-xl bg-danger-surface text-danger-text font-caption text-caption">
              {error}
            </p>
          ) : null}
          {success ? (
            <p className="mb-2 p-2 rounded-xl bg-success-surface text-success-text font-caption text-caption">
              {success}
            </p>
          ) : null}

          {primaryActions.length > 0 ? (
            <div className="flex gap-2 mb-2">
              {primaryActions.map((action) => (
                <button
                  key={action.status}
                  type="button"
                  disabled={busy}
                  onClick={() => changeStatus(action.status)}
                  className={`flex-1 py-3 rounded-2xl font-body-bold text-body-bold flex items-center justify-center gap-1.5 active:scale-95 transition-transform disabled:opacity-60 ${action.cls}`}
                >
                  <span className="material-symbols-outlined text-[18px]">
                    {action.icon}
                  </span>
                  {action.label}
                </button>
              ))}
            </div>
          ) : null}

          {canUpload && !cameraOpen ? (
            <button
              type="button"
              onClick={openCamera}
              className="w-full py-3.5 rounded-2xl bg-primary-gradient text-on-primary font-body-bold text-body-bold flex items-center justify-center gap-2 active:scale-95 transition-transform"
            >
              <span className="material-symbols-outlined text-[20px]">add_a_photo</span>
              Tambah Foto Inspeksi
            </button>
          ) : null}
        </div>
      ) : null}

      {cameraOpen ? (
        <div className="fixed inset-0 z-[60] bg-black/85 flex flex-col items-center justify-center gap-3 p-gutter">
          <div className="flex gap-2 w-full max-w-[420px]">
            {PHASES.map((p) => (
              <button
                key={p.key}
                type="button"
                onClick={() => setPhase(p.key)}
                disabled={p.key === "after" && !hasBefore}
                className={`flex-1 py-2 rounded-xl font-caption text-caption flex items-center justify-center gap-1 disabled:opacity-40 ${
                  phase === p.key
                    ? "bg-brand-500 text-white"
                    : "bg-white/15 text-white/80"
                }`}
              >
                {p.short}
              </button>
            ))}
          </div>

          <label className="w-full max-w-[420px]">
            <span className="sr-only">Catatan kondisi kendaraan</span>
            <input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Catatan kondisi kendaraan (minimal 5 karakter)"
              className="w-full h-12 px-3 rounded-xl bg-white/10 text-white font-body text-body outline-none placeholder:text-white/50"
            />
          </label>

          {preview ? (
            <img
              src={preview}
              alt="Pratinjau foto inspeksi"
              className="w-full max-w-[420px] aspect-square object-cover rounded-3xl"
            />
          ) : (
            <video
              ref={videoRef}
              playsInline
              muted
              className="w-full max-w-[420px] aspect-square object-cover rounded-3xl"
            />
          )}

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={closeCamera}
              className="h-12 px-5 rounded-full bg-white/15 text-white font-body-bold text-body-bold"
            >
              Batal
            </button>
            {preview ? (
              <button
                type="button"
                onClick={submitInspection}
                disabled={busy}
                className="h-12 px-6 rounded-full bg-success-base text-white font-body-bold text-body-bold disabled:opacity-60"
              >
                {busy ? "Menyimpan..." : "Simpan Foto"}
              </button>
            ) : (
              <button
                type="button"
                onClick={capture}
                disabled={busy}
                aria-label="Ambil foto"
                className="h-14 w-14 rounded-full bg-brand-500 text-white flex items-center justify-center clay-glow disabled:opacity-60"
              >
                <span className="material-symbols-outlined text-[28px]">photo_camera</span>
              </button>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}