/**
 * Server-side helper untuk kirim push notification ke profil tertentu.
 * Dipakai dari server actions / RPCs setelah event penting.
 */
import { adminClient } from "@/lib/supabase/admin";

type PushPayload = {
  profileIds: string[];       // profil yang mau dapat notif
  title: string;
  body: string;
  url?: string;
  icon?: string;
};

export async function sendPushToProfiles({
  profileIds,
  title,
  body,
  url,
  icon,
}: PushPayload): Promise<void> {
  if (!profileIds.length) return;

  // Ambil semua subscriptions dari profile ids yang relevan
  const db = adminClient();
  const { data: subs } = await db
    .from("push_subscriptions")
    .select("endpoint, p256dh, auth")
    .in("profile_id", profileIds);

  if (!subs || subs.length === 0) return;

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://rb-autoluxe.vercel.app";

  try {
    await fetch(`${appUrl}/api/push/send`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-internal-secret": process.env.SUPABASE_SERVICE_ROLE_KEY!,
      },
      body: JSON.stringify({
        subscriptions: subs.map((s) => ({
          endpoint: s.endpoint,
          p256dh:   s.p256dh,
          auth:     s.auth,
        })),
        title,
        body,
        url:  url  ?? "/dashboard",
        icon: icon ?? "/rb-logo-new.png",
      }),
    });
  } catch {
    // Push failure tidak boleh crash flow utama
  }
}

/**
 * Ambil profile_id semua staf yang perlu dapat notifikasi per cabang.
 * Filter berdasarkan role yang relevan.
 */
export async function getNotifTargets(branchId: string, roles: string[]): Promise<string[]> {
  const db = adminClient();
  const { data } = await db
    .from("profiles")
    .select("id")
    .eq("branch_id", branchId)
    .eq("is_active", true)
    .in("role", roles);
  return (data ?? []).map((p) => p.id);
}
