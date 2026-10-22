/**
 * RBAC: Single Source of Truth hak akses RB AUTOLUXE.
 *
 * Modul ini MURNI (tidak meng-import next/* atau @supabase/*) supaya aman
 * dipakai oleh komponen client maupun server component. Untuk gerbang
 * halaman di server, gunakan `lib/rbac-guard.ts`.
 *
 * Matriks ini menggantikan daftar role yang sebelumnya diduplikasi di
 * app/pos/page.tsx, app/pos/orders/page.tsx, app/stok/page.tsx,
 * app/profil/page.tsx, dan app/laporan/page.tsx.
 */

export const ROLES = ["owner", "admin_kasir", "maintainer", "karyawan"] as const;

export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  owner: "Pemilik / Owner",
  admin_kasir: "Admin Kasir",
  maintainer: "Maintainer",
  karyawan: "Karyawan",
};

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

export function toRole(value: unknown): Role {
  return isRole(value) ? value : "karyawan";
}

export function roleLabel(value: unknown): string {
  const role = toRole(value);
  return ROLE_LABELS[role];
}

/* -------------------------------------------------------------------------- */
/* Izin                                                                        */
/* -------------------------------------------------------------------------- */

export const PERMISSIONS = [
  /* Absensi */
  "attendance.self",
  "attendance.audit",
  "attendance.manage_location",

  /* Izin / cuti / sakit */
  "time_off.request",
  "time_off.decide",

  /* Inspeksi & QC */
  "inspection.upload",
  "inspection.delete_any",
  "qc.review",

  /* POS & order */
  "pos.create",
  "order.manage_status",
  "order.cancel",
  "order.start_work",

  /* Inventaris */
  "stock.claim",
  "stock.approve",

  /* Kas */
  "cash.view_own_hold",
  "cash.view_branch",
  "cash.shift_manage",
  "cash.petty_manage",

  /* Laporan */
  "reports.branch",
  "reports.executive",

  /* Garansi & komunikasi */
  "warranty.manage",
  "whatsapp.draft",

  /* Administrasi */
  "staff.manage",
  "services.manage",
  "branch.switch",
  "branch.manage",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

/**
 * Matriks izin per role.
 *
 * karyawan  : hanya tugas kerjanya sendiri (absensi, order, klaim stok,
 *             dan kas titipan yang sedang dipegangnya sendiri.
 *             Tidak ada akses ke finansial, audit shift, atau laporan.
 * admin_kasir: operasional penuh 1 cabang, termasuk validasi kas titipan
 *             karyawan dan laporan cabang sendiri (bukan lintas cabang).
 * maintainer : seluruh cabang + konfigurasi sistem & geofence.
 * owner      : seluruh cabang + analytics eksekutif lintas cabang.
 */
export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  karyawan: [
    "attendance.self",
    "time_off.request",
    "pos.create",
    "order.start_work",
    "inspection.upload",
    "stock.claim",
    "cash.view_own_hold",
  ],
  admin_kasir: [
    "attendance.self",
    "attendance.audit",
    "time_off.request",
    "pos.create",
    "order.manage_status",
    "order.cancel",
    "inspection.upload",
    "qc.review",
    "stock.claim",
    "stock.approve",
    "cash.view_branch",
    "cash.shift_manage",
    "cash.petty_manage",
    "reports.branch",
    "warranty.manage",
    "whatsapp.draft",
    "services.manage",
  ],
  maintainer: [
    "attendance.self",
    "attendance.audit",
    "attendance.manage_location",
    "time_off.request",
    "time_off.decide",
    "pos.create",
    "order.manage_status",
    "order.cancel",
    "inspection.upload",
    "inspection.delete_any",
    "qc.review",
    "stock.claim",
    "stock.approve",
    "cash.view_branch",
    "cash.shift_manage",
    "cash.petty_manage",
    "reports.branch",
    "reports.executive",
    "warranty.manage",
    "whatsapp.draft",
    "staff.manage",
    "services.manage",
    "branch.switch",
    "branch.manage",
  ],
  owner: [
    "attendance.self",
    "attendance.audit",
    "attendance.manage_location",
    "time_off.request",
    "time_off.decide",
    "pos.create",
    "order.manage_status",
    "order.cancel",
    "inspection.upload",
    "inspection.delete_any",
    "qc.review",
    "stock.claim",
    "stock.approve",
    "cash.view_branch",
    "cash.shift_manage",
    "cash.petty_manage",
    "reports.branch",
    "reports.executive",
    "warranty.manage",
    "whatsapp.draft",
    "staff.manage",
    "services.manage",
    "branch.switch",
    "branch.manage",
  ],
};

export function can(role: unknown, permission: Permission): boolean {
  return ROLE_PERMISSIONS[toRole(role)].includes(permission);
}

export function canAny(role: unknown, permissions: readonly Permission[]): boolean {
  return permissions.some((permission) => can(role, permission));
}

/** Selisih struktural antara dua role, dipakai audit UI. */
export function permissionDiff(role: unknown): Permission[] {
  const granted = new Set(ROLE_PERMISSIONS[toRole(role)]);
  return PERMISSIONS.filter((permission) => !granted.has(permission));
}

/* -------------------------------------------------------------------------- */
/* Navigasi                                                                    */
/* -------------------------------------------------------------------------- */

export type NavItem = {
  label: string;
  icon: string;
  href: string;
  /** Izin yang harus dimiliki agar item ini tampil. */
  permission: Permission | null;
};

const NAV_BERANDA: NavItem = {
  label: "Beranda",
  icon: "dashboard",
  href: "/dashboard",
  permission: null,
};

const NAV_ABSENSI: NavItem = {
  label: "Absensi",
  icon: "how_to_reg",
  href: "/absensi",
  permission: "attendance.self",
};

const NAV_ANTREAN: NavItem = {
  label: "Antrean",
  icon: "assignment",
  href: "/pos/orders",
  permission: null,
};

const NAV_STOK: NavItem = {
  label: "Stok",
  icon: "inventory_2",
  href: "/stok",
  permission: "stock.claim",
};

const NAV_SHIFT: NavItem = {
  label: "Shift",
  icon: "payments",
  href: "/shift",
  permission: "cash.shift_manage",
};

const NAV_LAPORAN: NavItem = {
  label: "Laporan",
  icon: "insights",
  href: "/laporan",
  permission: "reports.branch",
};

const NAV_REKAP: NavItem = {
  label: "Rekap",
  icon: "groups",
  href: "/rekap",
  permission: "attendance.audit",
};

const NAV_IZIN: NavItem = {
  label: "Izin",
  icon: "event_busy",
  href: "/izin",
  permission: "time_off.request",
};

const NAV_PROFIL: NavItem = {
  label: "Profil",
  icon: "account_circle",
  href: "/profil",
  permission: null,
};

/**
 * Bottom bar memuat 4 item mengelilingi tombol tengah (FAB).
 * Tiga role pertama di kiri, item keempat di kanan.
 */
export const BOTTOM_NAV_BY_ROLE: Record<Role, readonly NavItem[]> = {
  karyawan: [NAV_BERANDA, NAV_ABSENSI, NAV_ANTREAN, NAV_IZIN],
  admin_kasir: [NAV_BERANDA, NAV_ANTREAN, NAV_STOK, NAV_SHIFT],
  maintainer: [NAV_BERANDA, NAV_ANTREAN, NAV_STOK, NAV_REKAP],
  owner: [NAV_BERANDA, NAV_ANTREAN, NAV_LAPORAN, NAV_PROFIL],
};

export function bottomNavFor(role: unknown): NavItem[] {
  return BOTTOM_NAV_BY_ROLE[toRole(role)].filter(
    (item) => item.permission === null || can(role, item.permission),
  );
}

export function showCreateOrderFab(role: unknown): boolean {
  return can(role, "pos.create");
}

/* -------------------------------------------------------------------------- */
/* Aksi Cepat Dashboard                                                        */
/* -------------------------------------------------------------------------- */

export type QuickAction = {
  icon: string;
  label: string;
  href: string;
  permission: Permission;
  primary?: boolean;
  disabled?: boolean;
  disabledTitle?: string;
};

// Urutan menentukan: quickActionsFor mengambil 4 izin pertama yang cocok, jadi
// pintasan manajerial diletakkan lebih dulu.
const QUICK_ACTIONS: readonly QuickAction[] = [
  { icon: "payments", label: "Shift Kas", href: "/shift", permission: "cash.shift_manage" },
  { icon: "insights", label: "Laporan", href: "/laporan", permission: "reports.branch" },
  { icon: "groups", label: "Rekap Staf", href: "/rekap", permission: "attendance.audit" },
  { icon: "add_task", label: "Order Baru", href: "/pos", permission: "pos.create", primary: true },
  { icon: "assignment", label: "Antrean", href: "/pos/orders", permission: "pos.create" },
  { icon: "inventory_2", label: "Stok Obat", href: "/stok", permission: "stock.claim" },
  { icon: "how_to_reg", label: "Absensi", href: "/absensi", permission: "attendance.self" },
  { icon: "event_busy", label: "Izin/Cuti", href: "/izin", permission: "time_off.request" },
  { icon: "add_a_photo", label: "SOP QC", href: "/pos/orders", permission: "inspection.upload", disabled: true, disabledTitle: "Buka detail order untuk mulai inspeksi" },
  { icon: "event_busy", label: "Izin Shift", href: "/izin", permission: "time_off.request" },
];

export function quickActionsFor(role: unknown): QuickAction[] {
  const active = QUICK_ACTIONS.filter((action) => !action.disabled && can(role, action.permission));
  const teaser = QUICK_ACTIONS.filter((action) => action.disabled && can(role, action.permission));
  return [...active, ...teaser].slice(0, 4);
}

/* -------------------------------------------------------------------------- */
/* Menu Profil                                                                 */
/* -------------------------------------------------------------------------- */

export type ProfileMenuItem = {
  label: string;
  caption: string;
  icon: string;
  href: string;
  permission: Permission | null;
};

export const PROFILE_MENU: readonly ProfileMenuItem[] = [
  { label: "Absensi Biometrik", caption: "Scan Face ID & GPS kehadiran", icon: "how_to_reg", href: "/absensi", permission: "attendance.self" },
  { label: "Izin, Cuti & Sakit", caption: "Ajukan dan pantau pengajuan", icon: "event_busy", href: "/izin", permission: "time_off.request" },
  { label: "POS & Order", caption: "Buat order, bayar nanti, kerjakan", icon: "add_task", href: "/pos", permission: "pos.create" },
  { label: "Antrean Order", caption: "Status pengerjaan dan inspeksi", icon: "assignment", href: "/pos/orders", permission: null },
  { label: "Klaim Stok", caption: "Ajukan & pantau stok obat", icon: "inventory_2", href: "/stok", permission: "stock.claim" },
  { label: "Kas Titipan Shift", caption: "Buka kas, rekap & tutup audit shift", icon: "payments", href: "/shift", permission: "cash.shift_manage" },
  { label: "Kas Keluar", caption: "Petty cash operasional + foto nota", icon: "receipt_long", href: "/kas", permission: "cash.petty_manage" },
  { label: "Riwayat Invoice", caption: "Cari & cetak ulang nota pelanggan", icon: "print", href: "/invoice", permission: "reports.branch" },
  { label: "Klaim Garansi", caption: "Cek masa garansi & proses klaim", icon: "verified_user", href: "/garansi", permission: "warranty.manage" },
  { label: "Rekap Kehadiran Staf", caption: "Kalender bulanan, rekap 3 bulan, ekspor Excel", icon: "groups", href: "/rekap", permission: "attendance.audit" },
  { label: "Laporan Cabang", caption: "Finansial, omzet, komisi & stok", icon: "insights", href: "/laporan", permission: "reports.branch" },
  { label: "Pengaturan Cabang", caption: "Alamat, titik GPS & jam operasional", icon: "tune", href: "/pengaturan/cabang", permission: "branch.manage" },
  { label: "Kelola Staf", caption: "Foto, jabatan, jadwal, dan pindah cabang", icon: "schedule", href: "/pengaturan/karyawan", permission: "branch.manage" },
  { label: "Kelola Jasa POS", caption: "Nama, harga per ukuran, dan status", icon: "edit_note", href: "/pengaturan/jasa", permission: "services.manage" },
  { label: "Resep Bahan Jasa", caption: "Bahan gudang yang terpotong saat checkout", icon: "inventory_2", href: "/pengaturan/resep", permission: "services.manage" },
  { label: "Verifikasi Wajah", caption: "Tinjau sampel wajah staf", icon: "face_retouching_natural", href: "/pengaturan/wajah", permission: "branch.manage" },
  { label: "Opname Fisik Bulanan", caption: "Bandingkan stok gudang dengan sistem", icon: "fact_check", href: "/stok/opname", permission: "stock.approve" },
  { label: "Pesanan WhatsApp", caption: "Siapkan pesan nota pelanggan", icon: "chat", href: "/whatsapp", permission: "whatsapp.draft" },
];

export function profileMenuFor(role: unknown): ProfileMenuItem[] {
  return PROFILE_MENU.filter(
    (item) => item.permission === null || can(role, item.permission),
  );
}

/* -------------------------------------------------------------------------- */
/* Konstanta turunan (backward-compatible)                                    */
/* -------------------------------------------------------------------------- */

/** Wrapper yang dulu hidup di lib/attendance.ts. Sekarang diturunkan dari matriks. */
export function rolesWith(permission: Permission): Role[] {
  return ROLES.filter((role) => ROLE_PERMISSIONS[role].includes(permission));
}

export const LOCATION_MANAGER_ROLES: readonly string[] = rolesWith(
  "attendance.manage_location",
);

export const ATTENDANCE_MANAGER_ROLES: readonly string[] = rolesWith(
  "attendance.audit",
);

export const PRIVILEGED_ROLES: readonly string[] = rolesWith("cash.view_branch");