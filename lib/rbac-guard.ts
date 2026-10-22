import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { USER_EMAIL_HEADER, USER_ID_HEADER } from "@/lib/session-headers";
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
/**
 * Hasil pencarian sesi, dibedakan antara "belum masuk" dan "sudah masuk tetapi
 * profilnya belum ada".
 *
 * Pembedaan ini penting karena dua keadaan itu berujung pada halaman berbeda:
 * yang belum masuk diarahkan ke /login, sedangkan yang belum punya profil
 * melihat halaman menunggu verifikasi. Kalau keduanya disamakan menjadi null,
 * halaman yang butuh membedakannya terpaksa memanggil getUser sendiri lagi.
 */
export type SessionLookup =
  | { kind: "anonymous" }
  | { kind: "no-profile"; email: string }
  | { kind: "ok"; profile: SessionProfile };

/**
 * Dibungkus `cache` supaya satu permintaan render hanya sekali menyentuh
 * database, seberapa banyak pun komponen memanggilnya.
 */
export const lookupSession = cache(async (): Promise<SessionLookup> => {
  const supabase = await createClient();

  /*
   * Identitas diambil dari header yang sudah diverifikasi proxy pada permintaan
   * yang sama, jadi tidak perlu memanggil layanan auth untuk kedua kalinya.
   * Bila header tidak ada (misalnya rute yang tidak dilalui proxy), jatuh
   * kembali ke pemeriksaan sesi biasa.
   */
  const requestHeaders = await headers();
  let userId = requestHeaders.get(USER_ID_HEADER);
  let email = requestHeaders.get(USER_EMAIL_HEADER) ?? "";

  if (!userId) {
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) return { kind: "anonymous" };

    userId = user.id;
    email = user.email ?? "";
  }

  /*
   * Profil dan daftar cabang diambil sekaligus, bukan berurutan.
   *
   * Daftar cabang dikirim bersama pada tahap yang sama, lalu dibuang lagi
   * kalau peran ternyata tidak boleh berpindah cabang. Data yang dibuang hanya
   * ada di memori server, jadi tidak menambah beban ke database.
   */
  const [profileRes, branchRes] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, auth_id, full_name, role, branch_id, shift_id")
      .eq("auth_id", userId)
      .maybeSingle(),
    supabase
      .from("branches")
      .select("id, branch_name, is_active")
      .order("branch_name", { ascending: true }),
  ]);

  const data = profileRes.data;
  if (!data) return { kind: "no-profile", email };

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
    kind: "ok",
    profile: {
      id: data.id,
      authId: data.auth_id,
      email,
      fullName: data.full_name ?? email ?? "Staf",
      role,
      branchId,
      homeBranchId,
      branchScope,
      canSwitchBranch,
      branches,
      shiftId: (data.shift_id as string | null) ?? null,
    },
  };
});

export async function getSessionProfile(): Promise<SessionProfile | null> {
  const result = await lookupSession();
  return result.kind === "ok" ? result.profile : null;
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