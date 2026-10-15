import {
  ATTENDANCE_MANAGER_ROLES,
  LOCATION_MANAGER_ROLES,
  ROLE_LABELS,
} from "@/lib/rbac";

export { ATTENDANCE_MANAGER_ROLES, LOCATION_MANAGER_ROLES };

export const ATTENDANCE_ROLE_LABELS: Record<string, string> = {
  ...ROLE_LABELS,
};

export const ATTENDANCE_STATUS_LABELS: Record<string, string> = {
  hadir: "Hadir",
  libur_shift: "Libur Shift",
  izin: "Izin",
  sakit: "Sakit",
};

export const ATTENDANCE_STATUS_STYLE: Record<string, string> = {
  hadir: "bg-success-surface text-success-text",
  libur_shift: "bg-surface-container-low text-text-secondary",
  izin: "bg-warning-surface text-warning-text",
  sakit: "bg-danger-surface text-danger-text",
};

/** Jarik Dua koordinat dalam meter (haversine, radius bumi 6.371.000 m). */
export function haversineMeters(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const R = 6371000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.asin(Math.sqrt(a));
}

export function formatDistance(meters: number | null | undefined): string {
  if (meters === null || meters === undefined || Number.isNaN(meters)) {
    return "-";
  }
  if (meters >= 1000) {
    return `${(meters / 1000).toLocaleString("id-ID", {
      maximumFractionDigits: 1,
    })} km`;
  }
  return `${Math.round(meters)} m`;
}

/** "07:30:00" -> menit sejak tengah malam (450). */
export function parseTimeToMinutes(value: string | null | undefined): number {
  if (!value) return 0;
  const [h, m] = value.split(":");
  return Number(h ?? 0) * 60 + Number(m ?? 0);
}

export type WibNow = {
  dateIso: string;
  minutesOfDay: number;
  timeLabel: string;
  dateLabel: string;
};

export function wibNow(): WibNow {
  const now = new Date();
  const timeFmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Jakarta",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = timeFmt.formatToParts(now);
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  const dateIso = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  const dateLabel = new Intl.DateTimeFormat("id-ID", {
    timeZone: "Asia/Jakarta",
    weekday: "long",
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(now);
  const timeLabel = new Intl.DateTimeFormat("id-ID", {
    timeZone: "Asia/Jakarta",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(now);
  return {
    dateIso,
    minutesOfDay: hour * 60 + minute,
    timeLabel,
    dateLabel,
  };
}

export function computeLateMinutes(openTime: string | null | undefined): number {
  const open = parseTimeToMinutes(openTime);
  if (!open) return 0;
  return Math.max(0, wibNow().minutesOfDay - open);
}

export function formatDuration(minutes: number): string {
  if (minutes <= 0) return "0 menit";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h <= 0) return `${m} menit`;
  if (m === 0) return `${h} jam`;
  return `${h} jam ${m} menit`;
}

/**
 * Ambil potongan persegi tengah dari sumber video lalu perkecil menjadi
 * matriks keabuan grid x grid (default 16x16 = 256 dimensi). Vektor ini
 * dipakai sebagai "sampel wajah" untuk perbandingan kemiripan sederhana.
 */
export function extractFaceDescriptor(
  source: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
  grid = 16,
): number[] {
  const side = Math.min(sourceWidth, sourceHeight);
  const sx = (sourceWidth - side) / 2;
  const sy = (sourceHeight - side) / 2;

  const small = document.createElement("canvas");
  small.width = grid;
  small.height = grid;
  const ctx = small.getContext("2d", { willReadFrequently: true });
  if (!ctx) {
    throw new Error("Konteks kanvas tidak tersedia.");
  }
  ctx.drawImage(source, sx, sy, side, side, 0, 0, grid, grid);

  const { data } = ctx.getImageData(0, 0, grid, grid);
  const descriptor: number[] = [];
  for (let i = 0; i < data.length; i += 4) {
    const gray = (data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114) / 255;
    descriptor.push(Number(gray.toFixed(4)));
  }
  return descriptor;
}

/** Kemiripan kosinus dua vektor (0..1 untuk nilai bukan negatif). */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (!a.length || a.length !== b.length) return 0;
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  if (magA === 0 || magB === 0) return 0;
  return Math.min(1, Math.max(0, dot / (Math.sqrt(magA) * Math.sqrt(magB))));
}

/** Potong persegi tengah dari video dan perkecil ke ukuran tertentu. */
export function captureSquareCanvas(
  video: HTMLVideoElement,
  size = 512,
): HTMLCanvasElement {
  const side = Math.min(video.videoWidth, video.videoHeight);
  const sx = (video.videoWidth - side) / 2;
  const sy = (video.videoHeight - side) / 2;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Konteks kanvas tidak tersedia.");
  }
  ctx.drawImage(video, sx, sy, side, side, 0, 0, size, size);
  return canvas;
}

/** Kompres kanvas menjadi berkas WebP di bawah kualitas tertentu. */
export function canvasToWebp(
  canvas: HTMLCanvasElement,
  quality = 0.82,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error("Gagal mengompres foto."));
          return;
        }
        resolve(blob);
      },
      "image/webp",
      quality,
    );
  });
}

/**
 * Membaca berkas gambar, memotongnya jadi persegi dari tengah, lalu
 * mengompresnya menjadi WebP.
 *
 * Dipakai sebagai jalan keluar ketika kamera tidak bisa dibuka, misalnya di
 * komputer tanpa kamera web, ketika izin kamera ditolak, atau ketika halaman
 * dibuka lewat alamat IP yang bukan konteks aman. Hasilnya melewati pipeline yang sama
 * dengan hasil jepretan kamera, jadi tidak ada jalur yang berbeda di sisi
 * server.
 */
export async function fileToSquareWebp(
  file: File,
  size = 1024,
  quality = 0.8,
): Promise<Blob> {
  if (!file.type.startsWith("image/")) {
    throw new Error("Berkas yang dipilih bukan gambar.");
  }

  const url = URL.createObjectURL(file);
  try {
    const gambar = new Image();
    gambar.decoding = "async";
    await new Promise<void>((resolve, reject) => {
      gambar.onload = () => resolve();
      gambar.onerror = () =>
        reject(new Error("Gambar tidak bisa dibaca, mungkin berkas rusak."));
      gambar.src = url;
    });

    const w = gambar.naturalWidth;
    const h = gambar.naturalHeight;
    if (!w || !h) {
      throw new Error("Gambar tidak memiliki ukuran yang terbaca.");
    }

    const sisi = Math.min(w, h);
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new Error("Konteks kanvas tidak tersedia.");
    }
    ctx.drawImage(gambar, (w - sisi) / 2, (h - sisi) / 2, sisi, sisi, 0, 0, size, size);

    return await canvasToWebp(canvas, quality);
  } finally {
    URL.revokeObjectURL(url);
  }
}
