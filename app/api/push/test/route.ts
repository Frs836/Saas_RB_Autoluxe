/**
 * Test endpoint: kirim push notification ke semua subscription milik user yang login.
 * Hanya aktif jika CRON_SECRET tersedia. Hapus setelah debugging selesai.
 */
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { sendPushToProfiles } from "@/lib/push";

export async function GET(req: NextRequest) {
  // Hanya bisa dipanggil dengan secret yang benar
  const secret = req.nextUrl.searchParams.get("secret");
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not logged in" }, { status: 401 });

  const { data: profile } = await supabase
    .from("profiles")
    .select("id")
    .eq("auth_id", user.id)
    .maybeSingle();

  if (!profile) return NextResponse.json({ error: "Profile not found" }, { status: 404 });

  // Kirim test push
  await sendPushToProfiles({
    profileIds: [profile.id],
    title: "✅ Test Push Berhasil",
    body: "Notifikasi device berfungsi. Waktu: " + new Date().toLocaleTimeString("id-ID"),
    url: "/dashboard",
  });

  return NextResponse.json({ ok: true, profileId: profile.id });
}
