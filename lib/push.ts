/**
 * Server-side helper untuk kirim push notification ke profil tertentu.
 * Direct webpush — no HTTP self-call.
 */
import * as webpush from "web-push";
import { adminClient } from "@/lib/supabase/admin";
import type { Role } from "@/lib/rbac";

type PushPayload = {
  profileIds: string[];
  title: string;
  body: string;
  url?: string;
  icon?: string;
};

/** Inisialisasi VAPID hanya saat dipanggil (runtime, bukan build time). */
function getWebpush() {
  const email = process.env.VAPID_EMAIL!;
  const subject = email.startsWith("mailto:") ? email : `mailto:${email}`;
  webpush.setVapidDetails(
    subject,
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!,
    process.env.VAPID_PRIVATE_KEY!,
  );
  return webpush;
}

export async function sendPushToProfiles({
  profileIds,
  title,
  body,
  url,
  icon,
}: PushPayload): Promise<void> {
  if (!profileIds.length) return;

  const db = adminClient();
  const { data: subs } = await db
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth")
    .in("profile_id", profileIds);

  if (!subs || subs.length === 0) return;

  const wp = getWebpush();
  const payload = JSON.stringify({
    title,
    body,
    url:   url  ?? "/dashboard",
    icon:  icon ?? "/rb-logo-new.png",
    badge: "/rb-logo-new.png",
    timestamp: Date.now(),
  });

  const expiredIds: string[] = [];

  await Promise.allSettled(
    subs.map(async (sub) => {
      try {
        await wp.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payload,
          { TTL: 86400 },
        );
      } catch (err: unknown) {
        const status = (err as { statusCode?: number }).statusCode;
        if (status === 410) {
          // Subscription expired — mark for cleanup
          expiredIds.push(sub.id);
        } else {
          console.error("[push] sendNotification failed for", sub.endpoint, err);
        }
      }
    })
  );

  // Auto-cleanup expired subscriptions
  if (expiredIds.length > 0) {
    const { error } = await db
      .from("push_subscriptions")
      .delete()
      .in("id", expiredIds);
    if (error) {
      console.error("[push] Failed to delete expired subscriptions:", error);
    }
  }
}

/**
 * Ambil profile_id semua staf yang perlu dapat notifikasi per cabang.
 */
export async function getNotifTargets(branchId: string, roles: Role[]): Promise<string[]> {
  const db = adminClient();
  const { data } = await db
    .from("profiles")
    .select("id")
    .eq("branch_id", branchId)
    .eq("is_active", true)
    .in("role", roles);
  return (data ?? []).map((p) => p.id);
}
