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

  if (!user) redirect(destination);

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("auth_id", user.id)
    .maybeSingle();

  if (!profile || !can(profile.role, "branch.switch")) {
    redirect(destination);
  }

  if (branchId !== ALL_BRANCHES) {
    if (!isBranchUuid(branchId)) redirect(destination);

    const { data: branch } = await supabase
      .from("branches")
      .select("id, is_active")
      .eq("id", branchId)
      .maybeSingle();

    if (!branch || !branch.is_active) redirect(destination);
  }

  await writeActiveBranch(branchId);
  redirect(destination);
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
  redirect(destination);
}