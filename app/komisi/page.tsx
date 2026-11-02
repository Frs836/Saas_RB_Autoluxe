import { createClient } from "@/lib/supabase/server";
import { BottomNav } from "@/components/dashboard/bottom-nav";
import { SubPageHeader } from "@/components/pos/sub-page-header";
import { KomisiView } from "@/components/komisi/komisi-view";
import { requirePermission, scopedBranchId } from "@/lib/rbac-guard";

export const metadata = { title: "Laporan Komisi - RB AUTOLUXE" };

export default async function KomisiPage() {
  const session = await requirePermission("reports.branch");
  const supabase = await createClient();
  const branchId = scopedBranchId(session);

  // Default: bulan berjalan
  const now = new Date();
  const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const fromDate = firstOfMonth.toISOString().slice(0, 10);
  const toDate   = now.toISOString().slice(0, 10);

  const { data: branchData } = branchId
    ? await supabase.from("branches").select("branch_name").eq("id", branchId).maybeSingle()
    : { data: null };

  const reportRes = await supabase.rpc("get_staff_commission_report", {
    ...(branchId ? { p_branch_id: branchId } : {}),
    p_from: fromDate,
    p_to:   toDate,
  } as never);

  const rows = ((reportRes.data ?? []) as Record<string, unknown>[]).map((r) => ({
    profileId:     r.profile_id     as string,
    fullName:      r.full_name      as string,
    role:          r.role           as string,
    branchName:    r.branch_name    as string,
    totalOrders:   Number(r.total_orders   ?? 0),
    leadOrders:    Number(r.lead_orders    ?? 0),
    memberOrders:  Number(r.member_orders  ?? 0),
    totalRevenue:  Number(r.total_revenue  ?? 0),
    leadRevenue:   Number(r.lead_revenue   ?? 0),
    washOrders:    Number(r.wash_orders    ?? 0),
    coatingOrders: Number(r.coating_orders ?? 0),
    polesOrders:   Number(r.poles_orders   ?? 0),
    otherOrders:   Number(r.other_orders   ?? 0),
  }));

  return (
    <div className="flex flex-col w-full min-h-screen pb-nav-plain">
      <SubPageHeader
        title="Laporan Komisi"
        branchName={
          branchData?.branch_name ??
          (session.branchScope === "all" ? "Seluruh Cabang" : "Cabang Utama")
        }
        backHref="/dashboard"
      />
      <KomisiView
        initialRows={rows}
        branchId={branchId}
        defaultFrom={fromDate}
        defaultTo={toDate}
      />
      <BottomNav role={session.role} />
    </div>
  );
}
