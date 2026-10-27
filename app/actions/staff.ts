"use server";

import { createClient } from "@/lib/supabase/server";
import { hash } from "bcryptjs";

export type CreateStaffData = {
  fullName: string;
  email: string;
  phoneNumber?: string;
  dateOfBirth?: string;
  password: string;
  branchId?: string;
  role: "karyawan" | "admin_kasir" | "maintainer" | "owner";
  workSchedule?: "field" | "office";
  isActive?: boolean;
};

export type CreateStaffResult =
  | { ok: true; data: { profile: any; authUserId: string } }
  | { ok: false; message: string };

/**
 * Membuat profil staf baru dengan hashing password di sisi Node.js (bcryptjs).
 * Menggantikan RPC create_staff_profile yang menggunakan crypt() di PostgreSQL
 * yang memerlukan ekstensi pgcrypto.
 * 
 * Hanya owner dan maintainer yang boleh menambah staf.
 */
export async function createStaffProfile(data: CreateStaffData): Promise<CreateStaffResult> {
  const supabase = await createClient();

  // 1. Validasi input dasar
  if (!data.fullName?.trim()) return { ok: false, message: "Nama lengkap wajib diisi." };
  if (!data.email?.trim()) return { ok: false, message: "Email wajib diisi." };
  if (!/^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(data.email)) {
    return { ok: false, message: "Format email tidak valid." };
  }
  if (!data.password || data.password.length < 8) {
    return { ok: false, message: "Password minimal 8 karakter." };
  }
  if (data.dateOfBirth && new Date(data.dateOfBirth) > new Date()) {
    return { ok: false, message: "Tanggal lahir tidak boleh di masa depan." };
  }

  // 2. Authorization: cek sesi dan profil pelaku
  const { data: { user: authUser } } = await supabase.auth.getUser();
  if (!authUser) {
    console.error("[createStaffProfile] Auth user not found");
    return { ok: false, message: "Sesi tidak valid." };
  }

  const { data: actorProfile, error: actorError } = await supabase
    .from("profiles")
    .select("role, branch_id")
    .eq("auth_id", authUser.id)
    .maybeSingle();

  if (actorError) {
    console.error("[createStaffProfile] Failed to fetch actor profile:", actorError);
    return { ok: false, message: "Gagal memverifikasi profil pelaku." };
  }
  if (!actorProfile) {
    console.error("[createStaffProfile] Actor profile not found for user:", authUser.id);
    return { ok: false, message: "Profil pelaku tidak ditemukan." };
  }

  // Hanya owner dan maintainer yang boleh menambah staf
  if (!["owner", "maintainer"].includes(actorProfile.role)) {
    console.warn("[createStaffProfile] Access denied for role:", actorProfile.role);
    return { ok: false, message: "Hanya owner dan maintainer yang boleh menambah staf." };
  }

  // 3. Branch access check
  const targetBranchId = data.branchId || actorProfile.branch_id;
  if (!targetBranchId) {
    console.error("[createStaffProfile] No target branch ID");
    return { ok: false, message: "Cabang tujuan tidak ditentukan." };
  }

  // Validasi akses cabang untuk owner/maintainer
  const { data: canAccess } = await supabase.rpc("can_access_branch", {
    p_branch_id: targetBranchId,
  });
  if (!canAccess) {
    console.warn("[createStaffProfile] Branch access denied for:", targetBranchId, "actor:", actorProfile.role);
    return { ok: false, message: "Cabang tujuan tidak dapat diakses." };
  }

  // 4. Hash password menggunakan bcryptjs (Node.js) - tidak butuh pgcrypto di DB
  const passwordHash = await hash(data.password, 12);

  // 5. Buat auth user via Supabase Admin API
  const { data: authData, error: authError } = await supabase.auth.admin.createUser({
    email: data.email.toLowerCase().trim(),
    password: data.password,
    email_confirm: true,
    user_metadata: { full_name: data.fullName.trim() },
  });

  if (authError) return { ok: false, message: authError.message };
  if (!authData.user) return { ok: false, message: "Gagal membuat user auth." };

  const authUserId = authData.user.id;

  // 6. Buat profil staf
  const profileInsert = {
    id: authUserId,
    auth_id: authUserId,
    full_name: data.fullName.trim(),
    email: data.email.toLowerCase().trim(),
    phone_number: data.phoneNumber?.trim() || null,
    date_of_birth: data.dateOfBirth || null,
    role: data.role,
    branch_id: targetBranchId,
    work_schedule: data.workSchedule || "field",
    is_active: data.isActive ?? true,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const { data: profile, error: profileError } = await (supabase
    .from("profiles")
    .insert(profileInsert as any)
    .select()
    .single() as any);

  if (profileError) {
    // Rollback auth user jika gagal buat profil
    await supabase.auth.admin.deleteUser(authUserId);
    return { ok: false, message: profileError.message };
  }

  // 7. Activity log
  await supabase.from("activity_logs").insert({
    actor_id: authUser.id,
    action: "staff.create",
    entity: "profile",
    entity_id: authUserId,
    metadata: {
      full_name: data.fullName.trim(),
      email: data.email.toLowerCase().trim(),
      role: data.role,
    },
  });

  return { ok: true, data: { profile, authUserId } };
}