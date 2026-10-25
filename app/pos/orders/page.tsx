import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { BottomNav } from "@/components/dashboard/bottom-nav";
import { SubPageHeader } from "@/components/pos/sub-page-header";
import {
  OrderQueue,
  type QueueOrder,
  type TeamMember,
} from "@/components/pos/order-queue";
import { can } from "@/lib/rbac";
import { getSessionProfile, scopedBranchId } from "@/lib/rbac-guard";
import { queryError } from "@/lib/branch";


export default async function OrderQueuePage() {
  const session = await getSessionProfile();

  if (!session) {
    redirect("/login");
  }

  const supabase = await createClient();
  const branchId = scopedBranchId(session);

  const [branchRes, queueRes] = await Promise.all([
    branchId
      ? supabase
          .from("branches")
          .select("branch_name")
          .eq("id", branchId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    supabase.rpc("get_order_queue_with_team", {
      ...(branchId !== null ? { p_branch_id: branchId } : {}),
      p_vehicle_size: null,
      p_status_filter: "all",
      p_limit: 300,
    }),
  ]);

  queryError(queueRes, "pos.orders.queue");

  const queueData = queueRes.data ?? [];
  const queueOrders: QueueOrder[] = queueData.map((o: typeof queueData[0]) => ({
    ...o,
    team: (o.team as TeamMember[]) ?? [],
  })) as QueueOrder[];

  const canManage = can(session.role, "order.manage_status");

  return (
    <div className="flex flex-col w-full min-h-screen">
      <SubPageHeader
        title="Antrean Order"
        branchName={
          branchRes.data?.branch_name ??
          (session.branchScope === "all" ? "Seluruh Cabang" : "Cabang Utama")
        }
        backHref="/dashboard"
      />
      <OrderQueue
        orders={queueOrders}
        canManage={canManage}
        canStartWork={can(session.role, "order.start_work")}
        role={session.role}
      />
      <BottomNav role={session.role} />
    </div>
  );
}
