/**
 * Menerjemahkan jalur objek di bucket foto profil menjadi URL publik.
 *
 * Fungsi ini sengaja tidak memakai awalan "use client". Halaman profil adalah
 * server component, dan mengimpor fungsi dari modul client lalu memanggilnya
 * saat render server berakhir dengan React error 441. Semula fungsi ini
 * berada di komponen client dan hanya belum terlihat karena avatar semua staf
 * masih kosong.
 */
export function urlAvatar(jalur: string | null | undefined): string | null {
  if (!jalur) return null;
  const dasar = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!dasar) return null;
  return `${dasar}/storage/v1/object/public/profile-avatars/${jalur}`;
}
