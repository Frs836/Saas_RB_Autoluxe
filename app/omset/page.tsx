import { createClient } from "@/lib/supabase/server";
import { BottomNav } from "@/components/dashboard/bottom-nav";
import { SubPageHeader } from "@/components/pos/sub-page-header";
import { OmsetView } from "@/components/omset/omset-view";
import { requirePermission, scopedBranchId } from "@/lib/rbac-guard";
import { scopeBranchQuery } from "@/lib/branch";

export const metadata = { title: "Omset - RB AUTOLUXE" };

export default async function OmsetPage() {
  const session = await requirePermission("reports.omset");
  const supabase = await createClient();
  const branchId = scopedBranchId(session);

  // Ambil 31 hari terakhir untuk default view
  const since = new Date();
  since.setDate(since.getDate() - 30);
  const sinceIso = since.toISOString();

  const [branchRes, ordersRes, cashRes] = await Promise.all([
    branchId
      ? supabase.from("branches").select("branch_name").eq("id", branchId).maybeSingle()
      : { data: null },
    scopeBranchQuery(
      supabase
        .from("orders")
        .select("id, total_price, status, payment_state, created_at, service_package")
        .gte("created_at", sinceIso),
      branchId,
      "orders",
    ).order("created_at", { ascending: false }),
    scopeBranchQuery(
      supabase
        .from("cash_flow")
        .select("id, type, amount, category, created_at")
        .gte("created_at", sinceIso),
      branchId,
      "cash_flow",
    ).order("created_at", { ascending: false }),
  ]);

  const orders = (ordersRes.data ?? []).map((o) => ({
    id: o.id,
    totalPrice: Number(o.total_price ?? 0),
    status: o.status ?? "",
    paymentState: o.payment_state ?? "",
    createdAt: o.created_at ?? "",
    servicePackage: o.service_package ?? "",
  }));

  const cashFlows = (cashRes.data ?? []).map((c) => ({
    id: c.id,
    type: c.type ?? "",
    amount: Number(c.amount ?? 0),
    category: c.category ?? "",
    createdAt: c.created_at ?? "",
  }));

  return (
    <div className="flex flex-col w-full min-h-screen pb-nav-plain">
      <SubPageHeader
        title="Omset"
        branchName={
          branchRes.data?.branch_name ??
          (session.branchScope === "all" ? "Seluruh Cabang" : "Cabang Utama")
        }
        backHref="/dashboard"
      />
      <OmsetView orders={orders} cashFlows={cashFlows} />
      <BottomNav role={session.role} />
    </div>
  );
}
