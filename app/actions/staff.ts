"use server";

import { revalidatePath } from "next/cache";
import { adminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/rbac";

export type StaffResult =
  | { ok: true; message: string; userId: string }
  | { ok: false; message: string };

/**
 * Membuat akun staf dari sisi owner atau maintainer.
 *
 * Pendaftaran mandiri lewat auth.signUp selalu mengirim email konfirmasi.
 * Supabase membatasi jumlah email menjadi sedikit per jam, jadi ketika beberapa
 * staf didaftarkan berurutan, permintaan kedua dan seterusnya ditolak dengan
 * "Email rate limit exceeded" tanpa ada kesalahan dari pemanggil.
 *
 * Di sini akun dibuat dengan kunci service role sehingga email_verify bisa
 * diaktifkan tanpa mengirim email sama sekali. Staf menerima kredensialnya dari
 * maintainer, lalu masuk dengan kata sandi itu dan bisa menggantinya sendiri.
 */
export async function createStaffAccount(input: {
  email: string;
  password: string;
  fullName: string;
  role: "karyawan" | "admin_kasir" | "maintainer";
  branchId: string;
  workSchedule: "field" | "office";
}): Promise<StaffResult> {
  const email = input.email.trim().toLowerCase();
  const fullName = input.fullName.trim();

  if (!fullName) return { ok: false, message: "Nama lengkap wajib diisi." };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    return { ok: false, message: "Format email tidak valid." };
  if (input.password.length < 8)
    return { ok: false, message: "Kata sandi minimal 8 karakter." };

  // Izin diperiksa dengan sesi pengguna, bukan dengan kunci service role,
  // supaya peran ini tidak bisa dipakai untuk membuat akun di luar
  // kendali pemilik workshop.
  const sesi = await createClient();
  const {
    data: { user: pengguna },
  } = await sesi.auth.getUser();
  if (!pengguna) return { ok: false, message: "Sesi tidak valid, masuk ulang." };

  const { data: profil } = await sesi
    .from("profiles")
    .select("role")
    .eq("auth_id", pengguna.id)
    .maybeSingle();

  if (!profil || !can(profil.role, "staff.manage")) {
    return {
      ok: false,
      message: "Hanya owner dan maintainer yang bisa menambah staf.",
    };
  }

  // Hanya owner yang boleh membuat akun dengan hak owner atau maintainer.
  if (
    (input.role === "maintainer" || input.role === "admin_kasir") &&
    profil.role !== "owner"
  ) {
    return {
      ok: false,
      message: "Hanya owner yang bisa menambah akun maintainer atau admin kasir.",
    };
  }

  const admin = adminClient();

  const { data: dibuat, error: buatError } = await admin.auth.admin.createUser({
    email,
    password: input.password,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  });

  if (buatError) {
    if (/already been registered|already exists/i.test(buatError.message)) {
      return { ok: false, message: "Email ini sudah terdaftar." };
    }
    return { ok: false, message: buatError.message };
  }

  if (!dibuat?.user) {
    return { ok: false, message: "Akun dibuat tetapi tidak mengembalikan id." };
  }

  const { data: profilPemanggil } = await sesi
    .from("profiles")
    .select("id")
    .eq("auth_id", pengguna.id)
    .maybeSingle();

  /*
   * Bentuk larik dengan tipe baris yang longgar.
   *
   * Klien service role dibuat tanpa skema yang digenerate, sehingga TypeScript
   * menyimpulkan tipe baris sisipan sebagai never dan menolak kolom apa pun.
   * Menulis tipe baris secara eksplisit lebih jujur daripada memakai
   * pencekalan yang memblokir pemeriksaan tipe di berkas ini.
   */
  type BarisProfil = {
    auth_id: string;
    full_name: string;
    email: string;
    role: string;
    branch_id: string;
    work_schedule: string;
    is_active: boolean;
  };

  const barisProfil: BarisProfil = {
    auth_id: dibuat.user.id,
    full_name: fullName,
    email,
    role: input.role,
    branch_id: input.branchId,
    work_schedule: input.workSchedule,
    is_active: true,
  };

  const { error: profilError } = await admin
    .from("profiles")
    .insert([barisProfil as never]);

  if (profilError) {
    // Jangan tinggalkan akun yatim di tabel auth kalau profilnya gagal.
    await admin.auth.admin.deleteUser(dibuat.user.id);
    return { ok: false, message: profilError.message };
  }

  const barisLog = {
    actor_id: profilPemanggil?.id ?? null,
    action: "staff.account_created",
    entity: "profiles",
    entity_id: null,
    metadata: { email, role: input.role, full_name: fullName },
  };

  await admin.from("activity_logs").insert([barisLog as never]);

  revalidatePath("/pengaturan/karyawan");
  revalidatePath("/pengaturan/cabang");

  return {
    ok: true,
    message: `Akun ${fullName} dibuat. Beri kata sandi ini kepada yang bersangkutan.`,
    userId: dibuat.user.id,
  };
}
