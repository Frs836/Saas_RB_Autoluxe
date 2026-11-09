/**
 * Legacy internal endpoint — no longer called from lib/push.ts.
 * Kept for backward compatibility. VAPID init inside handler only.
 */
import { NextRequest, NextResponse } from "next/server";
import * as webpush from "web-push";

export async function POST(req: NextRequest) {
  const rawEmail = process.env.VAPID_EMAIL ?? "";
  if (!rawEmail || !process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) {
    return NextResponse.json({ error: "VAPID not configured" }, { status: 500 });
  }
  const vapidSubject = rawEmail.startsWith("mailto:") ? rawEmail : `mailto:${rawEmail}`;
  webpush.setVapidDetails(
    vapidSubject,
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!,
    process.env.VAPID_PRIVATE_KEY!,
  );

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
    title, body,
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
        { TTL: 86400 },
      )
    )
  );

  const failed  = results.filter((r) => r.status === "rejected");
  const success = results.filter((r) => r.status === "fulfilled");
  return NextResponse.json({ sent: success.length, failed: failed.length });
}
