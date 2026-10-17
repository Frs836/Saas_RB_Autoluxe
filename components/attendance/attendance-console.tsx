"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { formatRupiah } from "@/lib/format";
import { SyaratBelumTerpenuhi, type Syarat } from "@/components/submit-requirements";
import {
  LABEL_TAHAP,
  URUTAN_TAHAP,
  LivenessSession,
  detectFaceInVideo,
  warmUpFaceEngine,
  type Tahap,
} from "@/lib/face";
import {
  ATTENDANCE_STATUS_LABELS,
  ATTENDANCE_STATUS_STYLE,
  canvasToWebp,
  captureSquareCanvas,
  cosineSimilarity,
  formatDistance,
  formatDuration,
  haversineMeters,
  parseTimeToMinutes,
  wibNow,
  type WibNow,
} from "@/lib/attendance";
import { Icon } from "@/components/ui/icon";

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
    /**
     * Status verifikasi wajah master oleh maintainer. null berarti sampel wajah
     * belum pernah didaftarkan.
     */
    faceStatus?: "pending" | "approved" | "rejected" | null;
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
  /*
   * Kamera dan mesin pemindai hanya dinyalakan setelah staf menekan tombol.
   *
   * Sebelumnya keduanya langsung nyala begitu halaman dibuka. Akibatnya
   * setiap kunjungan ke /absensi mengunduh 16 MB mesin MediaPipe dan langsung
   * meminta izin kamera, bahkan ketika staf hanya ingin melihat jam masuk
   * atau riwayat kehadiran. Halaman ikut tertahan lebih dari 3 detik.
   *
   * Sekarang halaman tampil cepat, dan berkas besar hanya diambil ketika
   * pemindaian benar-benar akan dilakukan.
   */
  const [scanDiminta, setScanDiminta] = useState(false);
  const [mesinSiap, setMesinSiap] = useState(false);
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
  const faceStatus = profile.faceStatus ?? null;
  const [faceDescriptor, setFaceDescriptor] = useState<number[] | null>(
    profile.faceDescriptor,
  );

  // Tantangan liveness bertahap. Jejak setiap tahap dikirim ke server untuk
  // diperiksa ulang di sana, bukan hanya klaim benar atau salah dari klien.
  const liveRef = useRef(LivenessSession.baru());
  const [liveSelesai, setLiveSelesai] = useState(false);
  const [liveTahap, setLiveTahap] = useState<Tahap | null>("center");
  const [liveTerpenuhi, setLiveTerpenuhi] = useState<Tahap[]>([]);
  const [eyeBlink, setEyeBlink] = useState(0);
  const [jawOpen, setJawOpen] = useState(0);
  const [yaw, setYaw] = useState(0);

  const [branchLat, setBranchLat] = useState(branch.latitude);
  const [branchLng, setBranchLng] = useState(branch.longitude);

  const [lateReason, setLateReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const router = useRouter();
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

  // Kamera hanya dinyalakan setelah staf menekan tombol Mulai Pindai.
  useEffect(() => {
    if (!scanDiminta) return;
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
          try {
            await videoRef.current.play();
            setCameraReady(true);
            setCameraError(null);
          } catch (playErr) {
            const msg = playErr instanceof Error ? playErr.message : String(playErr);
            setCameraError(`Kamera dinyalakan tapi gagal diputar: ${msg}`);
          }
        }
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
  }, [scanDiminta]);

  // Saat foto ditampilkan, elemen video dilepas dari DOM. Sambungkan kembali
  // ke stream yang sama ketika staf memilih "ulangi" supaya kamera langsung
  // hidup tanpa meminta ulang izin.
  useEffect(() => {
    const video = videoRef.current;
    const stream = streamRef.current;
    if (!video || !stream || video.srcObject === stream) return;
    video.srcObject = stream;
    void video.play().catch(() => undefined);
  }, [capturedDataUrl]);

  // Mesin pemindai dimuat setelah kamera benar-benar hidup, bukan saat halaman
  // dibuka. Statusnya ditampilkan supaya menunggu 16 MB tidak terasa
  // seperti halaman yang macet.
  useEffect(() => {
    if (!scanDiminta || mesinSiap) return;
    let batal = false;
    warmUpFaceEngine()
      .then(() => {
        if (!batal) setMesinSiap(true);
      })
      .catch(() => undefined);
    return () => {
      batal = true;
    };
  }, [scanDiminta, mesinSiap]);

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

  /*
   * Pemantau tantangan liveness.
   *
   * Berjalan setiap tiga frame supaya tidak membebani ponsel, berhenti begitu
   * semua tahap terpenuhi, dan diulang dari awal saat tombol ulang ditekan.
   */
  useEffect(() => {
    if (!cameraReady || liveSelesai) return;

    let berhenti = false;
    let frame = 0;

    const tick = async () => {
      if (berhenti) return;
      frame += 1;
      if (frame % 3 === 0) {
        try {
          const hasil = await detectFaceInVideo(videoRef.current!, performance.now());
          if (hasil && !berhenti) {
            setEyeBlink(hasil.eyeBlink);
            setJawOpen(hasil.jawOpen);
            setYaw(hasil.yaw);
            const tahap = liveRef.current.periksa(hasil);
            if (tahap) {
              setLiveTerpenuhi((s) => [...s, tahap]);
              setLiveTahap(liveRef.current.tahapBerikut);
              const jadi = liveRef.current.selesai;
              setLiveSelesai(jadi);
              if (jadi) return;
            }
          }
        } catch {
          // Kesalahan mesin pemindai tidak boleh menghentikan pemantau.
        }
      }
      requestAnimationFrame(() => void tick());
    };

    void tick();
    return () => {
      berhenti = true;
    };
  }, [cameraReady, liveSelesai]);

  /**
   * Pindai wajah pada frame video.
   *
   * Memakai FaceLandmarker, bukan sekadar memperkecil gambar. Wajah yang
   * tidak terdeteksi, terlalu kecil, atau tidak utuh ditolak di sini supaya
   * yang terkirim ke server selalu wajah yang layak.
   */
  const pindaiWajah = useCallback(async () => {
    const video = videoRef.current;
    if (!video) return null;
    return detectFaceInVideo(video, performance.now());
  }, []);

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
      const hasil = await pindaiWajah();
      if (!hasil) {
        setError(
          "Wajah belum terdeteksi. Posisikan wajah menghadap lurus ke kamera, lalu coba lagi.",
        );
        return;
      }

      const canvas = captureSquareCanvas(video, 512);
      const blob = await canvasToWebp(canvas, 0.82);
      setCapturedDataUrl(canvas.toDataURL("image/webp", 0.8));
      setCapturedBlob(blob);
      setCapturedDescriptor(hasil.descriptor);
      setEyeBlink(hasil.eyeBlink);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Gagal memindai wajah. Periksa izin kamera lalu coba lagi.",
      );
    } finally {
      setBusy(null);
    }
  }, [pindaiWajah]);

  const handleRetake = useCallback(() => {
    setCapturedDataUrl(null);
    setCapturedBlob(null);
    setCapturedDescriptor(null);
    setError(null);
    setInfo(null);
    // Kedip harus diulang supaya foto baru tidak memakai bukti dari frame lama.
    // Tantangan diulang supaya bukti dari frame lama tidak dipakai ulang.
    liveRef.current.reset();
    setLiveSelesai(false);
    setLiveTahap("center");
    setLiveTerpenuhi([]);
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
      // Foto ini disimpan sekali sebagai referensi. Maintainer melihatnya di
      // halaman verifikasi, jadi keputusan terima atau tolak tidak diambil
      // dari nama saja.
      const referencePath = await uploadPhoto(capturedBlob);
      const supabase = createClient();
      const { error: rpcErr } = await supabase.rpc("set_face_descriptor", {
        p_descriptor: capturedDescriptor,
        p_photo_url: referencePath,
      });
      if (rpcErr) throw new Error(rpcErr.message);
      setHasFace(true);
      setFaceDescriptor(capturedDescriptor);
      // Pendaftaran baru mengembalikan status ke menunggu, jadi info harus
      // menyatakan itu dan bukan menyatakan Face ID siap dipakai.
      setInfo(
        "Sampel wajah terkirim dan menunggu verifikasi maintainer. Absensi dibuka setelah disetujui.",
      );
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal mendaftarkan Face ID.");
    } finally {
      setBusy(null);
    }
  }, [capturedBlob, capturedDescriptor, uploadPhoto]);

  const handleSubmit = useCallback(async () => {
    setError(null);
    setInfo(null);
    if (!capturedDescriptor) {
      setError("Selesaikan pemindaian wajah terlebih dahulu.");
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
    if (mode === "checkin" && !lateReasonValid) {
      setError("Alasan keterlambatan wajib diisi minimal 5 karakter.");
      return;
    }

    try {
      setBusy("submit");
      // Foto adalah lampiran bukti, bukan syarat. Kalau perangkat tidak
      // menghasilkan berkas, absensi tetap dicatat dan kolom foto diisi null.
      // Yang wajib ada adalah vektor wajah, karena itu yang dibandingkan
      // server dengan sampel tersimpan.
      const photoPath = capturedBlob ? await uploadPhoto(capturedBlob) : null;
      const supabase = createClient();

      // Yang dikirim adalah vektor hasil pindai, bukan angka kemiripan.
      // Server yang membandingkan dengan sampel yang tersimpan dan
      // memutuskan lulus atau tidak, sehingga angka di laporan tidak lagi
      // bisa datang dari perangkat yang mengarang.
      const scanWajah = capturedDescriptor;

      if (mode === "checkin") {
        const { error: rpcErr } = await supabase.rpc("attendance_check_in", {
          p_latitude: gps.lat,
          p_longitude: gps.lng,
          p_accuracy_meters: gps.accuracy,
          p_photo_url: photoPath,
          p_face_descriptor: scanWajah,
          p_liveness_trace: liveRef.current.jejak(),
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
          p_face_similarity_score:
            similarity === null ? null : Number(similarity.toFixed(4)),
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
    branchConfigured,
    capturedBlob,
    capturedDescriptor,
    gps,
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

  /*
   * Setiap syarat yang mengunci tombol, ditulis supaya bisa dibaca orang.
   * Sebelumnya tombol hanya diam-diam tidak aktif ketika salah satu syarat
   * belum terpenuhi, sehingga yang sudah mengisi alasan dan memindai wajah
   * tetap bingung kenapa tombolnya tidak bisa ditekan.
   */
  /*
   * Syarat sebelum tombol kirim aktif.
   *
   * Dua hal tidak lagi menjadi syarat:
   *
   * Ambil foto. Toutinya sudah dibuktikan oleh lima tahap liveness, yaitu
   * hadap lurus, kedip, buka mulut, putar kiri, dan putar kanan. Foto
   * tambahan tidak menambah apa pun dan hanya menambah satu langkah yang harus
   * dilewati setiap kali absen.
   *
   * Dekati cabang. Banyak staf melayani home service di rumah pelanggan, jadi
   * mereka memang absen dari luar workshop. Lokasi tetap dicatat supaya
   * managerial bisa melihat, tapi tidak lagi memblokir check-in maupun
   * check-out. Server juga sudah tidak menolak, dan kolom outside_radius
 * menandai absen mana yang dilakukan dari luar.
   */
  const syaratSubmit: Syarat[] = [
    {
      terpenuhi: mode !== "done",
      label: "Sesi absensi sudah selesai",
    },
    {
      terpenuhi: gps.status === "success",
      label:
        gps.status === "error"
          ? "Izin lokasi GPS belum diberikan"
          : "Tunggu lokasi GPS terdeteksi",
    },
    {
      terpenuhi: mode === "checkout" || liveSelesai,
      label:
        mode === "checkout"
          ? "Liveness hanya diperlukan saat check-in"
          : "Selesaikan lima tahap liveness",
    },
    {
      terpenuhi: mode === "checkout" || lateReasonValid,
      label: `Isi alasan keterlambatan, minimal 5 karakter${
        lateReason.trim().length > 0 ? ` (sekarang ${lateReason.trim().length} karakter)` : ""
      }`,
    },
  ];

  const canSubmit = syaratSubmit.every((s) => s.terpenuhi);

  /*
   * Keterangan lokasi. Ini informasi, bukan syarat.
   * Ditampilkan apa adanya supaya yang absen dari luar workshop tahu
   * tercatat di mana, tanpa perlu ditebak dari absen yang sama sekali tidak
   * muncul.
   */
  const keteranganLokasi = (() => {
    if (!branchConfigured) return "Koordinat cabang belum diatur oleh maintainer.";
    if (gps.status === "error") return "Lokasi tidak terbaca, absen tetap tercatat.";
    if (gps.status !== "success") return "Mencari lokasi...";
    if (insideRadius)
      return `Di dalam lingkungan workshop, ${formatDistance(distance)} dari titik cabang.`;
    return `Di luar lingkungan workshop, ${formatDistance(distance)} dari titik cabang. Ini normal untuk home service.`;
  })();

  return (
    <div className="flex flex-col w-full pb-nav">
      {/* Ringkasan shift hari ini (owner / admin_kasir / maintainer) */}
      {canAudit ? (
        <section className="px-gutter pt-4">
          <div className="bg-surface rounded-[20px] p-4 clay-card border border-white/80">
            <div className="flex items-center justify-between gap-2 mb-2.5">
              <div className="flex items-center gap-2.5">
                <span className="w-9 h-9 rounded-xl bg-brand-50 text-brand-600 flex items-center justify-center shrink-0">
                  <Icon name="payments" className="text-[20px]" />
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
                <Icon name={handoff
                    ? handoff.status === "closed"
                      ? "task_alt"
                      : "pending"
                    : "snooze"} className="text-[13px]" />
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
                className="flex-1 h-11 rounded-xl primary-gradient text-white font-caption text-caption flex items-center justify-center gap-1.5 active:scale-95 transition-transform"
              >
                <Icon name={handoff && handoff.status === "open" ? "fact_check" : "login"} className="text-[16px]" />
                {handoff && handoff.status === "open"
                  ? "Lanjutkan Audit"
                  : "Buka Kas Titipan"}
              </Link>
              <Link
                href="/rekap"
                className="flex-1 h-11 rounded-xl bg-surface-container-low text-text-secondary font-caption text-caption flex items-center justify-center gap-1.5 active:scale-95 transition-transform"
              >
                <Icon name="groups" className="text-[16px]" />
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
              <Icon name={mode === "done" ? "task_alt" : "schedule"} className="text-[24px]" />
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
                  <Icon name="running_with_errors" className="text-[13px]" />
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
            <Icon name="badge" className="text-brand-600 text-[20px] mt-0.5" />
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
              <Icon name="wrong_location" className="text-warning-text text-[20px] mt-0.5" />
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
                <Icon name="my_location" className="text-[16px]" />
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
            <Icon name="edit_location_alt" className="text-[16px]" />
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
                <Icon name="refresh" className="text-[16px]" />
                Perbarui GPS
              </button>
              <button
                type="button"
                onClick={handleSaveLocation}
                disabled={busy !== null || gps.status !== "success"}
                className="flex-1 h-11 rounded-xl primary-gradient text-white font-caption text-caption flex items-center justify-center gap-1.5 active:scale-95 transition-transform disabled:opacity-60"
              >
                <Icon name="save" className="text-[16px]" />
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
                <Icon name="photo_camera" className="text-[18px]" />
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
              <img
                src={capturedDataUrl}
                alt="Pratinjau selfie absensi"
                className="w-full h-full object-cover"
              />
            ) : (
              <>
                {/*
                 * Elemen video selalu terpasang, bukan hanya pada cabang
                 * terakhir. Sebelumnya video baru dirender setelah cameraReady
                 * true, padahal cameraReady hanya jadi true setelah play()
                 * sukses, dan play() butuh elemen video yang sudah ada. Akibatnya
                 * layar berhenti selamanya di "Menyalakan kamera...". Status
                 * menunggu sekarang ditumpuk sebagai lapisan di atas video.
                 */}
                <video
                  ref={videoRef}
                  playsInline
                  muted
                  className="w-full h-full object-cover -scale-x-100"
                />
                {!scanDiminta ? (
                  /*
                   * Gerbang mulai pindai. Halaman tetap punya jam, riwayat, dan
                   * daftar syarat tanpa kamera menyala, jadi yang membuka
                   * absensi bukan pengganti dengan kamera yang menggantung.
                   */
                  <div className="absolute inset-0 bg-[#0F172A] flex flex-col items-center justify-center gap-3 px-6 text-center">
                    <Icon name="face" className="text-[36px] text-brand-200" />
                    <p className="font-caption text-caption text-white/80">
                      Kamera menyala setelah kamu menekan tombol di bawah.
                    </p>
                  </div>
                ) : !cameraReady ? (
                  <div className="absolute inset-0 bg-[#0F172A] flex flex-col items-center justify-center gap-3 px-6 text-center">
                    <Icon name="progress_activity" className="text-[36px] text-brand-200 animate-spin" />
                    <p className="font-caption text-caption text-white/80">
                      Menyalakan kamera...
                    </p>
                    {cameraError ? (
                      <p className="font-micro-badge text-micro-badge text-amber-300">
                        {cameraError}
                      </p>
                    ) : null}
                  </div>
                ) : !mesinSiap ? (
                  <div className="absolute inset-0 bg-[#0F172A] flex flex-col items-center justify-center gap-3 px-6 text-center">
                    <Icon name="downloading" className="text-[36px] text-brand-200 animate-spin" />
                    <p className="font-caption text-caption text-white/80">
                      Memuat mesin pemindai wajah, sekitar 16 MB.
                    </p>
                    <p className="font-micro-badge text-micro-badge text-white/60">
                      Hanya perlu sekali. Setelahnya tersimpan di perangkat.
                    </p>
                  </div>
                ) : null}
              </>
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
                  <Icon name="location_on" className="text-[15px]" />
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

          {/*
             * Tantangan liveness bertahap.
             *
             * Setiap tahap diperiksa terhadap posisi netral orang itu sendiri,
             * bukan angka tetap, sehingga orang dengan bentuk wajah berbeda
             * tidak otomatis gagal. Foto yang dipegang di depan kamera tidak
             * bisa menyelesaikan tahap putaran kepala karena vektornya tidak
             * berubah.
             */}
          {cameraReady ? (
            <div
              className={`rounded-xl px-3.5 py-3 flex flex-col gap-2.5 ${
                liveSelesai
                  ? "bg-success-surface text-success-text"
                  : "bg-warning-surface text-warning-text"
              }`}
            >
              <div className="flex items-center gap-2.5">
                <Icon name={liveSelesai ? "verified_user" : "visibility"} className="text-[20px]" />
                <p className="font-caption text-caption flex-1 text-left">
                  {liveSelesai
                    ? "Liveness terverifikasi, absen bisa dikirim"
                    : liveTahap
                      ? LABEL_TAHAP[liveTahap]
                      : "Hadap lurus ke kamera"}
                </p>
                <span className="font-micro-badge text-micro-badge">
                  {liveTerpenuhi.length}/{URUTAN_TAHAP.length}
                </span>
              </div>

              <ol className="flex flex-col gap-1">
                {URUTAN_TAHAP.map((t) => {
                  const beres = liveTerpenuhi.includes(t);
                  const aktif = liveTahap === t;
                  return (
                    <li key={t} className="flex items-center gap-2">
                      <span
                        className={`grid place-items-center w-[18px] h-[18px] rounded-full shrink-0 ${
                          beres ? "bg-current" : "border border-current opacity-50"
                        }`}
                      >
                        {beres ? (
                          <span className="block w-[8px] h-[8px] rounded-full bg-white" />
                        ) : null}
                      </span>
                      <span
                        className={`font-caption text-caption ${
                          aktif ? "font-bold" : "opacity-70"
                        }`}
                      >
                        {LABEL_TAHAP[t]}
                      </span>
                    </li>
                  );
                })}
              </ol>

              {!liveSelesai ? (
                <p className="font-micro-badge text-micro-badge opacity-80">
                  {liveTahap === "mouth"
                    ? "Mulut terbuka jelas, lalu tutupkan lagi"
                    : liveTahap === "left"
                      ? "Putar kepala ke kiri sampai terasa berbeda"
                      : liveTahap === "right"
                        ? "Putar kepala ke kanan sampai terasa berbeda"
                        : "Ikuti urutan di atas, satu tahap satu tahap"}
                </p>
              ) : null}
            </div>
          ) : null}

            {/* Kontrol ambil foto */}
            <div className="flex items-center justify-center gap-3">
              {!scanDiminta ? (
                <button
                  type="button"
                  onClick={() => setScanDiminta(true)}
                  className="h-12 px-6 rounded-full primary-gradient text-white font-body-bold text-body-bold flex items-center gap-2 clay-glow active:scale-95 transition-transform"
                >
                  <Icon name="photo_camera" className="text-[18px]" />
                  Mulai Pindai Wajah
                </button>
              ) : capturedDataUrl ? (
                <button
                  type="button"
                  onClick={handleRetake}
                  disabled={busy !== null}
                  className="h-11 px-5 rounded-full bg-surface-container-low text-text-secondary font-caption text-caption flex items-center gap-1.5 active:scale-95 transition-transform disabled:opacity-50"
                >
                  <Icon name="restart_alt" className="text-[18px]" />
                  Ulangi Foto
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleCapture}
                  disabled={!cameraReady || !mesinSiap || busy !== null}
                  className="h-11 px-5 rounded-full primary-gradient text-white font-body-bold text-body-bold flex items-center gap-1.5 active:scale-95 transition-transform disabled:opacity-50"
                >
                  <Icon name="download" className="text-[18px]" />
                  {busy === "capture"
                    ? "Memproses..."
                    : !mesinSiap
                      ? "Menyiapkan..."
                      : "Ambil Foto"}
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

      {/* Keterangan lokasi, bukan syarat absen */}
      <section className="px-gutter pt-3">
        <div
          className={`rounded-xl p-3 flex items-start gap-2 border ${
            insideRadius
              ? "bg-success-surface border-success-base/30"
              : "bg-warning-surface border-warning-base/30"
          }`}
        >
          <Icon
            name={insideRadius ? "gps_fixed" : "travel_explore"}
            className={`text-[18px] shrink-0 mt-0.5 ${insideRadius ? "text-success-text" : "text-warning-text"}`}
          />
          <div className="min-w-0 flex-1">
            <p
              className={`font-caption text-caption ${
                insideRadius ? "text-success-text" : "text-warning-text"
              }`}
            >
              {keteranganLokasi}
            </p>
            <p className="font-micro-badge text-micro-badge text-text-secondary mt-0.5">
              {gps.lat !== null && gps.lng !== null
                ? `${gps.lat.toFixed(5)}, ${gps.lng.toFixed(5)}`
                : "Koordinat belum terbaca"}
              {clock ? ` - ${clock.timeLabel} WIB` : ""}
            </p>
          </div>
        </div>
      </section>

      {/* Kartu keterlambatan */}
      {mode === "checkin" ? (
        <section className="px-gutter pt-4">
          <div className="bg-brand-50 border border-brand-100 rounded-[16px] p-3.5 space-y-3">
            <div className="flex items-center justify-between pb-2.5 border-b border-brand-200/60">
              <div className="flex items-center gap-2 text-text-primary">
                <div className="w-7 h-7 rounded-lg bg-brand-500/10 text-brand-500 flex items-center justify-center shrink-0">
                  <Icon name="schedule" className="text-[16px]" />
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
                  <Icon name="warning" className="text-warning-text text-[18px] mt-0.5" />
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
                <Icon name="check_circle" className="text-success-text text-[18px]" />
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
        {mode !== "done" ? (
          <SyaratBelumTerpenuhi
            syarat={syaratSubmit}
            judul="Sisa langkah sebelum absen bisa dikirim"
          />
        ) : null}
        {hasFace && faceStatus !== null && faceStatus !== "approved" ? (
          <div
            className={`rounded-2xl p-3.5 font-caption text-caption leading-relaxed ${
              faceStatus === "rejected"
                ? "bg-danger-surface text-danger-text"
                : "bg-warning-surface text-warning-text"
            }`}
          >
            <span className="font-body-bold text-body-bold flex items-center gap-1.5 mb-1">
              <Icon name={faceStatus === "rejected" ? "block" : "hourglass_top"} className="text-[18px]" />
              {faceStatus === "rejected"
                ? "Wajah ditolak maintainer"
                : "Wajah menunggu verifikasi"}
            </span>
            {faceStatus === "rejected"
              ? "Daftarkan ulang sampel wajah Anda, lalu minta maintainer meninjaunya lagi."
              : "Sampel wajah Anda sudah terkirim dan ditunggu tinjauan maintainer. Absensi dibuka setelah disetujui."}
          </div>
        ) : null}

        {hasFace && faceStatus === "rejected" ? (
          <button
            type="button"
            onClick={handleRegisterFace}
            disabled={busy !== null || !capturedBlob}
            className="w-full h-[50px] rounded-full bg-surface border border-brand-200 text-brand-700 font-body-bold text-body-bold flex items-center justify-center gap-2.5 active:scale-[0.98] transition-all disabled:opacity-60"
          >
            <Icon name="face_retouching_natural" className="text-[22px]" />
            {busy === "register" ? "Mendaftarkan..." : "Daftarkan Ulang Face ID"}
          </button>
        ) : null}

        {!hasFace ? (
          <button
            type="button"
            onClick={handleRegisterFace}
            disabled={busy !== null || !capturedBlob}
            className="w-full h-[50px] rounded-full bg-surface border border-brand-200 text-brand-700 font-body-bold text-body-bold flex items-center justify-center gap-2.5 active:scale-[0.98] transition-all disabled:opacity-60"
          >
            <Icon name="face_retouching_natural" className="text-[22px]" />
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
            <Icon name={mode === "checkout" ? "logout" : "photo_camera"} className="text-[22px]" />
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
            <Icon name="verified" className="text-[22px]" />
            Absensi hari ini sudah lengkap
          </div>
        )}

        {error ? (
          <div className="p-3 rounded-xl bg-danger-surface text-danger-text font-body text-body flex items-center gap-2">
            <Icon name="error" className="text-[18px]" />
            <span className="flex-1">{error}</span>
          </div>
        ) : null}

        {info ? (
          <div className="p-3 rounded-xl bg-success-surface text-success-text font-body text-body flex items-center gap-2">
            <Icon name="check_circle" className="text-[18px]" />
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
              <Icon name="history" className="text-brand-600 text-[18px]" />
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
