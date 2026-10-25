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

  /*
   * Idempotency check: email mungkin sudah ada di auth.users karena
   * percobaan sebelumnya crash setelah createUser tapi sebelum profil
   * diperbarui (orphaned user). Dalam kondisi itu, error "already registered"
   * adalah sinyal untuk memeriksa apakah profil masih berisi data default
   * dari trigger dan memperbaikinya, bukan langsung menolak permintaan.
   */
  let authUserId: string | null = null;

  const { data: dibuat, error: buatError } = await admin.auth.admin.createUser({
    email,
    password: input.password,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  });

  if (buatError) {
    if (/already been registered|already exists/i.test(buatError.message)) {
      // Coba temukan user yang sudah ada dan periksa apakah profilnya
      // masih berisi data default (orphaned dari crash sebelumnya).
      const { data: existingUsers } = await admin.auth.admin.listUsers();
      const existing = existingUsers?.users?.find((u) => u.email === email);
      if (!existing) {
        return { ok: false, message: "Email ini sudah terdaftar." };
      }
      const { data: existingProfile } = await admin
        .from("profiles")
        .select("id, role, branch_id, is_active")
        .eq("auth_id", existing.id)
        .maybeSingle();
      const ep = existingProfile as { id: string; role: string; branch_id: string | null; is_active: boolean } | null;
      // Profil yang sudah aktif dan punya role yang benar berarti
      // akun ini memang sudah dibuat sepenuhnya — tolak sebagai duplikat.
      if (ep && ep.is_active && ep.role !== "karyawan") {
        return { ok: false, message: "Email ini sudah terdaftar." };
      }
      // Profil masih default (role "karyawan", is_active false, atau
      // branch_id kosong) → ini orphaned user dari crash sebelumnya.
      // Lanjutkan dengan memperbaiki profilnya.
      authUserId = existing.id;
    } else {
      return { ok: false, message: buatError.message };
    }
  } else {
    if (!dibuat?.user) {
      return { ok: false, message: "Akun dibuat tetapi tidak mengembalikan id." };
    }
    authUserId = dibuat.user.id;
  }

  if (!authUserId) {
    return { ok: false, message: "Gagal menentukan ID akun." };
  }
  const { data: profilPemanggil } = await sesi
    .from("profiles")
    .select("id")
    .eq("auth_id", pengguna.id)
    .maybeSingle();
  /*
   * Bentuk larik dengan tipe baris yang longgar.
   *
  /*
   * Profil tidak disisipkan di sini.
   *
   * Tabel auth.users punya trigger on_auth_user_created yang sudah membuat
   * baris profil begitu akun dibuat, lengkap dengan peran karyawan dan
   * cabang pertama. Menyisipkan baris kedua untuk auth_id yang sama bentrok
   * dengan unique index profiles_auth_id_key, dan seluruh pembuatan akun
   * gagal walaupun email dan kata sandinya sudah benar.
   *
   * Yang dilakukan adalah memperbarui baris yang sudah dibuat trigger itu.
   */
  const { error: profilError } = await admin
    .from("profiles")
    .update({
      full_name: fullName,
      role: input.role,
      branch_id: input.branchId,
      work_schedule: input.workSchedule,
      is_active: true,
    } as never)
    .eq("auth_id", authUserId);

  if (profilError) {
    // Jangan tinggalkan akun yatim di tabel auth kalau profilnya gagal.
    await admin.auth.admin.deleteUser(authUserId);
    return { ok: false, message: profilError.message };
  }

  // Kalau trigger itu tidak berjalan, profilnya tidak akan ada dan
  // akun yang baru dibuat tidak akan bisa masuk sama sekali.
  const { data: profilBaru } = await admin
    .from("profiles")
    .select("id")
    .eq("auth_id", authUserId)
    .maybeSingle();

  const adaProfil = profilBaru as { id: string } | null;

  if (!adaProfil) {
    await admin.auth.admin.deleteUser(authUserId);
    return {
      ok: false,
      message:
        "Profil tidak terbentuk. Periksa apakah trigger on_auth_user_created masih ada di database.",
    };
  }

  const barisLog = {
    actor_id: profilPemanggil?.id ?? null,
    action: "staff.account_created",
    entity: "profiles",
    entity_id: adaProfil.id,
    metadata: { email, role: input.role, full_name: fullName },
  };

  await admin.from("activity_logs").insert([barisLog as never]);
  revalidatePath("/pengaturan/karyawan");
  revalidatePath("/pengaturan/cabang");
  return {
    ok: true,
    message: `Akun ${fullName} dibuat. Beri kata sandi ini kepada yang bersangkutan.`,
    userId: authUserId,
  };
}
