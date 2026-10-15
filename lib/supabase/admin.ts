import { createClient as createSupabaseClient } from "@supabase/supabase-js";

/**
 * Klien Supabase dengan kunci service role, khusus di sisi server.
 *
 * Dipakai untuk membuat akun staf dari sisi owner atau maintainer. Pendaftaran
 * mandiri lewat auth.signUp selalu mengirim email konfirmasi, dan Supabase
 * membatasi jumlah email menjadi sedikit per jam. Saat beberapa staf
 * didaftarkan berurutan, permintaan kedua dan seterusnya ditolak dengan
 * "Email rate limit exceeded" meskipun tidak ada yang salah dari pemanggil.
 *
 * Dengan membuat akun lewat kunci service role, email_verify bisa diaktifkan
 * langsung tanpa mengirim apa pun. Staf tidak perlu membuka tautan, dan
 * pemilik workshop tidak perlu menunggu kuota email.
 *
 * Kunci ini tidak boleh pernah sampai ke bundel peramban. Nama variabelnya
 * sengaja tidak memakai prefix NEXT_PUBLIC_, dan modul ini hanya diimpor dari
 * server action, tidak pernah dari komponen klien.
 */

let cached: ReturnType<typeof createSupabaseClient> | null = null;

export function adminClient() {
  if (cached) return cached;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const kunci = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !kunci) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY belum diatur. Tanpa kunci itu akun staf tidak bisa dibuat dari server.",
    );
  }

  // Skema database sengaja dibiarkan longgar. Klien ini hanya dipakai untuk
  // membuat akun dan mengisi dua tabel, dan tanpa skema yang digenerate
  // TypeScript menyimpulkan tipe baris_insert sebagai never sehingga setiap
  // kolom yang ditulis dianggap tidak dikenal.
  cached = createSupabaseClient(url, kunci, {
    auth: { persistSession: false, autoRefreshToken: false },
    db: { schema: "public" },
  }) as unknown as ReturnType<typeof createSupabaseClient>;

  return cached;
}
