import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";
import { getClientIp, rateLimit } from "@/lib/rate-limit";

export async function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;

  if (path.startsWith("/track")) {
    const result = rateLimit(`track:${getClientIp(request)}`);
    if (result.limited) {
      return new NextResponse(
        JSON.stringify({ error: "Terlalu banyak permintaan. Coba lagi nanti." }),
        {
          status: 429,
          headers: {
            "content-type": "application/json",
            "retry-after": String(result.retryAfter),
          },
        },
      );
    }
  }

  return await updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Berkas statis dilepas dari middleware. mediapipe, sw.js, dan manifest
     * adalah berkas, bukan halaman. Kalau ikut dilewatkan, middleware
     * mengarahkan permintaan ke halaman masuk, dan pemanggilnya menerima
     * HTML padahal meminta WASM. Mesin pemindai wajah lalu gagal memuat tanpa
     * pesan yang jelas, karena yang gagal bukan halamannya.
     *
     * Daftar jenis berkas di bawah wajib lengkap. Font ikon dilayani dari
     * /public sebagai woff2; waktu woff2 belum ikut, middleware mengalihkannya
     * dengan 307, browser gagal mendekode berkas itu, dan setiap ikon berubah
     * menjadi teks nama ikon apa adanya. Nama-nama itu jauh lebih lebar
     * daripada glifnya, jadi seluruh tata letak ikut bergeser.
     */
    "/((?!_next/static|_next/image|favicon.ico|mediapipe|sw\\.js|manifest\\.json|fonts/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif|ico|wasm|task|woff2|woff|ttf|otf|eot)$).*)",
  ],
};
