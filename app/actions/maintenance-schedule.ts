"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/rbac-guard";

export type MaintenanceScheduleItem = {
  id: string;
  orderId: string;
  branchId: string;
  warrantyId?: string | null;
  customerName: string;
  customerPhone?: string | null;
  licensePlate: string;
  vehicleModel: string;
  servicePackage: string;
  scheduleType: "6_month" | "12_month" | string;
  dueDate: string;
  status: "pending" | "reminded" | "completed" | "cancelled" | string;
  remindedAt?: string | null;
  notes?: string | null;
  createdAt: string;
};

export async function updateScheduleStatusAction(
  scheduleId: string,
  status: "pending" | "reminded" | "completed" | "cancelled",
  notes?: string,
) {
  await requireSession();
  const supabase = await createClient();

  const { error } = await (supabase as any).rpc(
    "update_maintenance_schedule_status",
    {
      p_schedule_id: scheduleId,
      p_status: status,
      p_notes: notes ?? null,
    },
  );

  if (error) {
    return { success: false, error: error.message };
  }

  revalidatePath("/invoice");
  revalidatePath("/pos/orders");
  return { success: true };
}
