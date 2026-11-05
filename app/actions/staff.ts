"use server";

import { createClient } from "@/lib/supabase/server";
import { adminClient } from "@/lib/supabase/admin";

export type CreateStaffData = {
  fullName: string;
  email: string;
  phoneNumber?: string;
  dateOfBirth?: string;
  password: string;
  branchId?: string;
  role: "karyawan" | "admin_kasir" | "maintainer" | "owner" | "manager" | "finance" | "kepala_karyawan";
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
  const admin    = adminClient();

  // 1. Validasi input
  if (!data.fullName?.trim()) return { ok: false, message: "Nama lengkap wajib diisi." };
  if (!data.email?.trim())    return { ok: false, message: "Email wajib diisi." };
  if (!/^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(data.email))
    return { ok: false, message: "Format email tidak valid." };
  if (!data.password || data.password.length < 8)
    return { ok: false, message: "Password minimal 8 karakter." };
  if (data.dateOfBirth && new Date(data.dateOfBirth) > new Date())
    return { ok: false, message: "Tanggal lahir tidak boleh di masa depan." };

  // 2. Ambil sesi pelaku (anon client pakai cookies)
  const { data: { user: authUser } } = await supabase.auth.getUser();
  if (!authUser) return { ok: false, message: "Sesi tidak valid." };

  const { data: actorProfile } = await supabase
    .from("profiles")
    .select("id, role, branch_id")
    .eq("auth_id", authUser.id)
    .maybeSingle();

  if (!actorProfile) return { ok: false, message: "Profil pelaku tidak ditemukan." };

  if (!["owner", "maintainer"].includes(actorProfile.role))
    return { ok: false, message: "Hanya owner dan maintainer yang boleh menambah staf." };

  // 3. Tentukan cabang target
  const targetBranchId = data.branchId || actorProfile.branch_id;
  if (!targetBranchId) return { ok: false, message: "Cabang tujuan tidak ditentukan." };

  // 4. Cek email sudah ada di auth
  const { data: listData } = await admin.auth.admin.listUsers({ perPage: 1000 });
  const existingAuth = listData?.users?.find(
    (u) => u.email?.toLowerCase() === data.email.toLowerCase().trim()
  ) ?? null;

  let authUserId: string;

  if (existingAuth) {
    // Auth user sudah ada — cek apakah profil juga sudah ada
    const { data: existingProfile } = await admin
      .from("profiles")
      .select("id")
      .eq("auth_id", existingAuth.id)
      .maybeSingle();

    if (existingProfile) {
      return { ok: false, message: "Email sudah terdaftar. Gunakan email yang berbeda." };
    }
    authUserId = existingAuth.id;
    await admin.auth.admin.updateUserById(authUserId, {
      password:      data.password,
      email_confirm: true,
      user_metadata: { full_name: data.fullName.trim() },
    });
  } else {
    // Buat auth user baru — trigger on_auth_user_created akan otomatis INSERT profil
    // dengan role karyawan dan branch pertama. Kita UPDATE setelah itu.
    const { data: authData, error: authError } = await admin.auth.admin.createUser({
      email:         data.email.toLowerCase().trim(),
      password:      data.password,
      email_confirm: true,
      user_metadata: {
        full_name:     data.fullName.trim(),
        phone_number:  data.phoneNumber?.trim() || null,
        date_of_birth: data.dateOfBirth || null,
      },
    });
    if (authError) return { ok: false, message: authError.message };
    if (!authData.user) return { ok: false, message: "Gagal membuat user auth." };
    authUserId = authData.user.id;
  }

  // 5. UPDATE profil yang sudah dibuat trigger (atau orphaned) dengan data yang benar
  // Trigger sudah INSERT dengan role='karyawan', kita UPDATE dengan data aktual.
  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .update({
      full_name:     data.fullName.trim(),
      phone_number:  data.phoneNumber?.trim() || null,
      date_of_birth: data.dateOfBirth || null,
      role:          data.role as any,
      branch_id:     targetBranchId,
      work_schedule: (data.workSchedule || "field") as any,
      is_active:     data.isActive ?? true,
      updated_at:    new Date().toISOString(),
    } as any)
    .eq("auth_id", authUserId)
    .select()
    .single();

  if (profileError) {
    // Kalau UPDATE gagal (profil belum ada karena trigger delayed), coba INSERT
    const { data: insertedProfile, error: insertError } = await admin
      .from("profiles")
      .insert({
        auth_id:       authUserId,
        full_name:     data.fullName.trim(),
        phone_number:  data.phoneNumber?.trim() || null,
        date_of_birth: data.dateOfBirth || null,
        role:          data.role as any,
        branch_id:     targetBranchId,
        work_schedule: (data.workSchedule || "field") as any,
        is_active:     data.isActive ?? true,
      } as any)
      .select()
      .single();

    if (insertError) {
      if (!existingAuth) await admin.auth.admin.deleteUser(authUserId);
      return { ok: false, message: insertError.message };
    }
    return { ok: true, data: { profile: insertedProfile, authUserId } };
  }

  // 6. Activity log — actor_id pakai profiles.id bukan auth.uid()
  await admin.from("activity_logs").insert({
    actor_id:  actorProfile.id,
    action:    "staff.create",
    entity:    "profile",
    entity_id: (profile as any).id ?? authUserId,
    metadata:  {
      full_name: data.fullName.trim(),
      email:     data.email.toLowerCase().trim(),
      role:      data.role,
      branch_id: targetBranchId,
    },
  } as any);

  return { ok: true, data: { profile, authUserId } };
}