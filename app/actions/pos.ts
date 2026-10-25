"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/database.types";

type VehicleSize = Database["public"]["Enums"]["vehicle_size"];
type PaymentMethod = Database["public"]["Enums"]["payment_method"];

export type CreateOrderParams = {
  p_license_plate: string;
  p_vehicle_model: string;
  p_vehicle_size: VehicleSize;
  p_customer_name: string;
  p_customer_phone: string;
  p_service_package: string;
  p_items: Array<{ service_id: string; name: string; price: number; qty: number }>;
  p_payment_method: PaymentMethod;
  p_payment_state: string;
  p_start_work: boolean;
  p_team_ids: string[];
};

export type CreateOrderResult =
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; message: string };

/**
 * Membuat order baru melalui RPC `create_pos_order_with_hold` dari sisi server.
 *
 * Pemanggilan dilakukan dari server action agar cache Next.js App Router pada
 * halaman `/pos/orders` dapat diinvalidasi via `revalidatePath` setelah order
 * berhasil dibuat. `revalidatePath` hanya dipanggil jika RPC berhasil dan
 * menghasilkan `order_number` yang valid — cache tidak disentuh jika order
 * gagal tersimpan.
 */
export async function createPosOrder(
  params: CreateOrderParams,
): Promise<CreateOrderResult> {
  const supabase = await createClient();

  const { data: orderRow, error: createError } = await supabase.rpc(
    "create_pos_order_with_hold",
    params,
  );

  if (createError) {
    return { ok: false, message: createError.message };
  }

  const order = Array.isArray(orderRow) ? orderRow[0] : orderRow;
  if (!order || !order.order_number) {
    return { ok: false, message: "Order tidak dapat dibuat." };
  }

  // Invalidasi cache halaman antrian hanya setelah order berhasil disimpan.
  revalidatePath("/pos/orders");

  return { ok: true, data: order as Record<string, unknown> };
}
