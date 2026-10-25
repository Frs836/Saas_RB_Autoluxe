/**
 * Fondasi multi-cabang: cabang aktif dan parsing koordinat manual.
 *
 * Cabang aktif disimpan di cookie (bukan localStorage) karena halaman-halaman
 * ini dirender di server. Semua server component membaca SessionProfile.branchId
 * sehingga cukup satu perubahan di sini untuk mengarahkan seluruh kueri.
 */

export const ACTIVE_BRANCH_COOKIE = "rba_active_branch";

/** Nilai khusus untuk cookie yang berarti "lihat seluruh cabang". */
export const ALL_BRANCHES = "all";

export type BranchScope = "all" | "branch";

export type BranchOption = {
  id: string;
  name: string;
  isActive: boolean;
};

export type BranchRecord = BranchOption & {
  address: string;
  latitude: number | null;
  longitude: number | null;
  radiusMeters: number;
  openTime: string;
  closeTime: string;
  staffCount: number;
  /** Nomor WhatsApp untuk saran & keluhan di struk, format "628xxx". */
  complaintWa?: string | null;
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Cookie cabang aktif dibaca dari klien, jadi nilainya bisa dikarang. Bentuknya
 * diperiksa dulu supaya tidak pernah masuk ke query sebagai UUID ngawur.
 */
export function isBranchUuid(value: string | null | undefined): boolean {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

/** Nomor koordinat yang masuk akal untuk workshop di Indonesia. */
export function isValidLatitude(value: number): boolean {
  return Number.isFinite(value) && value >= -90 && value <= 90;
}

export function isValidLongitude(value: number): boolean {
  return Number.isFinite(value) && value >= -180 && value <= 180;
}

/**
 * Terjemahkan masukan mentah menjadi koordinat.
 *
 * Menerima tempelan yang sering muncul dari Google Maps:
 *   https://www.google.com/maps/@-6.175392,106.827153,17z
 *   https://maps.app.goo.gl/xxxx
 *   -6.175392, 106.827153
 *   -6.175392 106.827153
 *
 * Kurzort goo.gl tidak memuat koordinat sehingga hanya ditolak dengan pesan
 * yang jelas, bukan diam-diam menghasilkan angka yang salah.
 */
export function parseCoordinateInput(raw: string): {
  ok: boolean;
  latitude: number | null;
  longitude: number | null;
  message: string | null;
} {
  const text = raw.trim();
  if (text === "") {
    return { ok: false, latitude: null, longitude: null, message: "Koordinat masih kosong." };
  }

  // Kurzort goo.gl hanya berisi token, bukan koordinat.
  if (/maps\.app\.goo\.gl\//i.test(text)) {
    return {
      ok: false,
      latitude: null,
      longitude: null,
      message:
        "Tautan singkat goo.gl tidak memuat koordinat. Buka peta, lalu salin angka latitude dan longitude dari kotak pencarian Google Maps.",
    };
  }

  // Ambil pasangan desimal pertama yang muncul pada teks.
  const matches = text.match(/-?\d{1,3}(?:\.\d+)?/g);
  if (!matches || matches.length < 2) {
    return {
      ok: false,
      latitude: null,
      longitude: null,
      message:
        "Format tidak dikenali. Contoh yang bisa dipakai: -6.175392, 106.827153",
    };
  }

  const latitude = Number(matches[0]);
  const longitude = Number(matches[1]);

  if (!isValidLatitude(latitude) || !isValidLongitude(longitude)) {
    return {
      ok: false,
      latitude: null,
      longitude: null,
      message:
        "Nilai di luar rentang yang sah. Latitude harus -90 sampai 90, longitude -180 sampai 180.",
    };
  }

  return { ok: true, latitude, longitude, message: null };
}

/** Koordinat bujur dan lat melintasi batas meridian atau tanggal. */
export function crossesDateLine(latitude: number, longitude: number): boolean {
  return Math.abs(longitude) > 180 - 0.5;
}

export function formatCoordinate(value: number | null, digits = 6): string {
  if (value === null || !Number.isFinite(value)) return "-";
  return value.toFixed(digits);
}

/** Tautan Google Maps yang langsung membuka titik pada zoom 17. */
export function googleMapsLink(
  latitude: number | null,
  longitude: number | null,
  label?: string | null,
): string | null {
  if (latitude === null || longitude === null) return null;
  const query = label
    ? `${encodeURIComponent(label)}&api=1&query=${latitude},${longitude}`
    : `?api=1&query=${latitude},${longitude}`;
  return `https://www.google.com/maps/search/${query}`;
}

/** Konversi "HH:MM:SS" dari Postgres menjadi "HH:MM" untuk input time. */
export function toTimeInput(value: string | null): string {
  if (!value) return "";
  return value.slice(0, 5);
}

/**
 * Tabel yang punya kolom branch_id sendiri.
 *
 * Daftar ini disengaja eksplisit. Postgres mengembalikan error 42703 kalau
 * kolom yang difilter tidak ada, dan error itu pernah hilang diam-diam karena
 * pemanggil hanya membaca `.data`. Memberi tahu nama tabel sebagai argumen
 * membuat kesalahan jenis ini muncul di TypeScript, bukan di produksi.
 */
const BRANCH_SCOPED_TABLES = new Set([
  "cash_flow",
  "commission_settings",
  "inventory_items",
  "orders",
  "petty_cash",
  "profiles",
  "service_material_recipes",
  "shift_handoffs",
  "stock_claims",
  "stock_logs",
  "stock_opnames",
]);

/**
 * Membatasi kueri ke cabang tertentu, atau membiarkannya terbuka bila
 * pengguna memilih "Seluruh Cabang".
 *
 * Nama tabel wajib diberikan. Tabel yang tidak punya branch_id, seperti
 * branches, diabaikan; untuk tabel itu penyaringannya lewat relasi, bukan
 * kolom langsung.
 *
 * Bentuk parameternya disengaja tidak memakai constraint generik. Pada
 * PostgrestFilterBuilder milik supabase-js, constrain `T extends { eq(...) }`
 * membuat TypeScript melakukan instantiasi tipe yang terlalu dalam pada
 * kueri dengan banyak kolom select.
 */
export function scopeBranchQuery<T>(
  builder: T,
  branchId: string | null,
  table: string,
): T {
  if (!branchId || !BRANCH_SCOPED_TABLES.has(table)) return builder;
  return (builder as { eq: (column: string, value: unknown) => T }).eq(
    "branch_id",
    branchId,
  );
}

/**
 * Menandai kueri yang gagal.
 *
 * Halaman yang hanya membaca `.data` akan menampilkan "kosong" untuk error
 * database. Untuk kueri yang jadi dasar angka keuangan atau pemFilteringan,
 * kegagalan harus terasa, bukan disamarkan jadi daftar kosong.
 */
export function queryError(
  result: { error: { message: string } | null },
  label: string,
): void {
  if (result.error) {
    console.error(`[${label}] ${result.error.message}`);
  }
}