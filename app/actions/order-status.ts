"use server";

/**
 * Server actions untuk transisi status order.
 * Setiap action memanggil RPC lalu mengirim push notification.
 */
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { adminClient } from "@/lib/supabase/admin";
import { sendPushToProfiles, getNotifTargets } from "@/lib/push";

type OrderStatus =
  | "queued"
  | "in_progress"
  | "qc_review"
  | "completed"
  | "cancelled"
  | "menunggu_pembayaran"
  | "menunggu_diambil"
  | "diserahkan";

type ActionResult = { ok: true } | { ok: false; message: string };

/** Ambil info order (order_number, license_plate, branch_id, team) dari DB. */
async function getOrderInfo(orderId: string) {
  const db = adminClient();
  const { data: order } = await db
    .from("orders")
    .select("id, order_number, license_plate, branch_id")
    .eq("id", orderId)
    .maybeSingle();

  const { data: team } = await db
    .from("order_team_members")
    .select("profile_id")
    .eq("order_id", orderId);

  return {
    order_number: (order?.order_number as string) ?? "",
    license_plate: (order?.license_plate as string) ?? "",
    branch_id: (order?.branch_id as string) ?? null,
    teamIds: (team ?? []).map((t) => t.profile_id as string).filter(Boolean),
  };
}

/**
 * Ubah status order (queued → in_progress, in_progress → qc_review, dll).
 * Dipakai oleh order queue dan order detail.
 *
 * Notifikasi dikirim sesuai event:
 * - in_progress : owner, manager, admin_kasir + teknisi yang ditugaskan
 * - qc_review   : tidak ada notifikasi tambahan (sudah dihandle di UI)
 * - completed   : owner, manager, admin_kasir, finance
 * - in_progress dari qc_review (QC ditolak): teknisi yang ditugaskan
 */
export async function applyOrderStatusAction(
  orderId: string,
  status: OrderStatus,
): Promise<ActionResult> {
  const supabase = await createClient();

  // Cek status sebelumnya untuk membedakan QC reject vs mulai baru
  const { data: currentOrder } = await supabase
    .from("orders")
    .select("status, branch_id")
    .eq("id", orderId)
    .maybeSingle();

  const prevStatus = (currentOrder?.status as string) ?? "";

  const { error: rpcErr } = await supabase.rpc("apply_order_status", {
    p_order_id: orderId,
    p_status: status,
  });

  if (rpcErr) return { ok: false, message: rpcErr.message };

  revalidatePath("/pos/orders");
  revalidatePath(`/pos/orders/${orderId}`);

  // Kirim push notification secara async — tidak boleh crash action
  void (async () => {
    try {
      const { order_number, license_plate, branch_id, teamIds } =
        await getOrderInfo(orderId);
      if (!branch_id) return;

      if (status === "in_progress" && prevStatus === "queued") {
        // A) Order mulai dikerjakan
        const managerIds = await getNotifTargets(branch_id, [
          "owner",
          "manager",
          "admin_kasir",
        ]);
        const targets = Array.from(new Set([...managerIds, ...teamIds]));
        if (targets.length > 0) {
          await sendPushToProfiles({
            profileIds: targets,
            title: "Order Mulai Dikerjakan",
            body: `Order ${order_number} - ${license_plate} mulai dikerjakan.`,
            url: "/pos/orders",
          });
        }
      } else if (status === "in_progress" && prevStatus === "qc_review") {
        // B) QC ditolak — kembalikan ke teknisi
        if (teamIds.length > 0) {
          await sendPushToProfiles({
            profileIds: teamIds,
            title: "QC Ditolak — Perlu Perbaikan",
            body: `Order ${order_number} dikembalikan untuk perbaikan. Periksa temuan QC.`,
            url: "/pos/orders",
          });
        }
      } else if (status === "completed") {
        // C) Order selesai (wash langsung selesai atau QC lulus)
        const financeIds = await getNotifTargets(branch_id, [
          "owner",
          "manager",
          "admin_kasir",
          "finance",
        ]);
        if (financeIds.length > 0) {
          await sendPushToProfiles({
            profileIds: financeIds,
            title: "Order Selesai",
            body: `Order ${order_number} - ${license_plate} selesai dikerjakan.`,
            url: "/pos/orders",
          });
        }
      }
    } catch (err) {
      console.error("[push] applyOrderStatusAction notification failed:", err);
    }
  })();

  return { ok: true };
}

/**
 * Proses serah terima (menunggu_diambil atau diserahkan).
 */
export async function advanceHandoverAction(
  orderId: string,
  next: "menunggu_diambil" | "diserahkan",
): Promise<ActionResult> {
  const supabase = await createClient();

  const { error: rpcErr } = await supabase.rpc("advance_handover", {
    p_order_id: orderId,
    p_next: next,
  });

  if (rpcErr) return { ok: false, message: rpcErr.message };

  revalidatePath("/pos/orders");
  revalidatePath(`/pos/orders/${orderId}`);

  return { ok: true };
}

/**
 * Mulai pengerjaan order via start_order_work (dari order queue, dengan tim).
 * Mengirim notifikasi A: Order Mulai Dikerjakan ke manager + teknisi.
 */
export async function startOrderWorkAction(
  orderId: string,
  teamIds: string[],
): Promise<ActionResult> {
  const supabase = await createClient();

  const { error: rpcErr } = await supabase.rpc("start_order_work", {
    p_order_id: orderId,
    p_team_ids: teamIds,
  });

  if (rpcErr) return { ok: false, message: rpcErr.message };

  revalidatePath("/pos/orders");

  void (async () => {
    try {
      const { order_number, license_plate, branch_id } = await getOrderInfo(orderId);
      if (!branch_id) return;

      const managerIds = await getNotifTargets(branch_id, [
        "owner",
        "manager",
        "admin_kasir",
      ]);
      const targets = Array.from(new Set([...managerIds, ...teamIds]));
      if (targets.length > 0) {
        await sendPushToProfiles({
          profileIds: targets,
          title: "Order Mulai Dikerjakan",
          body: `Order ${order_number} - ${license_plate} mulai dikerjakan.`,
          url: "/pos/orders",
        });
      }
    } catch (err) {
      console.error("[push] startOrderWorkAction notification failed:", err);
    }
  })();

  return { ok: true };
}

/**
 * Settle payment untuk order (mengubah payment_state ke paid + status ke selesai).
 * Mengirim notifikasi C: Order Selesai & Dibayar.
 */
export async function settleOrderPaymentAction(
  orderId: string,
  paymentMethod: "cash" | "qris" | "bank_transfer",
  paidAmount: number,
): Promise<ActionResult> {
  const supabase = await createClient();

  const { error: rpcErr } = await supabase.rpc("settle_order_payment", {
    p_order_id: orderId,
    p_paid_amount: paidAmount,
    p_payment_method: paymentMethod,
  });

  if (rpcErr) return { ok: false, message: rpcErr.message };

  revalidatePath("/pos/orders");
  revalidatePath(`/pos/orders/${orderId}`);

  void (async () => {
    try {
      const { order_number, license_plate, branch_id } = await getOrderInfo(orderId);
      if (!branch_id) return;

      const targets = await getNotifTargets(branch_id, [
        "owner",
        "manager",
        "admin_kasir",
        "finance",
      ]);
      if (targets.length > 0) {
        await sendPushToProfiles({
          profileIds: targets,
          title: "Order Selesai & Dibayar",
          body: `Order ${order_number} - ${license_plate} selesai. Pembayaran berhasil.`,
          url: "/pos/orders",
        });
      }
    } catch (err) {
      console.error("[push] settleOrderPaymentAction notification failed:", err);
    }
  })();

  return { ok: true };
}

/**
 * Batalkan order.
 */
export async function cancelOrderAction(
  orderId: string,
  reason: string,
): Promise<ActionResult> {
  const supabase = await createClient();

  const { error: rpcErr } = await supabase.rpc("cancel_order", {
    p_order_id: orderId,
    p_reason: reason,
  });

  if (rpcErr) return { ok: false, message: rpcErr.message };

  revalidatePath("/pos/orders");

  return { ok: true };
}
