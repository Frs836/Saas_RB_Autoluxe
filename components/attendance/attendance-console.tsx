"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { formatRupiah } from "@/lib/format";
import {
  ATTENDANCE_STATUS_LABELS,
  ATTENDANCE_STATUS_STYLE,
  canvasToWebp,
  captureSquareCanvas,
  cosineSimilarity,
  extractFaceDescriptor,
  formatDistance,
  formatDuration,
  haversineMeters,
  parseTimeToMinutes,
  wibNow,
  type WibNow,
} from "@/lib/attendance";

type TodayRow = {
  clockIn: string | null;
  clockOut: string | null;
  status: string;
  lateMinutes: number | null;
  lateReason: string | null;
};

type HistoryRow = {
  date: string;
  clockIn: string | null;
  clockOut: string | null;
  status: string;
  lateMinutes: number | null;
};

type GpsState = {
  status: "idle" | "loading" | "success" | "error";
  lat: number | null;
  lng: number | null;
  accuracy: number | null;
  error: string | null;
};

export function AttendanceConsole({
  profile,
  branch,
  today,
  history,
  canManageLocation,
  handoff,
  canAudit,
}: {
  profile: {
    id: string;
    fullName: string;
    role: string;
    roleLabel: string;
    hasFace: boolean;
    faceDescriptor: number[] | null;
  };
  branch: {
    id: string;
    name: string;
    latitude: number | null;
    longitude: number | null;
    radius: number;
    openTime: string;
    closeTime: string;
  };
  today: TodayRow | null;
  history: HistoryRow[];
  canManageLocation: boolean;
  handoff: { opening: number; status: string } | null;
  canAudit: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [cameraReady, setCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [capturedDataUrl, setCapturedDataUrl] = useState<string | null>(null);
  const [capturedBlob, setCapturedBlob] = useState<Blob | null>(null);
  const [capturedDescriptor, setCapturedDescriptor] = useState<number[] | null>(
    null,
  );

  const [gps, setGps] = useState<GpsState>({
    status: "idle",
    lat: null,
    lng: null,
    accuracy: null,
    error: null,
  });

  const [hasFace, setHasFace] = useState(profile.hasFace);
  const [faceDescriptor, setFaceDescriptor] = useState<number[] | null>(
    profile.faceDescriptor,
  );

  const [branchLat, setBranchLat] = useState(branch.latitude);
  const [branchLng, setBranchLng] = useState(branch.longitude);

  const [lateReason, setLateReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState<null | "capture" | "register" | "submit">(
    null,
  );
  const [showLocationSetup, setShowLocationSetup] = useState(false);
  const [clock, setClock] = useState<WibNow | null>(null);

  const mode: "checkin" | "checkout" | "done" = today?.clockOut
    ? "done"
    : today?.clockIn
      ? "checkout"
      : "checkin";

  const branchConfigured = branchLat !== null && branchLng !== null;

  const distance = useMemo(() => {
    if (!branchConfigured || gps.status !== "success") return null;
    if (gps.lat === null || gps.lng === null) return null;
    return haversineMeters(branchLat as number, branchLng as number, gps.lat, gps.lng);
  }, [branchConfigured, branchLat, branchLng, gps]);

  const insideRadius = distance !== null && distance <= branch.radius;

  const lateMinutes =
    mode === "checkin" && clock
      ? Math.max(0, clock.minutesOfDay - parseTimeToMinutes(branch.openTime))
      : 0;
  const isLate = lateMinutes > 0;
  const lateReasonValid = !isLate || lateReason.trim().length >= 5;

  const similarity = useMemo(() => {
    if (!hasFace || !faceDescriptor || !capturedDescriptor) return null;
    return cosineSimilarity(faceDescriptor, capturedDescriptor);
  }, [hasFace, faceDescriptor, capturedDescriptor]);

  const updateClock = useCallback(() => setClock(wibNow()), []);

  // Jam berjalan (WIB) - hanya aktif setelah mount agar tidak bentrok saat hidrasi
  useEffect(() => {
    const t = window.setTimeout(updateClock, 0);
    const id = window.setInterval(updateClock, 1000 * 30);
    return () => {
      window.clearTimeout(t);
      window.clearInterval(id);
    };
  }, [updateClock]);

  // Mulai kamera
  useEffect(() => {
    let cancelled = false;

    async function start() {
      if (!navigator.mediaDevices?.getUserMedia) {
        setCameraError("Peramban ini tidak mendukung akses kamera.");
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user", width: { ideal: 720 }, height: { ideal: 720 } },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => undefined);
        }
        setCameraReady(true);
        setCameraError(null);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setCameraError(`Kamera tidak dapat diakses: ${message}`);
      }
    }

    void start();

    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, []);

  const requestGps = useCallback(() => {
    if (!navigator.geolocation) {
      setGps({
        status: "error",
        lat: null,
        lng: null,
        accuracy: null,
        error: "Peramban ini tidak mendukung layanan lokasi.",
      });
      return;
    }
    setGps((prev) => ({ ...prev, status: "loading", error: null }));
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGps({
          status: "success",
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          error: null,
        });
      },
      (err) => {
        const map: Record<number, string> = {
          1: "Izin lokasi ditolak. Aktifkan akses lokasi untuk melanjutkan.",
          2: "Lokasi tidak tersedia. Coba di area terbuka.",
          3: "Waktu permintaan lokasi habis. Coba lagi.",
        };
        setGps({
          status: "error",
          lat: null,
          lng: null,
          accuracy: null,
          error: map[err.code] ?? "Gagal mengambil lokasi perangkat.",
        });
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    );
  }, []);

  useEffect(() => {
    const id = window.setTimeout(() => {
      requestGps();
    }, 0);
    return () => window.clearTimeout(id);
  }, [requestGps]);

  const handleCapture = useCallback(async () => {
    setError(null);
    setInfo(null);
    const video = videoRef.current;
    if (!video || !video.videoWidth) {
      setError("Kamera belum siap. Tunggu beberapa saat lalu coba lagi.");
      return;
    }
    try {
      setBusy("capture");
      const canvas = captureSquareCanvas(video, 512);
      const descriptor = extractFaceDescriptor(canvas, 512, 512, 16);
      const blob = await canvasToWebp(canvas, 0.82);
      setCapturedDataUrl(canvas.toDataURL("image/webp", 0.8));
      setCapturedBlob(blob);
      setCapturedDescriptor(descriptor);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal mengambil foto.");
    } finally {
      setBusy(null);
    }
  }, []);

  const handleRetake = useCallback(() => {
    setCapturedDataUrl(null);
    setCapturedBlob(null);
    setCapturedDescriptor(null);
    setError(null);
    setInfo(null);
  }, []);

  const uploadPhoto = useCallback(async (blob: Blob): Promise<string> => {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      throw new Error("Sesi berakhir. Silakan masuk kembali.");
    }
    const path = `${user.id}/${Date.now()}.webp`;
    const { error: upErr } = await supabase.storage
      .from("attendance-photos")
      .upload(path, blob, { contentType: "image/webp", upsert: true });
    if (upErr) {
      throw new Error(`Gagal mengunggah foto: ${upErr.message}`);
    }
    return path;
  }, []);

  const handleRegisterFace = useCallback(async () => {
    setError(null);
    setInfo(null);
    if (!capturedBlob || !capturedDescriptor) {
      setError("Ambil foto wajah terlebih dahulu sebelum mendaftarkan Face ID.");
      return;
    }
    try {
      setBusy("register");
      await uploadPhoto(capturedBlob);
      const supabase = createClient();
      const { error: rpcErr } = await supabase.rpc("set_face_descriptor", {
        p_descriptor: capturedDescriptor,
      });
      if (rpcErr) throw new Error(rpcErr.message);
      setHasFace(true);
      setFaceDescriptor(capturedDescriptor);
      setInfo("Sampel wajah berhasil didaftarkan. Face ID siap digunakan.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal mendaftarkan Face ID.");
    } finally {
      setBusy(null);
    }
  }, [capturedBlob, capturedDescriptor, uploadPhoto]);

  const handleSubmit = useCallback(async () => {
    setError(null);
    setInfo(null);
    if (!capturedBlob || !capturedDescriptor) {
      setError("Ambil foto selfie terlebih dahulu.");
      return;
    }
    if (gps.status !== "success" || gps.lat === null || gps.lng === null) {
      setError("Koordinat GPS belum tersedia. Perbarui lokasi perangkat.");
      return;
    }
    if (!branchConfigured) {
      setError(
        "Koordinat cabang belum dikonfigurasi. Hubungi owner atau maintainer.",
      );
      return;
    }
    if (!insideRadius) {
      setError(
        `Anda berada ${formatDistance(distance)} dari cabang, di luar radius ${Math.round(
          branch.radius,
        )} meter.`,
      );
      return;
    }
    if (mode === "checkin" && !lateReasonValid) {
      setError("Alasan keterlambatan wajib diisi minimal 5 karakter.");
      return;
    }

    try {
      setBusy("submit");
      const photoPath = await uploadPhoto(capturedBlob);
      const supabase = createClient();
      const faceScore =
        similarity === null ? null : Number(similarity.toFixed(4));

      if (mode === "checkin") {
        const { error: rpcErr } = await supabase.rpc("attendance_check_in", {
          p_latitude: gps.lat,
          p_longitude: gps.lng,
          p_accuracy_meters: gps.accuracy,
          p_photo_url: photoPath,
          p_face_similarity_score: faceScore,
          p_late_reason: isLate ? lateReason.trim() : null,
        });
        if (rpcErr) throw new Error(rpcErr.message);
        setInfo("Check-in berhasil dicatat.");
      } else {
        const { error: rpcErr } = await supabase.rpc("attendance_check_out", {
          p_latitude: gps.lat,
          p_longitude: gps.lng,
          p_accuracy_meters: gps.accuracy,
          p_photo_url: photoPath,
          p_face_similarity_score: faceScore,
        });
        if (rpcErr) throw new Error(rpcErr.message);
        setInfo("Check-out berhasil dicatat.");
      }

      window.location.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal mengirim data absensi.");
      setBusy(null);
    }
  }, [
    branch.radius,
    branchConfigured,
    capturedBlob,
    capturedDescriptor,
    distance,
    gps,
    insideRadius,
    isLate,
    lateReason,
    lateReasonValid,
    mode,
    similarity,
    uploadPhoto,
  ]);

  const handleSaveLocation = useCallback(async () => {
    setError(null);
    setInfo(null);
    if (gps.status !== "success" || gps.lat === null || gps.lng === null) {
      setError("Ambil lokasi GPS saat ini terlebih dahulu.");
      return;
    }
    try {
      setBusy("register");
      const supabase = createClient();
      const { data, error: rpcErr } = await supabase.rpc("set_branch_location", {
        p_latitude: gps.lat,
        p_longitude: gps.lng,
        p_radius_meters: branch.radius,
        p_branch_id: branch.id,
      });
      if (rpcErr) throw new Error(rpcErr.message);
      const row = Array.isArray(data) ? data[0] : data;
      setBranchLat(Number(row?.latitude ?? gps.lat));
      setBranchLng(Number(row?.longitude ?? gps.lng));
      setShowLocationSetup(false);
      setInfo("Lokasi cabang berhasil diperbarui.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal menyimpan lokasi cabang.");
    } finally {
      setBusy(null);
    }
  }, [branch.id, branch.radius, gps]);

  const gpsOverlayText = (() => {
    if (gps.status === "loading") return "Mendeteksi lokasi GPS...";
    if (gps.status === "error") return gps.error ?? "Lokasi tidak tersedia.";
    if (!branchConfigured) return "Koordinat cabang belum dikonfigurasi.";
    if (distance === null) return "Menghitung jarak ke cabang...";
    if (insideRadius) return `GPS Valid: ${formatDistance(distance)} dari titik cabang`;
    return `Di luar radius: ${formatDistance(distance)} dari cabang`;
  })();

  const gpsOverlayStyle =
    gps.status === "success" && insideRadius && branchConfigured
      ? "text-emerald-300"
      : gps.status === "error" || (distance !== null && !insideRadius)
        ? "text-rose-300"
        : "text-amber-200";

  const canSubmit =
    !!capturedBlob &&
    gps.status === "success" &&
    branchConfigured &&
    insideRadius &&
    (mode === "checkout" || lateReasonValid) &&
    mode !== "done";

  return (
    <div className="flex flex-col w-full pb-[calc(68px+env(safe-area-inset-bottom)+24px)]">
      {/* Ringkasan shift hari ini (owner / admin_kasir / maintainer) */}
      {canAudit ? (
        <section className="px-gutter pt-4">
          <div className="bg-surface rounded-[20px] p-4 clay-card border border-white/80">
            <div className="flex items-center justify-between gap-2 mb-2.5">
              <div className="flex items-center gap-2.5">
                <span className="w-9 h-9 rounded-xl bg-brand-50 text-brand-600 flex items-center justify-center shrink-0">
                  <span className="material-symbols-outlined text-[20px]">
                    payments
                  </span>
                </span>
                <div className="min-w-0">
                  <span className="font-body-bold text-body-bold text-text-primary block leading-tight">
                    Ringkasan Shift Hari Ini
                  </span>
                  <span className="font-caption text-caption text-text-muted block">
                    Kas titipan &amp; audit penutupan shift
                  </span>
                </div>
              </div>
              <span
                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-micro-badge text-micro-badge shrink-0 ${
                  handoff
                    ? handoff.status === "closed"
                      ? "bg-success-surface text-success-text"
                      : "bg-brand-50 text-brand-700"
                    : "bg-surface-container-low text-text-secondary"
                }`}
              >
                <span className="material-symbols-outlined text-[13px]">
                  {handoff
                    ? handoff.status === "closed"
                      ? "task_alt"
                      : "pending"
                    : "snooze"}
                </span>
                {handoff
                  ? handoff.status === "closed"
                    ? "Shift Ditutup"
                    : "Shift Berjalan"
                  : "Belum Buka"}
              </span>
            </div>
            <div className="bg-surface-container-low rounded-2xl px-3 py-2.5 flex items-center justify-between mb-2.5">
              <span className="font-caption text-caption text-text-secondary">
                Modal Kas Titipan
              </span>
              <span className="font-body-bold text-body-bold text-text-primary">
                {handoff ? formatRupiah(handoff.opening) : "Belum dibuka"}
              </span>
            </div>
            <div className="flex gap-2">
              <Link
                href="/shift"
                className="flex-1 h-10 rounded-xl primary-gradient text-white font-caption text-caption flex items-center justify-center gap-1.5 active:scale-95 transition-transform"
              >
                <span className="material-symbols-outlined text-[16px]">
                  {handoff && handoff.status === "open" ? "fact_check" : "login"}
                </span>
                {handoff && handoff.status === "open"
                  ? "Lanjutkan Audit"
                  : "Buka Kas Titipan"}
              </Link>
              <Link
                href="/rekap"
                className="flex-1 h-10 rounded-xl bg-surface-container-low text-text-secondary font-caption text-caption flex items-center justify-center gap-1.5 active:scale-95 transition-transform"
              >
                <span className="material-symbols-outlined text-[16px]">groups</span>
                Rekap
              </Link>
            </div>
          </div>
        </section>
      ) : null}

      {/* Kartu status hari ini */}
      {mode !== "checkin" ? (
        <section className="px-gutter pt-4">
          <div className="bg-surface rounded-[24px] p-5 clay-card border border-white/80 flex items-start gap-3">
            <div
              className={`w-11 h-11 rounded-2xl flex items-center justify-center shrink-0 ${
                mode === "done"
                  ? "bg-success-surface text-success-text"
                  : "bg-warning-surface text-warning-text"
              }`}
            >
              <span className="material-symbols-outlined text-[24px]">
                {mode === "done" ? "task_alt" : "schedule"}
              </span>
            </div>
            <div className="flex flex-col gap-1 min-w-0">
              <span className="font-headline-2 text-headline-2 text-text-primary">
                {mode === "done"
                  ? "Absensi hari ini selesai"
                  : "Sudah check-in, saatnya check-out"}
              </span>
              <span className="font-caption text-caption text-text-secondary">
                {mode === "done"
                  ? "Anda sudah menyelesaikan check-in dan check-out hari ini."
                  : "Sudah check-in hari ini. Ambil selfie untuk mencatat jam pulang."}
              </span>
              {today?.lateMinutes ? (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-warning-surface text-warning-text font-caption text-caption w-fit">
                  <span className="material-symbols-outlined text-[13px]">
                    running_with_errors
                  </span>
                  Terlambat {formatDuration(today.lateMinutes)}
                </span>
              ) : null}
            </div>
          </div>
        </section>
      ) : null}

      {/* Peringatan pendaftaran Face ID */}
      {!hasFace ? (
        <section className="px-gutter pt-4">
          <div className="bg-brand-50 border border-brand-100 rounded-[16px] p-3.5 flex items-start gap-2.5">
            <span className="material-symbols-outlined text-brand-600 text-[20px] mt-0.5">
              badge
            </span>
            <div className="flex flex-col gap-0.5">
              <span className="font-body-bold text-body-bold text-text-primary">
                Face ID belum terdaftar
              </span>
              <span className="font-caption text-caption text-text-secondary">
                Rekam sampel wajah Anda sekali agar absensi dapat diverifikasi.
              </span>
            </div>
          </div>
        </section>
      ) : null}

      {/* Lokasi cabang belum dikonfigurasi */}
      {!branchConfigured ? (
        <section className="px-gutter pt-4">
          <div className="bg-warning-surface rounded-[16px] p-3.5 flex flex-col gap-2.5">
            <div className="flex items-start gap-2.5">
              <span className="material-symbols-outlined text-warning-text text-[20px] mt-0.5">
                wrong_location
              </span>
              <div className="flex flex-col gap-0.5">
                <span className="font-body-bold text-body-bold text-warning-text">
                  Lokasi cabang belum diatur
                </span>
                <span className="font-caption text-caption text-warning-text/90">
                  Absensi memerlukan titik koordinat cabang. Owner atau maintainer
                  dapat mengaturnya dari perangkat di lokasi cabang.
                </span>
              </div>
            </div>
            {canManageLocation ? (
              <button
                type="button"
                onClick={() => setShowLocationSetup((v) => !v)}
                className="self-start h-9 px-3 rounded-xl bg-warning-base text-white font-caption text-caption flex items-center gap-1.5 active:scale-95 transition-transform"
              >
                <span className="material-symbols-outlined text-[16px]">
                  my_location
                </span>
                Atur Lokasi Cabang
              </button>
            ) : null}
          </div>
        </section>
      ) : canManageLocation && showLocationSetup ? null : canManageLocation ? (
        <section className="px-gutter pt-4">
          <button
            type="button"
            onClick={() => setShowLocationSetup(true)}
            className="w-full h-11 rounded-2xl bg-surface-container-low text-text-secondary font-caption text-caption flex items-center justify-center gap-1.5 active:scale-95 transition-transform"
          >
            <span className="material-symbols-outlined text-[16px]">
              edit_location_alt
            </span>
            Perbarui Lokasi Cabang
          </button>
        </section>
      ) : null}

      {canManageLocation && showLocationSetup ? (
        <section className="px-gutter pt-4">
          <div className="bg-surface rounded-[16px] p-3.5 clay-card flex flex-col gap-3">
            <span className="font-body-bold text-body-bold text-text-primary">
              Atur titik koordinat cabang
            </span>
            <div className="bg-surface-container-low rounded-xl p-2.5 font-mono text-[12px] text-text-secondary">
              {gps.status === "success"
                ? `${gps.lat?.toFixed(5)}, ${gps.lng?.toFixed(5)} (akurasi ${formatDistance(
                    gps.accuracy,
                  )})`
                : gpsOverlayText}
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={requestGps}
                className="flex-1 h-11 rounded-xl bg-surface-container-low text-text-secondary font-caption text-caption flex items-center justify-center gap-1.5 active:scale-95 transition-transform"
              >
                <span className="material-symbols-outlined text-[16px]">
                  refresh
                </span>
                Perbarui GPS
              </button>
              <button
                type="button"
                onClick={handleSaveLocation}
                disabled={busy !== null || gps.status !== "success"}
                className="flex-1 h-11 rounded-xl primary-gradient text-white font-caption text-caption flex items-center justify-center gap-1.5 active:scale-95 transition-transform disabled:opacity-60"
              >
                <span className="material-symbols-outlined text-[16px]">
                  save
                </span>
                Simpan Titik Ini
              </button>
            </div>
          </div>
        </section>
      ) : null}

      {/* Kartu kamera */}
      <section className="px-gutter pt-4">
        <div className="bg-surface rounded-[24px] p-4 sm:p-5 clay-card border border-white/80 inner-clay-highlight space-y-4">
          <div className="flex items-center justify-between px-1">
            <div className="flex items-center gap-2">
              <span className="p-1.5 rounded-lg bg-brand-50 text-brand-600">
                <span className="material-symbols-outlined text-[18px]">
                  photo_camera
                </span>
              </span>
              <span className="font-body-bold text-body-bold text-text-primary">
                Kamera Pemindai Wajah
              </span>
            </div>
            <span className="font-caption text-caption text-text-muted">
              {profile.fullName}
            </span>
          </div>

          <div className="w-full max-w-[360px] mx-auto aspect-square rounded-[20px] bg-[#0F172A] relative overflow-hidden shadow-inner border border-slate-800">
            {capturedDataUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={capturedDataUrl}
                alt="Pratinjau selfie absensi"
                className="w-full h-full object-cover"
              />
            ) : (
              <video
                ref={videoRef}
                playsInline
                muted
                className="w-full h-full object-cover -scale-x-100"
              />
            )}

            <div className="absolute top-3 left-3 bg-[#0F172A]/80 backdrop-blur-md px-2.5 py-1.5 rounded-full flex items-center gap-1.5 border border-white/10">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-[10px] font-bold tracking-wide uppercase text-white">
                {capturedDataUrl ? "Foto Terambil" : "Pratinjau Kamera"}
              </span>
            </div>

            <div className="absolute top-3 right-3 bg-[#0F172A]/75 backdrop-blur-md px-2 py-1 rounded-md text-[10px] font-mono text-brand-200 border border-brand-400/30">
              {similarity === null
                ? hasFace
                  ? "SAMPEL: -"
                  : "SAMPEL: BELUM ADA"
                : `KEMIRIPAN ${Math.round(similarity * 100)}%`}
            </div>

            {!capturedDataUrl ? (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none p-6">
                <div className="w-[185px] h-[245px] rounded-[50%] border-2 border-dashed border-brand-500 opacity-85 pulse-ring relative flex items-center justify-center">
                  <div className="absolute -top-1 -left-1 w-4 h-4 border-t-2 border-l-2 border-brand-400" />
                  <div className="absolute -top-1 -right-1 w-4 h-4 border-t-2 border-r-2 border-brand-400" />
                  <div className="absolute -bottom-1 -left-1 w-4 h-4 border-b-2 border-l-2 border-brand-400" />
                  <div className="absolute -bottom-1 -right-1 w-4 h-4 border-b-2 border-r-2 border-brand-400" />
                </div>
              </div>
            ) : null}

            <div className="absolute bottom-0 inset-x-0 bg-[#0F172A]/85 backdrop-blur-md px-3 py-2.5 text-white flex items-center justify-between border-t border-white/10">
              <div className="flex items-center gap-2 min-w-0">
                <div
                  className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 ${
                    insideRadius && branchConfigured
                      ? "bg-emerald-500/20 text-emerald-400"
                      : "bg-amber-500/20 text-amber-300"
                  }`}
                >
                  <span className="material-symbols-outlined text-[15px]">
                    location_on
                  </span>
                </div>
                <div className="truncate">
                  <p
                    className={`text-[12px] font-semibold leading-tight truncate ${gpsOverlayStyle}`}
                  >
                    {gpsOverlayText}
                  </p>
                  <p className="text-[10px] text-slate-300">
                    Radius toleransi max: {Math.round(branch.radius)} meter
                  </p>
                </div>
              </div>
              <span
                className={`px-2 py-0.5 rounded-full text-[10px] font-bold shrink-0 ${
                  insideRadius && branchConfigured
                    ? "bg-emerald-500/20 border border-emerald-400/40 text-emerald-300"
                    : "bg-amber-500/20 border border-amber-400/40 text-amber-200"
                }`}
              >
                {insideRadius && branchConfigured ? "TERVERIFIKASI" : "BELUM VALID"}
              </span>
            </div>
          </div>

          {/* Kontrol ambil foto */}
          <div className="flex items-center justify-center gap-3">
            {capturedDataUrl ? (
              <button
                type="button"
                onClick={handleRetake}
                disabled={busy !== null}
                className="h-11 px-5 rounded-full bg-surface-container-low text-text-secondary font-caption text-caption flex items-center gap-1.5 active:scale-95 transition-transform disabled:opacity-60"
              >
                <span className="material-symbols-outlined text-[18px]">
                  restart_alt
                </span>
                Ulangi Foto
              </button>
            ) : (
              <button
                type="button"
                onClick={handleCapture}
                disabled={!cameraReady || busy !== null}
                className="h-11 px-5 rounded-full primary-gradient text-white font-body-bold text-body-bold flex items-center gap-2 active:scale-95 transition-transform disabled:opacity-60"
              >
                <span className="material-symbols-outlined text-[18px]">
                  download
                </span>
                {busy === "capture" ? "Memproses..." : "Ambil Foto"}
              </button>
            )}
          </div>

          {cameraError ? (
            <p className="font-caption text-caption text-danger-text text-center">
              {cameraError}
            </p>
          ) : null}
        </div>
      </section>

      {/* Bar metadata GPS & waktu */}
      <section className="px-gutter pt-3">
        <div className="bg-clay-overlay rounded-xl p-2.5 flex items-center justify-between text-[11px] text-text-secondary border border-border-subtle">
          <div className="flex items-center gap-1 font-mono text-[11px] text-text-secondary">
            <span className="material-symbols-outlined text-[15px] text-brand-500">
              public
            </span>
            <span>
              {gps.lat !== null && gps.lng !== null
                ? `${gps.lat.toFixed(5)}, ${gps.lng.toFixed(5)}`
                : "--, --"}
            </span>
          </div>
          <span className="font-medium text-text-muted">
            {clock ? `${clock.dateLabel} • ${clock.timeLabel} WIB` : "--:-- WIB"}
          </span>
        </div>
      </section>

      {/* Kartu keterlambatan */}
      {mode === "checkin" ? (
        <section className="px-gutter pt-4">
          <div className="bg-brand-50 border border-brand-100 rounded-[16px] p-3.5 space-y-3">
            <div className="flex items-center justify-between pb-2.5 border-b border-brand-200/60">
              <div className="flex items-center gap-2 text-text-primary">
                <div className="w-7 h-7 rounded-lg bg-brand-500/10 text-brand-500 flex items-center justify-center shrink-0">
                  <span className="material-symbols-outlined text-[16px]">
                    schedule
                  </span>
                </div>
                <div>
                  <span className="font-body-bold text-body-bold text-text-primary block leading-none">
                    Jam Buka Resmi:{" "}
                    {branch.openTime.slice(0, 5)} WIB
                  </span>
                  <span className="font-caption text-caption text-text-secondary mt-0.5 block">
                    Batas toleransi check-in shift pagi
                  </span>
                </div>
              </div>
              <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-white text-brand-700 border border-brand-200">
                SOP
              </span>
            </div>

            {isLate ? (
              <>
                <div className="bg-warning-surface border border-amber-300/80 rounded-xl p-2.5 flex items-start gap-2.5">
                  <span className="material-symbols-outlined text-warning-text text-[18px] mt-0.5">
                    warning
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-body-bold text-body-bold text-warning-text leading-tight">
                        Status: Terlambat {formatDuration(lateMinutes)}
                      </span>
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-200/70 text-warning-text shrink-0">
                        {clock?.timeLabel ?? "--:--"} WIB
                      </span>
                    </div>
                    <p className="font-caption text-caption text-warning-text/90 mt-1">
                      Waktu check-in melebihi ambang batas resmi. Isi alasan
                      keterlambatan untuk melanjutkan.
                    </p>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label
                      htmlFor="late-reason"
                      className="font-body-bold text-body-bold text-text-primary flex items-center gap-1"
                    >
                      Alasan Keterlambatan
                      <span className="text-danger-text font-extrabold">*</span>
                      <span className="font-caption text-caption text-text-muted">
                        (Wajib, min. 5 karakter)
                      </span>
                    </label>
                    <span
                      className={`font-caption text-caption ${
                        lateReasonValid
                          ? "text-success-text"
                          : "text-text-muted"
                      }`}
                    >
                      {lateReason.trim().length} karakter
                    </span>
                  </div>
                  <textarea
                    id="late-reason"
                    rows={3}
                    value={lateReason}
                    onChange={(e) => setLateReason(e.target.value)}
                    placeholder="Tuliskan alasan keterlambatan secara jujur (minimal 5 karakter)..."
                    className="w-full h-20 p-3 bg-surface border border-border-strong rounded-xl font-body text-body text-text-primary placeholder:text-text-muted outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 resize-none"
                  />
                </div>
              </>
            ) : (
              <div className="bg-success-surface rounded-xl p-2.5 flex items-center gap-2.5">
                <span className="material-symbols-outlined text-success-text text-[18px]">
                  check_circle
                </span>
                <span className="font-caption text-caption text-success-text">
                  Anda check-in dalam batas toleransi waktu shift pagi.
                </span>
              </div>
            )}
          </div>
        </section>
      ) : null}

      {/* Aksi utama */}
      <section className="px-gutter pt-4 space-y-2.5">
        {!hasFace ? (
          <button
            type="button"
            onClick={handleRegisterFace}
            disabled={busy !== null || !capturedBlob}
            className="w-full h-[50px] rounded-full bg-surface border border-brand-200 text-brand-700 font-body-bold text-body-bold flex items-center justify-center gap-2.5 active:scale-[0.98] transition-all disabled:opacity-60"
          >
            <span className="material-symbols-outlined text-[22px]">
              face_retouching_natural
            </span>
            {busy === "register" ? "Mendaftarkan..." : "Daftarkan Face ID"}
          </button>
        ) : null}

        {mode !== "done" ? (
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!canSubmit || busy !== null}
            className="w-full h-[50px] rounded-full primary-gradient text-white font-bold text-[14px] flex items-center justify-center gap-2.5 clay-glow active:scale-[0.98] transition-all disabled:opacity-60"
          >
            <span className="material-symbols-outlined text-[22px]">
              {mode === "checkout" ? "logout" : "photo_camera"}
            </span>
            <span className="tracking-wide uppercase">
              {busy === "submit"
                ? "Mengirim..."
                : mode === "checkout"
                  ? "Kirim Check-Out (Face ID)"
                  : "Ambil Absen & Kirim Data (Face ID)"}
            </span>
          </button>
        ) : (
          <div className="w-full h-[50px] rounded-full bg-success-surface text-success-text font-body-bold text-body-bold flex items-center justify-center gap-2.5">
            <span className="material-symbols-outlined text-[22px]">
              verified
            </span>
            Absensi hari ini sudah lengkap
          </div>
        )}

        {error ? (
          <div className="p-3 rounded-xl bg-danger-surface text-danger-text font-body text-body flex items-center gap-2">
            <span className="material-symbols-outlined text-[18px]">error</span>
            <span className="flex-1">{error}</span>
          </div>
        ) : null}

        {info ? (
          <div className="p-3 rounded-xl bg-success-surface text-success-text font-body text-body flex items-center gap-2">
            <span className="material-symbols-outlined text-[18px]">
              check_circle
            </span>
            <span className="flex-1">{info}</span>
          </div>
        ) : null}

        <p className="font-caption text-caption text-text-muted leading-relaxed text-center px-2">
          Foto selfie dikompresi ke WebP sebelum diunggah, koordinat GPS,
          kemiripan sampel wajah, dan durasi keterlambatan tercatat langsung ke
          basis data absensi.
        </p>
      </section>

      {/* Riwayat kehadiran */}
      {history.length ? (
        <section className="px-gutter pt-4">
          <div className="bg-surface rounded-[20px] p-4 clay-card border border-white/80">
            <div className="flex items-center gap-2 mb-3">
              <span className="material-symbols-outlined text-brand-600 text-[18px]">
                history
              </span>
              <span className="font-body-bold text-body-bold text-text-primary">
                Riwayat Kehadiran
              </span>
            </div>
            <div className="flex flex-col divide-y divide-border-subtle">
              {history.map((row) => (
                <div
                  key={row.date}
                  className="flex items-center justify-between py-2.5"
                >
                  <div className="flex flex-col gap-0.5 min-w-0">
                    <span className="font-caption text-caption text-text-primary">
                      {new Intl.DateTimeFormat("id-ID", {
                        weekday: "long",
                        day: "numeric",
                        month: "short",
                      }).format(new Date(`${row.date}T00:00:00+07:00`))}
                    </span>
                    <span className="font-caption text-caption text-text-muted">
                      Masuk {row.clockIn ? "tercatat" : "-"} • Pulang{" "}
                      {row.clockOut ? "tercatat" : "-"}
                    </span>
                  </div>
                  <span
                    className={`px-2 py-0.5 rounded-full font-caption text-caption ${
                      ATTENDANCE_STATUS_STYLE[row.status] ??
                      "bg-surface-container-low text-text-secondary"
                    }`}
                  >
                    {ATTENDANCE_STATUS_LABELS[row.status] ?? row.status}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </section>
      ) : null}
    </div>
  );
}
