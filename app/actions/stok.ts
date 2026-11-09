"use server";

/**
 * Server actions untuk operasi stok.
 * Setelah stok klaim dikonfirmasi, cek apakah stok < 5 dan kirim notif.
 */
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { adminClient } from "@/lib/supabase/admin";
import { sendPushToProfiles, getNotifTargets } from "@/lib/push";

type ActionResult = { ok: true } | { ok: false; message: string };

/** Ambil branch_id dari pengguna yang sedang login. */
async function getActorBranchId(): Promise<string | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const db = adminClient();
  const { data: profile } = await db
    .from("profiles")
    .select("branch_id")
    .eq("auth_id", user.id)
    .maybeSingle();

  return (profile?.branch_id as string) ?? null;
}

export async function confirmStockClaimAction(
  claimId: string,
): Promise<ActionResult> {
  const supabase = await createClient();

  // Ambil info klaim sebelum konfirmasi untuk mendapatkan item_id dan quantity
  const db = adminClient();
  const { data: claim } = await db
    .from("stock_claims")
    .select("item_id, quantity")
    .eq("id", claimId)
    .maybeSingle();

  const { error: rpcErr } = await supabase.rpc("confirm_stock_claim", {
    p_claim_id: claimId,
  });
  if (rpcErr) return { ok: false, message: rpcErr.message };

  revalidatePath("/stok");

  void (async () => {
    try {
      if (!claim?.item_id) return;

      // Baca stok terbaru setelah konfirmasi
      const { data: item } = await db
        .from("inventory_items")
        .select("item_name, current_stock, branch_id")
        .eq("id", claim.item_id as string)
        .maybeSingle();

      if (!item) return;

      const currentStock = Number(item.current_stock ?? 0);
      if (currentStock >= 5) return; // Tidak perlu notif

      const branchId = (item.branch_id as string) ?? (await getActorBranchId());
      if (!branchId) return;

      const targets = await getNotifTargets(branchId, ["owner", "manager"]);
      if (targets.length > 0) {
        await sendPushToProfiles({
          profileIds: targets,
          title: "Stok Menipis",
          body: `Stok ${item.item_name} tersisa ${currentStock} unit. Segera lakukan restock.`,
          url: "/stok",
        });
      }
    } catch (err) {
      console.error("[push] confirmStockClaimAction notification failed:", err);
    }
  })();

  return { ok: true };
}

export async function rejectStockClaimAction(
  claimId: string,
  reason: string,
): Promise<ActionResult> {
  const supabase = await createClient();

  const { error: rpcErr } = await supabase.rpc("reject_stock_claim", {
    p_claim_id: claimId,
    p_reason: reason,
  });
  if (rpcErr) return { ok: false, message: rpcErr.message };

  revalidatePath("/stok");

  return { ok: true };
}

export async function recordStockInAction(params: {
  p_item_id: string;
  p_quantity: number;
  p_unit_cost?: number;
  p_note?: string;
}): Promise<ActionResult> {
  const supabase = await createClient();

  const { error: rpcErr } = await supabase.rpc("record_stock_in", params);
  if (rpcErr) return { ok: false, message: rpcErr.message };

  revalidatePath("/stok");

  return { ok: true };
}

export async function createStockClaimAction(params: {
  p_item_id: string;
  p_quantity: number;
  p_note?: string;
}): Promise<ActionResult> {
  const supabase = await createClient();

  const { error: rpcErr } = await supabase.rpc("create_stock_claim", params);
  if (rpcErr) return { ok: false, message: rpcErr.message };

  revalidatePath("/stok");

  return { ok: true };
}
