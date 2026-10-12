import { createClient } from "@/lib/supabase/server";
import { BottomNav } from "@/components/dashboard/bottom-nav";
import { SubPageHeader } from "@/components/pos/sub-page-header";
import { GaransiConsole } from "@/components/garansi/garansi-console";
import { requirePermission } from "@/lib/rbac-guard";

export const instant = false;

export default async function GaransiPage() {
  const session = await requirePermission("warranty.manage");

  const supabase = await createClient();
  const branchId = session.branchId;

  const { data: branch } = await supabase
    .from("branches")
    .select("branch_name")
    .eq("id", branchId ?? "")
    .maybeSingle();

  const { data: orders } = await supabase
    .from("orders")
    .select("id, order_number, customer_name, vehicle_plate, total_price, completed_at")
    .eq("branch_id", branchId ?? "")
    .eq("status", "completed")
    .order("completed_at", { ascending: false })
    .limit(30);

  const { data: warranties } = await supabase
    .from("warranties")
    .select("id, warranty_code, start_date, end_date, status")
    .eq("branch_id", branchId ?? "")
    .order("start_date", { ascending: false })
    .limit(50);

  return (
    <>
      <SubPageHeader title="Klaim Garansi" subtitle={branch?.branch_name} backHref="/dashboard" />
      <main className="flex-1">
        <GaransiConsole
          canManage={true}
          orders={(orders ?? []).map((o) => ({
            id: o.id,
            orderNumber: o.order_number,
            customerName: o.customer_name,
            vehiclePlate: o.vehicle_plate,
            totalPrice: Number(o.total_price),
            completedAt: o.completed_at,
          }))}
          warranties={(warranties ?? []).map((w) => ({
            id: w.id,
            warrantyCode: w.warranty_code,
            startDate: w.start_date,
            endDate: w.end_date,
            status: w.status,
          }))}
        />
      </main>
      <BottomNav role={session.role} />
    </>
  );
}
