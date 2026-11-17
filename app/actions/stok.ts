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
  p_order_id?: string;
}): Promise<ActionResult> {
  const supabase = await createClient();

  const { error: rpcErr } = await (supabase as any).rpc("create_stock_claim", {
    p_item_id: params.p_item_id,
    p_quantity: params.p_quantity,
    p_note: params.p_note ?? null,
    p_order_id: params.p_order_id ?? null,
  });
  if (rpcErr) return { ok: false, message: rpcErr.message };

  revalidatePath("/stok");

  return { ok: true };
}

export async function createBundleClaimAction(params: {
  p_bundle_id: string;
  p_quantity: number;
  p_claim_type?: "produce" | "use";
  p_note?: string;
  p_order_id?: string;
}): Promise<ActionResult> {
  const supabase = await createClient();

  const { error: rpcErr } = await (supabase as any).rpc("create_bundle_claim", {
    p_bundle_id: params.p_bundle_id,
    p_quantity: params.p_quantity,
    p_claim_type: params.p_claim_type ?? "produce",
    p_note: params.p_note ?? null,
    p_order_id: params.p_order_id ?? null,
  });
  if (rpcErr) return { ok: false, message: rpcErr.message };

  revalidatePath("/stok");
  revalidatePath("/stok/racikan");

  return { ok: true };
}

export async function opnameBundleAction(params: {
  p_bundle_id: string;
  p_physical_qty: number;
  p_note?: string;
}): Promise<ActionResult> {
  const supabase = await createClient();

  const { error: rpcErr } = await (supabase as any).rpc("opname_bundle", {
    p_bundle_id: params.p_bundle_id,
    p_physical_qty: params.p_physical_qty,
    p_note: params.p_note ?? null,
  });
  if (rpcErr) return { ok: false, message: rpcErr.message };

  revalidatePath("/stok");
  revalidatePath("/stok/racikan");

  return { ok: true };
}

export async function confirmBundleClaimAction(
  claimId: string,
): Promise<ActionResult> {
  const supabase = await createClient();

  const { error: rpcErr } = await (supabase as any).rpc("confirm_bundle_claim", {
    p_claim_id: claimId,
  });
  if (rpcErr) return { ok: false, message: rpcErr.message };

  revalidatePath("/stok");
  revalidatePath("/stok/racikan");

  return { ok: true };
}

export async function rejectBundleClaimAction(
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
  revalidatePath("/stok/racikan");

  return { ok: true };
}

export async function setBundleDefinitionAction(params: {
  p_branch_id: string;
  p_bundle_name: string;
  p_unit: string;
  p_description?: string;
  p_components: { item_id: string; quantity: number }[];
  p_output_qty?: number;
  p_bundle_id?: string;
  p_current_stock?: number;
}): Promise<ActionResult> {
  const supabase = await createClient();

  let branchId = params.p_branch_id;
  if (!branchId) {
    branchId = (await getActorBranchId()) ?? "";
  }

  const { error: rpcErr } = await (supabase as any).rpc("set_bundle_definition", {
    p_branch_id: branchId || null,
    p_bundle_name: params.p_bundle_name,
    p_unit: params.p_unit,
    p_description: params.p_description ?? null,
    p_components: params.p_components,
    p_output_qty: params.p_output_qty ?? 1,
    p_bundle_id: params.p_bundle_id ?? null,
    p_current_stock: params.p_current_stock !== undefined ? params.p_current_stock : null,
  });
  if (rpcErr) return { ok: false, message: rpcErr.message };

  revalidatePath("/stok/racikan");
  revalidatePath("/pengaturan/resep");

  return { ok: true };
}

export async function opnameBundleBatchAction(params: {
  p_items: { bundle_id: string; physical_qty: number; note?: string }[];
  p_general_note?: string;
}): Promise<ActionResult> {
  const supabase = await createClient();

  const { error: rpcErr } = await (supabase as any).rpc("opname_bundle_batch", {
    p_items: params.p_items,
    p_general_note: params.p_general_note ?? null,
  });
  if (rpcErr) return { ok: false, message: rpcErr.message };

  revalidatePath("/stok");
  revalidatePath("/stok/racikan");

  return { ok: true };
}

export async function deleteBundleAction(bundleId: string): Promise<ActionResult> {
  const supabase = await createClient();

  const { error: rpcErr } = await (supabase as any).rpc("delete_bundle", {
    p_bundle_id: bundleId,
  });
  if (rpcErr) return { ok: false, message: rpcErr.message };

  revalidatePath("/stok/racikan");
  revalidatePath("/pengaturan/resep");

  return { ok: true };
}

export async function updateInventoryItemAction(params: {
  p_item_id: string;
  p_item_name: string;
  p_unit: string;
  p_min_stock_alert: number;
  p_purchase_unit: string;
  p_purchase_price: number;
  p_purchase_content_qty: number;
  p_current_stock?: number;
}): Promise<ActionResult> {
  const supabase = await createClient();

  const { error: rpcErr } = await (supabase as any).rpc("update_inventory_item", params);
  if (rpcErr) return { ok: false, message: rpcErr.message };

  revalidatePath("/stok");
  revalidatePath("/pengaturan/resep");

  return { ok: true };
}


