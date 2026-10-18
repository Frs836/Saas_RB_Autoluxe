import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  can,
  toRole,
  type Permission,
  type Role,
} from "@/lib/rbac";
import {
  ALL_BRANCHES,
  ACTIVE_BRANCH_COOKIE,
  isBranchUuid,
  type BranchOption,
  type BranchScope,
} from "@/lib/branch";

export type SessionProfile = {
  id: string;
  authId: string;
  email: string;
  fullName: string;
  role: Role;
  /** Cabang yang sedang aktif. null ketika cakupan "seluruh cabang". */
  branchId: string | null;
  /** Cabang penempatan tetap milik pengguna ini. */
  homeBranchId: string | null;
  branchScope: BranchScope;
  canSwitchBranch: boolean;
  branches: BranchOption[];
  shiftId: string | null;
};

/**
 * Sumber tunggal untuk data sesi di server component.
 *
 * Cabang aktif dibaca dari cookie sehingga seluruh halaman otomatis mengikuti
 * pilihan terakhir dari branch switcher. Nilai cookie selalu diverifikasi
 * ulang terhadap daftar cabang aktif, jadi cookie basi atau UUID yang
 * dipalsukan tidak dapat membuat pengguna membaca cabang yang tidak berwenang.
 */
export async function getSessionProfile(): Promise<SessionProfile | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  /*
   * Profil dan daftar cabang diambil sekaligus, bukan berurutan.
   *
   * Sebelumnya profil dibaca dulu, lalu Percabangan menentukan apakah daftar
   * cabang perlu diambil, sehingga owner dan maintainer selalu membayar dua
   * perjalanan berurutan sebelum kueri halaman apa pun dimulai. Pengukuran
   * produksi menunjukkan render server baru selesai 2,6 sampai 3,3 detik
   * setelah header terkirim.
   *
   * Daftar cabang dikirim bersama pada tahap yang sama, lalu dibuang lagi
   * kalau peran ternyata tidak boleh berpindah cabang. Data yang dibuang
   * hanya ada di memori server, jadi tidak menambah beban ke database.
   */
  const [profileRes, branchRes] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, auth_id, full_name, role, branch_id, shift_id")
      .eq("auth_id", user.id)
      .maybeSingle(),
    supabase
      .from("branches")
      .select("id, branch_name, is_active")
      .order("branch_name", { ascending: true }),
  ]);

  const data = profileRes.data;
  if (!data) return null;

  const role = toRole(data.role);
  const canSwitchBranch = can(role, "branch.switch");
  const homeBranchId = (data.branch_id as string | null) ?? null;

  let branchId = homeBranchId;
  let branchScope: BranchScope = "branch";
  let branches: BranchOption[] = [];

  if (canSwitchBranch) {
    branches = (branchRes.data ?? []).map((row) => ({
      id: row.id as string,
      name: (row.branch_name as string) ?? "Cabang",
      isActive: Boolean(row.is_active),
    }));

    const store = await cookies();
    const selected = store.get(ACTIVE_BRANCH_COOKIE)?.value;

    if (selected === ALL_BRANCHES) {
      branchScope = "all";
      branchId = null;
    } else if (isBranchUuid(selected)) {
      const match = branches.find((b) => b.id === selected && b.isActive);
      // Cookie yang tidak lagi menunjuk cabang aktif diabaikan diam-diam agar
      // pengguna tidak terjebak pada halaman kosong.
      if (match) branchId = match.id;
    }
  }

  return {
    id: data.id,
    authId: data.auth_id,
    email: user.email ?? "",
    fullName: data.full_name ?? user.email ?? "Staf",
    role,
    branchId,
    homeBranchId,
    branchScope,
    canSwitchBranch,
    branches,
    shiftId: (data.shift_id as string | null) ?? null,
  };
}

/**
 * Gerbang halaman: redirect ke /login bila belum masuk, ke /dashboard bila
 * role tidak punya izin, sebelum halaman menjalankan query apa pun.
 */
export async function requirePermission(
  permission: Permission,
  redirectTo = "/dashboard",
): Promise<SessionProfile> {
  const profile = await getSessionProfile();

  if (!profile) redirect("/login");

  if (!can(profile.role, permission)) redirect(redirectTo);

  return profile;
}

/** Untuk halaman yang wajib login tanpa syarat izin tambahan. */
export async function requireSession(): Promise<SessionProfile> {
  const profile = await getSessionProfile();

  if (!profile) redirect("/login");

  return profile;
}

/**
 * Cabang yang harus dipakai filter kueri.
 *
 * Mengembalikan null ketika pengguna memilih "Seluruh Cabang" sehingga
 * pemanggil cukup melakukan `branchId ? query.eq(...) : query`.
 */
export function scopedBranchId(session: SessionProfile): string | null {
  return session.branchScope === "all" ? null : session.branchId;
}

/** Nama cabang aktif untuk ditampilkan di header. */
export function activeBranchName(session: SessionProfile): string {
  if (session.branchScope === "all") return "Seluruh Cabang";
  const match = session.branches.find((branch) => branch.id === session.branchId);
  return match?.name ?? "Cabang Utama";
}