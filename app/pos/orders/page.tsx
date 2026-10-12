import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { BottomNav } from "@/components/dashboard/bottom-nav";
import { SubPageHeader } from "@/components/pos/sub-page-header";
import {
  OrderQueue,
  type QueueOrder,
  type TeamMember,
} from "@/components/pos/order-queue";

export const instant = false;

const PRIVILEGED = ["owner", "admin_kasir", "maintainer"];

export default async function OrderQueuePage() {
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

  const branchId = profile.branch_id as string | null;

  const [branchRes, ordersRes] = await Promise.all([
    branchId
      ? supabase
          .from("branches")
          .select("branch_name")
          .eq("id", branchId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    branchId
      ? supabase
          .from("orders")
          .select(
            "id, order_number, license_plate, vehicle_model, vehicle_size, customer_name, customer_phone, service_package, status, total_price, payment_method, created_at, completed_at, assigned_to, cancellation_reason",
          )
          .eq("branch_id", branchId)
          .order("created_at", { ascending: false })
          .limit(60)
      : Promise.resolve({ data: [] }),
  ]);

  const orders = ordersRes.data ?? [];
  const orderIds = orders.map((o) => o.id);

  const teamByOrder: Record<string, TeamMember[]> = {};
  if (orderIds.length > 0) {
    const { data: teamRows } = await supabase
      .from("order_team_members")
      .select("order_id, profile_id, is_lead")
      .in("order_id", orderIds);

    const rows = teamRows ?? [];
    const profileIds = Array.from(
      new Set(rows.map((r) => r.profile_id).filter(Boolean)),
    );
    let nameById: Record<string, string> = {};
    if (profileIds.length > 0) {
      const { data: profiles } = await supabase
        .from("profiles")
        .select("id, full_name")
        .in("id", profileIds);
      nameById = Object.fromEntries(
        (profiles ?? []).map((p) => [p.id, p.full_name as string]),
      );
    }
    rows.forEach((row) => {
      const list = teamByOrder[row.order_id] ?? [];
      list.push({
        id: row.profile_id,
        full_name: nameById[row.profile_id] ?? "Teknisi",
        is_lead: Boolean(row.is_lead),
      });
      teamByOrder[row.order_id] = list;
    });
    Object.values(teamByOrder).forEach((list) =>
      list.sort((a, b) => Number(b.is_lead) - Number(a.is_lead)),
    );
  }

  const queueOrders: QueueOrder[] = orders.map((o) => ({
    ...o,
    team: teamByOrder[o.id] ?? [],
  })) as QueueOrder[];

  const canManage = PRIVILEGED.includes(profile.role as string);

  return (
    <div className="flex flex-col w-full min-h-screen">
      <SubPageHeader
        title="Antrean Order"
        branchName={branchRes.data?.branch_name ?? "Cabang Utama"}
        backHref="/dashboard"
      />
      <OrderQueue orders={queueOrders} canManage={canManage} />
      <BottomNav />
    </div>
  );
}
