import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  can,
  toRole,
  type Permission,
  type Role,
} from "@/lib/rbac";

export type SessionProfile = {
  id: string;
  authId: string;
  email: string;
  fullName: string;
  role: Role;
  branchId: string | null;
  shiftId: string | null;
};

/**
 * Sumber tunggal untuk data sesi di server component.
 * Menggantikan query `profiles` yang disalin ke setiap halaman.
 */
export async function getSessionProfile(): Promise<SessionProfile | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const { data } = await supabase
    .from("profiles")
    .select("id, auth_id, full_name, role, branch_id, shift_id")
    .eq("auth_id", user.id)
    .maybeSingle();

  if (!data) return null;

  return {
    id: data.id,
    authId: data.auth_id,
    email: user.email ?? "",
    fullName: data.full_name ?? user.email ?? "Staf",
    role: toRole(data.role),
    branchId: (data.branch_id as string | null) ?? null,
    shiftId: (data.shift_id as string | null) ?? null,
  };
}

/**
 * Gerbang halaman: redirect ke /login bila belum masuk, ke /dashboard bila
 * role tidak punya izin, sebelum halaman menjalankan query apa pun.
 *
 * Dipakai sebagai ganti gate inline `PRIVILEGED.includes(role)` yang
 * tersebar di app/pos, app/stok, app/laporan, dan seterusnya.
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