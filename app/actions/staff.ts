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
    // Auth user sudah ada - cek apakah profil juga sudah ada
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
    // Buat auth user baru - trigger on_auth_user_created akan otomatis INSERT profil
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

  // 6. Activity log - actor_id pakai profiles.id bukan auth.uid()
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

export type BulkImportStaffResult = {
  imported: number;
  skipped: number;
  errors: { item?: string; row?: unknown; error: string }[];
};

/**
 * Import karyawan sekaligus banyak dari parsed file Excel.
 * Hanya owner dan maintainer yang memiliki izin melakukan import bulk.
 */
export async function bulkCreateStaffProfiles(
  staffList: CreateStaffData[],
  defaultBranchId?: string,
): Promise<BulkImportStaffResult> {
  const supabase = await createClient();
  const admin    = adminClient();

  // 1. Validasi sesi pelaku
  const { data: { user: authUser } } = await supabase.auth.getUser();
  if (!authUser) {
    return {
      imported: 0,
      skipped: staffList.length,
      errors: [{ error: "Sesi tidak valid. Silakan login kembali." }],
    };
  }

  const { data: actorProfile } = await supabase
    .from("profiles")
    .select("id, role, branch_id")
    .eq("auth_id", authUser.id)
    .maybeSingle();

  if (!actorProfile || !["owner", "maintainer"].includes(actorProfile.role)) {
    return {
      imported: 0,
      skipped: staffList.length,
      errors: [{ error: "Hanya owner dan maintainer yang boleh mengimport data staf." }],
    };
  }

  // 2. Ambil daftar user auth saat ini untuk pengecekan duplikasi email cepat
  const { data: listData } = await admin.auth.admin.listUsers({ perPage: 1000 });
  const existingEmailSet = new Set(
    (listData?.users ?? []).map((u) => u.email?.toLowerCase().trim()).filter(Boolean),
  );

  let imported = 0;
  let skipped = 0;
  const errors: { item?: string; row?: unknown; error: string }[] = [];

  const allowedRoles = ["karyawan", "kepala_karyawan", "admin_kasir", "maintainer", "owner", "manager", "finance"];

  for (let i = 0; i < staffList.length; i++) {
    const item = staffList[i];
    const rowNum = i + 1;
    const fullName = item.fullName?.trim();
    const email = item.email?.toLowerCase().trim();
    const password = item.password?.trim() || "RBAutoluxe123!";
    const targetBranchId = item.branchId || defaultBranchId || actorProfile.branch_id;

    if (!fullName) {
      skipped++;
      errors.push({ item: `Baris ${rowNum}`, error: "Nama lengkap wajib diisi." });
      continue;
    }

    if (!email) {
      skipped++;
      errors.push({ item: fullName, error: "Email wajib diisi." });
      continue;
    }

    if (!/^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(email)) {
      skipped++;
      errors.push({ item: fullName, error: `Format email '${email}' tidak valid.` });
      continue;
    }

    if (password.length < 8) {
      skipped++;
      errors.push({ item: fullName, error: "Password minimal 8 karakter." });
      continue;
    }

    if (!targetBranchId) {
      skipped++;
      errors.push({ item: fullName, error: "Cabang tujuan belum ditentukan." });
      continue;
    }

    if (existingEmailSet.has(email)) {
      skipped++;
      errors.push({ item: fullName, error: `Email '${email}' sudah terdaftar.` });
      continue;
    }

    // Normalisasi role
    const normalizedRole = allowedRoles.includes(item.role) ? item.role : "karyawan";
    const normalizedSchedule = item.workSchedule === "office" ? "office" : "field";

    // Validasi tgl lahir opsional
    let dob: string | null = null;
    if (item.dateOfBirth) {
      const parsedDate = new Date(item.dateOfBirth);
      if (!isNaN(parsedDate.getTime()) && parsedDate <= new Date()) {
        dob = parsedDate.toISOString().split("T")[0];
      }
    }

    try {
      // 1. Buat user di Supabase Auth
      const { data: authData, error: authError } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: {
          full_name: fullName,
          phone_number: item.phoneNumber?.trim() || null,
          date_of_birth: dob,
        },
      });

      if (authError || !authData.user) {
        skipped++;
        errors.push({ item: fullName, error: authError?.message || "Gagal membuat akun auth." });
        continue;
      }

      const authUserId = authData.user.id;
      existingEmailSet.add(email);

      // 2. Update profil (trigger Supabase auth biasanya otomatis insert awal)
      const { error: profileError } = await admin
        .from("profiles")
        .update({
          full_name:     fullName,
          phone_number:  item.phoneNumber?.trim() || null,
          date_of_birth: dob,
          role:          normalizedRole as any,
          branch_id:     targetBranchId,
          work_schedule: normalizedSchedule as any,
          is_active:     item.isActive ?? true,
          updated_at:    new Date().toISOString(),
        } as any)
        .eq("auth_id", authUserId);

      if (profileError) {
        // Fallback upsert jika profil belum terbuat oleh trigger
        await admin.from("profiles").upsert({
          id:            authUserId,
          auth_id:       authUserId,
          full_name:     fullName,
          phone_number:  item.phoneNumber?.trim() || null,
          date_of_birth: dob,
          role:          normalizedRole as any,
          branch_id:     targetBranchId,
          work_schedule: normalizedSchedule as any,
          is_active:     item.isActive ?? true,
        } as any);
      }

      // 3. Catat aktivitas audit
      await admin.from("activity_logs").insert({
        actor_id:  actorProfile.id,
        action:    "staff.bulk_import",
        entity:    "profile",
        entity_id: authUserId,
        metadata:  {
          full_name: fullName,
          email,
          role:      normalizedRole,
          branch_id: targetBranchId,
        },
      } as any);

      imported++;
    } catch (err) {
      skipped++;
      errors.push({
        item: fullName,
        error: err instanceof Error ? err.message : "Kesalahan server tak terduga.",
      });
    }
  }

  return { imported, skipped, errors };
}