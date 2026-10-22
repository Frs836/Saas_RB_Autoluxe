import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { USER_EMAIL_HEADER, USER_ID_HEADER } from "@/lib/session-headers";

const AUTH_PAGES = ["/login", "/register"];
const PUBLIC_PAGES = ["/track"];

/**
 * Identitas hasil verifikasi proxy diteruskan lewat header permintaan.
 *
 * Setiap halaman server tadinya memanggil `auth.getUser()` sendiri, padahal
 * proxy sudah melakukan panggilan yang sama beberapa milidetik sebelumnya.
 * Dua perjalanan bolak-balik ke layanan auth untuk satu permintaan halaman
 * menambah sekitar 230 ms pada setiap navigasi.
 *
 * Header selalu dihapus lebih dulu, lalu diisi ulang hanya dari hasil
 * verifikasi di sini. Dengan begitu header yang dikirim peramban sendiri tidak
 * pernah dipercaya: pengguna anonim yang memalsukannya tetap kehilangan
 * header itu, dan pengguna yang sah selalu ditimpa dengan id miliknya sendiri.
 */

export async function updateSession(request: NextRequest) {
  // Cookie hasil penyegaran sesi ditampung dulu, bukan langsung ditulis ke
  // respons, karena header permintaan baru ditentukan setelah getUser selesai.
  const pendingCookies: { name: string; value: string; options?: Record<string, unknown> }[] = [];

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
          pendingCookies.push(...cookiesToSet);
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

  if (user && isAuthPage) {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    url.search = "";
    return NextResponse.redirect(url);
  }

  /*
   * Pemeriksaan akun nonaktif tidak dilakukan di sini.
   *
   * RLS sudah menyaring baris profil yang is_active-nya false, sehingga akun
   * nonaktif berakhir dengan sesi tanpa profil dan diarahkan ke halaman
   * menunggu verifikasi. Menambah RPC khusus di proxy berarti satu perjalanan
   * jaringan tambahan pada setiap permintaan halaman.
   */

  const headers = new Headers(request.headers);
  headers.delete(USER_ID_HEADER);
  headers.delete(USER_EMAIL_HEADER);
  if (user) {
    headers.set(USER_ID_HEADER, user.id);
    if (user.email) headers.set(USER_EMAIL_HEADER, user.email);
  }

  const response = NextResponse.next({ request: { headers } });
  for (const cookie of pendingCookies) {
    response.cookies.set(
      cookie.name,
      cookie.value,
      cookie.options as Parameters<typeof response.cookies.set>[2],
    );
  }
  return response;
}
