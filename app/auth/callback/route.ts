import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Validasi parameter `next` agar hanya menerima path relatif.
 *
 * Penyerang dapat mengirim "next=//evil.com/phishing" dan beberapa browser
 * menafsirkannya sebagai absolute URL. Pembatasan di bawah memastikan:
 *   1. Nilai harus diawali "/" (path relatif, bukan protokol).
 *   2. Nilai tidak boleh diawali "//" (protocol-relative URL).
 *   3. Nilai tidak mengandung karakter newline atau carriage return (header
 *      injection via redirect Location header).
 */
function safeReturnTo(raw: string | null, fallback = "/dashboard"): string {
  if (!raw) return fallback;
  const sanitized = raw.split(/[\r\n]/)[0] ?? fallback;
  if (sanitized.startsWith("/") && !sanitized.startsWith("//")) {
    return sanitized;
  }
  return fallback;
}

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = safeReturnTo(searchParams.get("next"));

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  return NextResponse.redirect(`${origin}/login`);
}
