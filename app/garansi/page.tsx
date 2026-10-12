import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { BottomNav } from "@/components/dashboard/bottom-nav";
import { SubPageHeader } from "@/components/pos/sub-page-header";
import { GaransiConsole } from "@/components/garansi/garansi-console";
import { ATTENDANCE_MANAGER_ROLES } from "@/lib/attendance";

export const instant = false;

export default async function GaransiPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, role, branch_id")
    .eq("auth_id", user.id)
    .maybeSingle();

  if (!profile) {
    redirect("/dashboard");
  }

  const role = (profile.role as string) ?? "";
  const branchId = profile.branch_id as string | null;
  const canManage = ATTENDANCE_MANAGER_ROLES.includes(role);

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
          canManage={canManage}
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
      <BottomNav />
    </>
  );
}
