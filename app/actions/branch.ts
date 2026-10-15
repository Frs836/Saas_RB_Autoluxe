"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ALL_BRANCHES, ACTIVE_BRANCH_COOKIE, isBranchUuid } from "@/lib/branch";
import { can } from "@/lib/rbac";

const COOKIE_MAX_AGE = 60 * 60 * 24 * 30;

/**
 * Menahan tujuan navigasi agar hanya path internal. Nilai ini berasal dari
 * client, jadi harus disaring sebelum masuk ke redirect(), yang menerima URL
 * absolut dan tanpa penyaringan akan menjadi open redirect.
 */
function safeReturnTo(value: string): string {
  if (!value.startsWith("/")) return "/dashboard";
  if (value.startsWith("//")) return "/dashboard";
  return value;
}

async function writeActiveBranch(branchId: string): Promise<void> {
  const store = await cookies();
  store.set(ACTIVE_BRANCH_COOKIE, branchId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: COOKIE_MAX_AGE,
  });
  revalidatePath("/", "layout");
}

/**
 * Menyimpan cabang aktif ke cookie.
 *
 * Nilai diverifikasi ulang di server terhadap daftar cabang aktif. Permintaan
 * dari role yang tidak punya izin branch.switch diabaikan total, sehingga
 * karyawan tidak bisa memaksa server membuka cabang lain hanya dengan
 * mengarang parameter.
 */
export async function setActiveBranch(branchId: string, returnTo = "/dashboard") {
  const destination = safeReturnTo(returnTo);
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { ok: false as const, reason: "Sesi berakhir. Silakan masuk kembali." };

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("auth_id", user.id)
    .maybeSingle();

  if (!profile || !can(profile.role, "branch.switch")) {
    return { ok: false as const, reason: "Peran Anda tidak boleh berpindah cabang." };
  }

  if (branchId !== ALL_BRANCHES) {
    if (!isBranchUuid(branchId)) {
      return { ok: false as const, reason: "Cabang tidak dikenali." };
    }

    const { data: branch } = await supabase
      .from("branches")
      .select("id, is_active")
      .eq("id", branchId)
      .maybeSingle();

    if (!branch || !branch.is_active) {
      return { ok: false as const, reason: "Cabang tersebut sedang tidak aktif." };
    }
  }

  await writeActiveBranch(branchId);

  /*
   * Sebelumnya fungsi ini memanggil redirect() ke halaman yang sedang
   * dibuka. Itu memaksa browser melakukan navigasi penuh: seluruh dokumen
   * diunduh ulang dari awal. Memindahkan cabang hanya mengubah satu cookie,
   * jadi cukup router.refresh() dari client.
   *
   * redirect() juga melempar NEXT_REDIRECT. Kalau itu tidak tertangkap, state
   * pending di client tidak pernah dibersihkan, tombol switcher mati dan
   * satu-satunya jalan keluar adalah refresh manual.
   */
  return { ok: true as const, branchId };
}

/** Mengembalikan ke cabang penempatan tetap pengguna. */
export async function resetActiveBranch(returnTo = "/dashboard") {
  const destination = safeReturnTo(returnTo);
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect(destination);

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, branch_id")
    .eq("auth_id", user.id)
    .maybeSingle();

  if (!profile || !can(profile.role, "branch.switch")) {
    redirect(destination);
  }

  const home = isBranchUuid(profile.branch_id as string | null)
    ? (profile.branch_id as string)
    : ALL_BRANCHES;

  await writeActiveBranch(home);

  // Sama seperti setActiveBranch: cukup refresh, jangan navigasi penuh.
  return { ok: true as const, branchId: home };
}