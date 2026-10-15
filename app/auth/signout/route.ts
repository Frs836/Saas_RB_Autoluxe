import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Keluar dari akun.
 *
 * Pengalihan memakai 303 See Other, bukan 307 Temporary Redirect.
 *
 * 307 mempertahankan metode permintaan. Browser yang mengirim POST ke
 * /auth/signout akan ikut mengirim POST ke halaman tujuan, sedangkan halaman
 * /login hanya bisa dilayani dengan GET. Hasilnya 405 Method Not Allowed
 * setelah keluar, bukan halaman masuk.
 *
 * 303 memaksa permintaan berubah menjadi GET, sesuai kebutuhan: setelah keluar
 * sesi sudah tidak ada dan halaman tujuan memang harus dibaca lewat GET.
 */
async function keluar(request: NextRequest) {
  const supabase = await createClient();
  await supabase.auth.signOut();

  const tujuan = new URL("/login", request.url);
  tujuan.search = "";
  return NextResponse.redirect(tujuan, 303);
}

export async function POST(request: NextRequest) {
  return keluar(request);
}

export async function GET(request: NextRequest) {
  return keluar(request);
}
