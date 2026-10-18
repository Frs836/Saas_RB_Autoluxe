import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const AUTH_PAGES = ["/login", "/register"];
const PUBLIC_PAGES = ["/track"];

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  const isAuthPage = AUTH_PAGES.some((route) => path.startsWith(route));
  const isAuthRoute = path.startsWith("/auth");
  const isPublicPage = PUBLIC_PAGES.some((route) => path.startsWith(route));

  if (!user && !isAuthPage && !isAuthRoute && !isPublicPage) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

    if (!user) return supabaseResponse;

  /*
   * Pemeriksaan akun nonaktif tidak lagi dilakukan di sini.
   *
   * Sebelumnya middleware memanggil RPC current_profile_state pada setiap
   * permintaan halaman. Itu satu perjalanan bolak-balik tambahan ke Supabase,
   * padahal getSessionProfile di setiap halaman server sudah memanggil
   * getUser dan membaca profilnya sendiri, dan RLS sudah menyaring baris
   * profil yang is_active-nya false sehingga akun nonaktif berakhir dengan
   * sesi tanpa profil dan diarahkan ke halaman masuk.
   *
   * Pengukuran produksi menunjukkan dampaknya nyata: server mulai mengirim
   * HTML dalam 190 milidetik, tetapi respons baru selesai sekitar 4,2 detik
   * karena dua panggilan jaringan ini menahan aliran. Middleware sekarang
   * hanya satu getUser, seperti sebelum RPC itu ditambahkan.
   */

  if (user && isAuthPage) {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}