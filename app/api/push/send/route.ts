/**
 * Internal API endpoint untuk mengirim push notification.
 * Dipanggil dari server actions setelah event penting.
 * Protected dengan SUPABASE_SERVICE_ROLE_KEY di header.
 */
import { NextRequest, NextResponse } from "next/server";
import * as webpush from "web-push";

export async function POST(req: NextRequest) {
  // Inisialisasi VAPID di dalam handler agar tidak crash saat build
  const rawEmail = process.env.VAPID_EMAIL!;
  const vapidSubject = rawEmail.startsWith("mailto:") ? rawEmail : `mailto:${rawEmail}`;
  webpush.setVapidDetails(
    vapidSubject,
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!,
    process.env.VAPID_PRIVATE_KEY!,
  );

  // Validasi internal secret
  const auth = req.headers.get("x-internal-secret");
  if (auth !== process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { subscriptions, title, body, url, icon } = await req.json() as {
    subscriptions: { endpoint: string; p256dh: string; auth: string }[];
    title: string;
    body: string;
    url?: string;
    icon?: string;
  };

  const payload = JSON.stringify({
    title,
    body,
    url:  url  ?? "/dashboard",
    icon: icon ?? "/rb-logo-new.png",
    badge: "/rb-logo-new.png",
    timestamp: Date.now(),
  });

  const results = await Promise.allSettled(
    subscriptions.map((sub) =>
      webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        payload,
        { TTL: 86400 }, // 24 jam
      )
    )
  );

  const failed  = results.filter((r) => r.status === "rejected");
  const success = results.filter((r) => r.status === "fulfilled");

  return NextResponse.json({ sent: success.length, failed: failed.length });
}
