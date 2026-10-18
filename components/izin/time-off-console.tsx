"use client";

import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { formatDateWib } from "@/lib/format";
import { canvasToWebp, captureSquareCanvas } from "@/lib/attendance";
import { createClient } from "@/lib/supabase/client";
import { Icon } from "@/components/ui/icon";

export type TimeOffRow = {
  id: string;
  type: "izin" | "cuti" | "sakit";
  startDate: string;
  endDate: string;
  reason: string;
  status: "pending" | "approved" | "rejected";
  requesterName: string;
  isOwn: boolean;
  proofPath: string | null;
  approverName: string | null;
  decidedAt: string | null;
  createdAt: string;
};

type Props = {
  requests: TimeOffRow[];
  canDecide: boolean;
  todayIso: string;
};

const TYPES = [
  { value: "izin", label: "Izin", icon: "schedule", hint: "Sebentar, masih masuk shift" },
  { value: "cuti", label: "Cuti", icon: "beach_access", hint: "Cuti tahunan" },
  { value: "sakit", label: "Sakit", icon: "healing", hint: "Perlu surat dokter" },
] as const;

type TypeValue = (typeof TYPES)[number]["value"];

const STATUS_META: Record<string, { label: string; cls: string; icon: string }> = {
  pending: { label: "Menunggu", cls: "bg-warning-surface text-warning-text", icon: "hourglass_top" },
  approved: { label: "Disetujui", cls: "bg-success-surface text-success-text", icon: "task_alt" },
  rejected: { label: "Ditolak", cls: "bg-danger-surface text-danger-text", icon: "cancel" },
  cancelled: { label: "Dibatalkan", cls: "bg-surface-container text-text-secondary", icon: "undo" },
};

function dayCount(start: string, end: string) {
  const ms = new Date(end).getTime() - new Date(start).getTime();
  return Math.floor(ms / 86400000) + 1;
}

export function TimeOffConsole({ requests, canDecide, todayIso }: Props) {
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [type, setType] = useState<TypeValue>("izin");
  const [startDate, setStartDate] = useState(todayIso);
  const [endDate, setEndDate] = useState(todayIso);
  const [reason, setReason] = useState("");
  const [cameraOpen, setCameraOpen] = useState(false);
  const [proofPreview, setProofPreview] = useState<string | null>(null);
  /**
   * Blob bukti yang sudah diambil. Disimpan sebagai blob, bukan path, karena
   * <video> di-unmount begitu preview tampil. Submit memakai blob ini, bukan
   * membaca ulang elemen video yang sudah tidak ada.
   */
  const [proofBlob, setProofBlob] = useState<Blob | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  // Maintainer dan Owner membuka halaman ini untuk memutuskan, bukan untuk
  // melihat pengajuan sendiri. Membuka tab "Milik Saya" untuk mereka hanya
  // menampilkan daftar kosong dan menyembunyikan antrean yang harus mereka tangani.
  const [filter, setFilter] = useState<"all" | "mine" | "pending">(
    canDecide ? "pending" : "mine",
  );

  const needsProof = type === "sakit";
  const duration = dayCount(startDate, endDate);
  const reasonLength = reason.trim().length;

  const validationError = (() => {
    if (!startDate || !endDate) return "Tanggal wajib diisi.";
    if (endDate < startDate)
      return "Tanggal selesai tidak boleh lebih awal dari tanggal mulai.";
    if (startDate < todayIso) return "Tanggal mulai tidak boleh di masa lalu.";
    if (duration > 90) return "Durasi maksimal 90 hari.";
    if (reasonLength < 10) return `Alasan minimal 10 karakter (${reasonLength}/10).`;
    if (needsProof && !proofBlob) return "Pengajuan sakit wajib melampirkan foto surat dokter.";
    return null;
  })();

  const closeCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setCameraOpen(false);
    setProofPreview(null);
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

  const captureProof = useCallback(async () => {
    setError(null);
    try {
      if (!videoRef.current) throw new Error("Kamera belum siap.");
      const blob = await canvasToWebp(captureSquareCanvas(videoRef.current, 1024), 0.82);
      setProofBlob(blob);
      setProofPreview(URL.createObjectURL(blob));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal mengambil foto.");
    }
  }, []);

  const submit = useCallback(async () => {
    setError(null);
    setSuccess(null);
    setBusy(true);

    try {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Sesi berakhir. Silakan masuk kembali.");

      let path: string | null = null;
      if (needsProof) {
        if (!proofBlob) throw new Error("Lampirkan foto surat dokter terlebih dahulu.");
        path = `${user.id}/${Date.now()}.webp`;
        const { error: upErr } = await supabase.storage
          .from("timeoff-proofs")
          .upload(path, proofBlob, { contentType: "image/webp", upsert: false });
        if (upErr) throw new Error(`Gagal mengunggah bukti: ${upErr.message}`);
      }

      const { error: rpcError } = await supabase.rpc("submit_time_off_request", {
        p_type: type,
        p_start_date: startDate,
        p_end_date: endDate,
        p_reason: reason.trim(),
        p_proof_path: path,
      });

      if (rpcError) {
        if (path) await supabase.storage.from("timeoff-proofs").remove([path]);
        throw new Error(rpcError.message);
      }

      setReason("");
      setProofBlob(null);
      closeCamera();
      setSuccess("Pengajuan terkirim dan menunggu peninjauan.");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal mengirim pengajuan.");
    } finally {
      setBusy(false);
    }
  }, [closeCamera, endDate, needsProof, proofBlob, reason, router, startDate, type]);

  async function decide(id: string, decision: "approved" | "rejected") {
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const supabase = createClient();
      const { error: rpcError } = await supabase.rpc("decide_time_off_request", {
        p_id: id,
        p_decision: decision,
      });
      if (rpcError) throw new Error(rpcError.message);

      setSuccess(
        decision === "approved"
          ? "Pengajuan disetujui. Pemohon sudah diberi tahu."
          : "Pengajuan ditolak. Pemohon sudah diberi tahu alasannya.",
      );
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal menyimpan keputusan.");
    } finally {
      setBusy(false);
    }
  }

  /**
   * Menarik pengajuan milik sendiri yang masih menunggu.
   *
   * Sebelumnya tidak ada jalur ini sama sekali. Halaman menampilkan kalimat
   * bahwa pengajuan hanya bisa dibatalkan oleh pemohon, tanpa memberi tombol
   * apa pun untuk melakukannya.
   */
  async function cancelOwn(id: string, ringkas: string) {
    if (busy) return;
    const ya = window.confirm(
      `Tarik pengajuan ${ringkas}? Pengajuan yang sudah ditarik tidak bisa dipulihkan.`,
    );
    if (!ya) return;

    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const supabase = createClient();
      const { error: rpcError } = await supabase.rpc("cancel_time_off_request", {
        p_id: id,
      });
      if (rpcError) throw new Error(rpcError.message);
      setSuccess("Pengajuan ditarik.");
      router.refresh();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Gagal menarik pengajuan.",
      );
    } finally {
      setBusy(false);
    }
  }

  const visible = requests.filter((row) => {
    if (filter === "mine") return row.isOwn;
    if (filter === "pending") return row.status === "pending";
    return true;
  });

  const pendingCount = requests.filter(
    (r) => r.status === "pending" && canDecide && !r.isOwn,
  ).length;

  /*
   * Saringan "Perlu Ditinjau" dan "Semua" hanya untuk yang berhak memutuskan.
   *
   * Admin kasir punya izin memutuskan secara historis, jadi
   * sebelumnya mereka melihat seluruh daftar pengajuan orang lain. Dari
   * daftar itu terbaca siapa yang sakit, siapa yang cuti, dan siapa yang
   * pengajuannya ditolak, dan itu bisa jadi perdebatan internal. Policy di
   * database sudah menutup hak bacanya; di sini saringannya ikut ditutup
   * supaya tidak ada tombol yang mengarah ke daftar kosong.
   */
  const FILTERS = canDecide
    ? ([
        { key: "mine", label: "Milik Saya" },
        { key: "pending", label: "Perlu Ditinjau" },
        { key: "all", label: "Semua" },
      ] as const)
    : ([{ key: "mine", label: "Milik Saya" }] as const);

  return (
    <div className="flex flex-col w-full min-h-screen">
      <div className="px-gutter pt-4 pb-6 flex flex-col gap-4">
        <section className="clay-card p-4 flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h1 className="font-headline-2 text-headline-2 text-text-primary">
              Pengajuan Izin
            </h1>
            <span className="px-2 py-0.5 rounded-full bg-brand-50 text-brand-600 font-micro-badge text-micro-badge">
              {TYPES.find((t) => t.value === type)?.label}
            </span>
          </div>

          <div className="grid grid-cols-3 gap-2">
            {TYPES.map((item) => {
              const active = type === item.value;
              return (
                <button
                  key={item.value}
                  type="button"
                  onClick={() => setType(item.value)}
                  aria-pressed={active}
                  className={`py-3 rounded-xl flex flex-col items-center gap-1 active:scale-95 transition-transform ${
                    active
                      ? "bg-primary text-white shadow-[0px_8px_16px_rgba(37,99,235,0.22)]"
                      : "bg-surface-container-low text-text-secondary"
                  }`}
                >
                  <Icon name={item.icon} className="text-[20px]" />
                  <span className="font-caption text-caption">{item.label}</span>
                </button>
              );
            })}
          </div>

          <p className="font-caption text-caption text-text-muted">
            {TYPES.find((t) => t.value === type)?.hint}
          </p>

          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1">
              <span className="font-caption text-caption text-text-muted">
                Tanggal mulai
              </span>
              <input
                type="date"
                value={startDate}
                min={todayIso}
                onChange={(e) => {
                  setStartDate(e.target.value);
                  if (e.target.value > endDate) setEndDate(e.target.value);
                }}
                className="h-12 px-3 rounded-xl bg-surface-container-low font-body text-body text-text-primary outline-none focus:ring-2 focus:ring-brand-400"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="font-caption text-caption text-text-muted">
                Tanggal selesai
              </span>
              <input
                type="date"
                value={endDate}
                min={startDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="h-12 px-3 rounded-xl bg-surface-container-low font-body text-body text-text-primary outline-none focus:ring-2 focus:ring-brand-400"
              />
            </label>
          </div>

          <div className="flex items-center justify-between rounded-xl bg-surface-container-low px-3 py-2">
            <span className="font-caption text-caption text-text-secondary">
              Total durasi
            </span>
            <span className="font-body-bold text-body-bold text-text-primary">
              {duration} hari
            </span>
          </div>

          <label className="flex flex-col gap-1">
            <span className="font-caption text-caption text-text-muted">Alasan</span>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              placeholder="Jelaskan alasan pengajuan (minimal 10 karakter)"
              className="rounded-xl bg-surface-container-low px-3 py-2 font-body text-body text-text-primary outline-none focus:ring-2 focus:ring-brand-400"
            />
            <span
              className={`font-micro-badge text-micro-badge self-end ${reasonLength < 10 ? "text-warning-text" : "text-text-muted"}`}
            >
              {reasonLength}/10 karakter
            </span>
          </label>

          {needsProof ? (
            <div className="flex flex-col gap-1">
              <span className="font-caption text-caption text-text-muted">
                Surat dokter (wajib)
              </span>
              {proofBlob ? (
                <div className="flex items-center justify-between rounded-xl bg-success-surface text-success-text px-3 py-2.5">
                  <span className="flex items-center gap-2 font-caption text-caption">
                    <Icon name="check_circle" className="text-[18px]" />
                    Bukti terlampir
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setProofBlob(null);
                      setProofPreview(null);
                    }}
                    className="font-micro-badge text-micro-badge font-semibold uppercase"
                  >
                    Ganti
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={openCamera}
                  className="h-12 rounded-xl bg-surface-container-low text-text-secondary font-caption text-caption flex items-center justify-center gap-2"
                >
                  <Icon name="photo_camera" className="text-[18px]" />
                  Ambil foto surat dokter
                </button>
              )}
            </div>
          ) : null}

          {validationError ? (
            <p className="font-caption text-caption text-warning-text">
              {validationError}
            </p>
          ) : null}
          {error ? (
            <p className="font-caption text-caption text-danger-text">{error}</p>
          ) : null}
          {success ? (
            <p className="font-caption text-caption text-success-text">
              {success}
            </p>
          ) : null}

          <button
            type="button"
            onClick={submit}
            disabled={busy || Boolean(validationError)}
            className="py-3.5 rounded-2xl primary-gradient text-on-primary font-body-bold text-body-bold flex items-center justify-center gap-2 active:scale-95 transition-transform disabled:opacity-50"
          >
            <Icon name="send" className="text-[20px]" />
            {busy ? "Mengirim..." : "Kirim Pengajuan"}
          </button>
        </section>

        <section className="clay-card p-4 flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h2 className="font-headline-2 text-headline-2 text-text-primary">
              Daftar Pengajuan
            </h2>
            {pendingCount > 0 ? (
              <span className="px-2 py-0.5 rounded-full bg-warning-surface text-warning-text font-micro-badge text-micro-badge">
                {pendingCount} perlu ditinjau
              </span>
            ) : null}
          </div>

          <div className="flex gap-2">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                type="button"
                onClick={() => setFilter(f.key)}
                // min-h-11 agar tinggi target sentuh mencapai 44px. Versi sebelumnya
                // py-1.5 hanya menghasilkan 28px, terlalu kecil untuk ibu jari.
                className={`px-3 min-h-11 rounded-xl font-caption text-caption flex items-center ${
                  filter === f.key
                    ? "bg-brand-50 text-brand-700"
                    : "bg-surface-container-low text-text-secondary"
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>

          {visible.length === 0 ? (
            <p className="py-6 text-center font-caption text-caption text-text-muted">
              Belum ada pengajuan pada daftar ini.
            </p>
          ) : (
            <div className="flex flex-col gap-3">
              {visible.map((row) => {
                const meta = STATUS_META[row.status];
                const typeMeta = TYPES.find((t) => t.value === row.type);
                const days = dayCount(row.startDate, row.endDate);

                return (
                  <div
                    key={row.id}
                    className="rounded-2xl bg-surface-container-low p-3 flex flex-col gap-2"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="flex items-center gap-1.5 font-body-bold text-body-bold text-text-primary">
                        <Icon name={typeMeta?.icon ?? "event_busy"} className="text-[18px] text-brand-600" />
                        {row.requesterName}
                      </span>
                      <span
                        className={`px-2 py-0.5 rounded-full font-micro-badge text-micro-badge uppercase flex items-center gap-1 ${meta.cls}`}
                      >
                        <Icon name={meta.icon} className="text-[13px]" />
                        {meta.label}
                      </span>
                    </div>

                    <p className="font-caption text-caption text-text-secondary">
                      {typeMeta?.label} - {formatDateWib(row.startDate)}
                      {row.endDate !== row.startDate
                        ? ` sampai ${formatDateWib(row.endDate)}`
                        : ""}{" "}
                      ({days} hari)
                    </p>

                    <p className="font-caption text-caption text-text-primary">
                      {row.reason}
                    </p>

                    {row.proofPath ? (
                      <ProofRow path={row.proofPath} canView={row.isOwn || canDecide} />
                    ) : null}

                    {row.approverName ? (
                      <p className="font-micro-badge text-micro-badge text-text-muted">
                        Diproses oleh {row.approverName}
                        {row.decidedAt ? ` pada ${formatDateWib(row.decidedAt)}` : ""}
                      </p>
                    ) : null}

                    {/*
                      Pemohon sendiri yang menarik pengajuannya. Tombol ini
                      berlaku untuk semua peran, bukan hanya yang punya hak
                      memutuskan; sebelumnya pesan yang muncul justru hanya
                      untuk yang punya hak memutuskan, dan tanpa tombol.
                    */}
                    {row.isOwn && row.status === "pending" ? (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          cancelOwn(
                            row.id,
                            `${row.type === "izin" ? "izin" : row.type} ${formatDateWib(row.startDate)}`,
                          )
                        }
                        className="w-full py-2.5 rounded-xl bg-surface-container text-text-secondary font-caption text-caption flex items-center justify-center gap-1.5 active:scale-95 transition-transform disabled:opacity-60"
                      >
                        <Icon name="undo" className="text-[16px]" />
                        Tarik Pengajuan
                      </button>
                    ) : null}

                    {canDecide && !row.isOwn && row.status === "pending" ? (
                      <div className="flex gap-2 pt-1">
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => decide(row.id, "approved")}
                          className="flex-1 py-2.5 rounded-xl bg-success-base text-white font-caption text-caption flex items-center justify-center gap-1 active:scale-95 transition-transform disabled:opacity-60"
                        >
                          <Icon name="task_alt" className="text-[16px]" />
                          Setujui
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => decide(row.id, "rejected")}
                          className="flex-1 py-2.5 rounded-xl bg-danger-surface text-danger-text font-caption text-caption flex items-center justify-center gap-1 active:scale-95 transition-transform disabled:opacity-60"
                        >
                          <Icon name="cancel" className="text-[16px]" />
                          Tolak
                        </button>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>

      {cameraOpen ? (
        <div className="fixed inset-0 z-[60] bg-black/85 flex flex-col items-center justify-center gap-3 p-gutter">
          {proofPreview ? (
            <img
              src={proofPreview}
              alt="Pratinjau surat dokter"
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
            {proofPreview ? (
              <button
                type="button"
                onClick={submit}
                disabled={busy}
                className="h-12 px-6 rounded-full bg-success-base text-white font-body-bold text-body-bold disabled:opacity-60"
              >
                {busy ? "Mengirim..." : "Kirim Pengajuan"}
              </button>
            ) : (
              <button
                type="button"
                onClick={captureProof}
                disabled={busy}
                aria-label="Ambil foto"
                className="h-14 w-14 rounded-full bg-brand-500 text-white flex items-center justify-center clay-glow disabled:opacity-60"
              >
                <Icon name="photo_camera" className="text-[28px]" />
              </button>
            )}
          </div>
        </div>
      ) : null}

      <div className="h-[76px]" />
    </div>
  );
}

function ProofRow({ path, canView }: { path: string; canView: boolean }) {
  const [failed, setFailed] = useState(false);

  async function open() {
    if (!canView) return;
    const supabase = createClient();
    const { data, error } = await supabase.storage
      .from("timeoff-proofs")
      .createSignedUrl(path, 120);
    if (error || !data?.signedUrl) {
      setFailed(true);
      return;
    }
    window.open(data.signedUrl, "_blank", "noopener");
  }

  return (
    <button
      type="button"
      onClick={open}
      disabled={!canView}
      className="self-start px-2 py-1 rounded-full bg-surface text-text-secondary font-micro-badge text-micro-badge flex items-center gap-1 disabled:opacity-60"
    >
      <Icon name={failed ? "error" : "attach_file"} className="text-[13px]" />
      {failed ? "Bukti tidak dapat dibuka" : "Lihat bukti"}
    </button>
  );
}