"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type AccountActionResult = {
  ok: boolean;
  message: string;
  field?: "nama" | "telepon" | "tanggalLahir" | "email" | "sandi";
};

/**
 * Pengaturan akun mandiri: data diri, email, kata sandi, dan foto profil.
 *
 * Setiap perubahan data privat melewati daftar putih kolom dan satu profil
 * milik pemanggil. Nilai apa pun yang tidak disebut di sini tidak pernah
 * diteruskan ke database, jadi menambah field baru di formulir tidak
 * otomatis berarti kolom itu bisa diubah.
 *
 * Kolom yang dikunci trigger yang sudah ada, yaitu role, auth_id, is_active,
 * default_off_day, dan branch_id, tetap tidak bisa disentuh dari sini.
 * Staf mengubah dirinya sendiri, bukan kelayakan atau penempatannya.
 */

const MIN_SANDI = 8;
const MAKS_NAMA = 120;
const MAKS_TELEPON = 25;

function potong(nilai: string, maks: number): string {
  return nilai.trim().slice(0, maks);
}

/**
 * Mengambil sesi dan profil milik pemanggil.
 *
 * Query selalu disaring auth_id dari sesi, bukan id profil kiriman, sehingga
 * nilai apa pun dari client tidak pernah menentukan baris yang diubah.
 */
async function konteksPemilik() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profil } = await supabase
    .from("profiles")
    .select("id, auth_id, full_name, phone_number, date_of_birth")
    .eq("auth_id", user.id)
    .maybeSingle();

  if (!profil) return null;
  return { supabase, user, profil };
}

/**
 * Memverifikasi password lama.
 *
 * `signInWithPassword` membuat session baru di Supabase Auth bahkan dengan
 * `persistSession: false` (yang hanya menonaktifkan penyimpanan lokal, bukan
 * pembuatan session di server). Session tersebut langsung di-revoke setelah
 * verifikasi agar tidak mengonsumsi slot session pengguna dan tidak
 * memengaruhi sesi yang sedang aktif.
 *
 * Pendekatan ini tetap mengonsumsi satu slot dari rate limit Supabase Auth
 * (60 sign-in/jam per email di free tier). Jika kelak rate limit menjadi
 * masalah, pertimbangkan migrasi ke flow reauthenticate() + OTP.
 */
async function verifikasiPasswordLama(
  email: string,
  passwordLama: string,
): Promise<{ ok: true } | { ok: false; pesan: string }> {
  const { createClient: buatKlien } = await import("@supabase/supabase-js");

  const cek = buatKlien(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  const { data, error } = await cek.auth.signInWithPassword({ email, password: passwordLama });
  if (error) return { ok: false, pesan: "Password lama tidak cocok." };

  // Revoke session yang baru saja dibuat agar tidak meninggalkan session
  // aktif yang tidak terpakai di Supabase Auth.
  if (data.session?.access_token) {
    await cek.auth.signOut({ scope: "local" });
  }

  return { ok: true };
}

export async function simpanDataDiri(input: {
  nama: string;
  telepon: string;
  tanggalLahir: string;
}): Promise<AccountActionResult> {
  const konteks = await konteksPemilik();
  if (!konteks) return { ok: false, message: "Sesi berakhir. Silakan masuk kembali." };

  const nama = potong(input.nama, MAKS_NAMA);
  if (nama.length < 2) {
    return { ok: false, message: "Nama minimal 2 huruf.", field: "nama" };
  }

  const telepon = potong(input.telepon.replace(/[^\d+]/g, ""), MAKS_TELEPON);
  const digitTelepon = telepon.replace(/\D/g, "");
  if (digitTelepon.length > 0 && digitTelepon.length < 8) {
    return { ok: false, message: "Nomor telepon tidak lengkap.", field: "telepon" };
  }

  // Formulir mengirim string kosong saat tanggal lahir dikosongkan. Kolomnya
  // bertipe date, jadi nilai kosong harus jadi null, bukan string kosong.
  const tanggalLahir = input.tanggalLahir ? input.tanggalLahir : null;
  if (tanggalLahir && !/^\d{4}-\d{2}-\d{2}$/.test(tanggalLahir)) {
    return { ok: false, message: "Tanggal lahir tidak valid.", field: "tanggalLahir" };
  }
  if (tanggalLahir && new Date(tanggalLahir) > new Date()) {
    return {
      ok: false,
      message: "Tanggal lahir tidak bisa di masa depan.",
      field: "tanggalLahir",
    };
  }

  const { error } = await konteks.supabase
    .from("profiles")
    .update({
      full_name: nama,
      phone_number: digitTelepon.length > 0 ? telepon : null,
      date_of_birth: tanggalLahir,
    })
    .eq("id", konteks.profil.id);

  if (error) return { ok: false, message: `Gagal menyimpan: ${error.message}` };

  revalidatePath("/profil");
  revalidatePath("/dashboard");
  return { ok: true, message: "Data diri berhasil disimpan." };
}

export async function gantiEmail(input: {
  emailBaru: string;
  passwordLama: string;
}): Promise<AccountActionResult> {
  const konteks = await konteksPemilik();
  if (!konteks) return { ok: false, message: "Sesi berakhir. Silakan masuk kembali." };

  const emailBaru = potong(input.emailBaru.toLowerCase(), 160);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailBaru)) {
    return { ok: false, message: "Format email tidak valid.", field: "email" };
  }
  if (emailBaru === (konteks.user.email ?? "").toLowerCase()) {
    return { ok: false, message: "Email baru sama dengan email sekarang.", field: "email" };
  }

  const cek = await verifikasiPasswordLama(konteks.user.email ?? "", input.passwordLama);
  if (!cek.ok) return { ok: false, message: cek.pesan, field: "email" };

  // Email hidup di auth.users, bukan di profiles. Keunikan dijaga Supabase,
  // jadi pelanggaran keunikan dari sini diterjemahkan menjadi kalimat yang
  // bisa dibaca staf, bukan kode database.
  const { error } = await konteks.supabase.auth.updateUser({ email: emailBaru });
  if (error) {
    if (/already been registered|already exists|duplicate/i.test(error.message)) {
      return { ok: false, message: "Email sudah dipakai akun lain.", field: "email" };
    }
    return { ok: false, message: `Gagal mengganti email: ${error.message}`, field: "email" };
  }

  revalidatePath("/profil");
  return {
    ok: true,
    message: `Tautan konfirmasi dikirim ke ${emailBaru}. Email aktif berubah setelah tautan itu dibuka.`,
  };
}

export async function gantiSandi(input: {
  passwordLama: string;
  passwordBaru: string;
  ulangiSandi: string;
}): Promise<AccountActionResult> {
  const konteks = await konteksPemilik();
  if (!konteks) return { ok: false, message: "Sesi berakhir. Silakan masuk kembali." };

  if (input.passwordBaru !== input.ulangiSandi) {
    return { ok: false, message: "Pengulangan kata sandi tidak sama.", field: "sandi" };
  }
  if (input.passwordBaru.length < MIN_SANDI) {
    return { ok: false, message: `Kata sandi minimal ${MIN_SANDI} karakter.`, field: "sandi" };
  }
  if (input.passwordBaru === input.passwordLama) {
    return { ok: false, message: "Kata sandi baru sama dengan yang lama.", field: "sandi" };
  }

  const cek = await verifikasiPasswordLama(konteks.user.email ?? "", input.passwordLama);
  if (!cek.ok) return { ok: false, message: cek.pesan, field: "sandi" };

  const { error } = await konteks.supabase.auth.updateUser({
    password: input.passwordBaru,
  });
  if (error) {
    if (/reauth|session|invalid/i.test(error.message)) {
      return {
        ok: false,
        message: "Sesi tidak memenuhi syarat. Keluar lalu masuk kembali, lalu ulangi.",
        field: "sandi",
      };
    }
    return {
      ok: false,
      message: `Gagal mengganti kata sandi: ${error.message}`,
      field: "sandi",
    };
  }

  return { ok: true, message: "Kata sandi berhasil diganti." };
}

/** Menyimpan foto profil baru. Caller mengunggah berkasnya lebih dulu. */
export async function simpanAvatar(jalurBaru: string): Promise<AccountActionResult> {
  const konteks = await konteksPemilik();
  if (!konteks) return { ok: false, message: "Sesi berakhir. Silakan masuk kembali." };

  if (!jalurBaru.toLowerCase().startsWith(`${konteks.profil.auth_id}/`.toLowerCase())) {
    return { ok: false, message: "Foto profil hanya dapat disimpan di folder sendiri." };
  }

  const { error } = await konteks.supabase
    .from("profiles")
    .update({ avatar_path: jalurBaru })
    .eq("id", konteks.profil.id);
  if (error) return { ok: false, message: `Gagal menyimpan foto: ${error.message}` };

  revalidatePath("/profil");
  return { ok: true, message: "Foto profil diperbarui." };
}

/** Menghapus foto profil beserta berkasnya di storage. */
export async function hapusAvatar(jalurLama: string): Promise<AccountActionResult> {
  const konteks = await konteksPemilik();
  if (!konteks) return { ok: false, message: "Sesi berakhir. Silakan masuk kembali." };

  if (!jalurLama.toLowerCase().startsWith(`${konteks.profil.auth_id}/`.toLowerCase())) {
    return { ok: false, message: "Foto profil tidak bisa dihapus." };
  }

  await konteks.supabase.storage.from("profile-avatars").remove([jalurLama]);
  const { error } = await konteks.supabase
    .from("profiles")
    .update({ avatar_path: null })
    .eq("id", konteks.profil.id);
  if (error) return { ok: false, message: `Gagal menghapus foto: ${error.message}` };

  revalidatePath("/profil");
  return { ok: true, message: "Foto profil dihapus." };
}
