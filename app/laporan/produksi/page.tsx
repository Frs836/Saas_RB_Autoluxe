import { BottomNav } from "@/components/dashboard/bottom-nav";
import { SubPageHeader } from "@/components/pos/sub-page-header";
import { ProduksiView, type ProductionReportData } from "@/components/laporan/produksi-view";
import { requirePermission, scopedBranchId } from "@/lib/rbac-guard";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Biaya Produksi - RB AUTOLUXE" };

export default async function ProductionCostReportPage() {
  const session = await requirePermission("reports.branch");
  const supabase = await createClient();
  const branchId = scopedBranchId(session);

  const { data: branchData } = branchId
    ? await supabase.from("branches").select("branch_name").eq("id", branchId).maybeSingle()
    : { data: null };

  const { data: reportData, error } = await (supabase as any).rpc("get_production_cost_report", {
    ...(branchId ? { p_branch_id: branchId } : {}),
  });

  if (error) {
    console.error("Error fetching production cost report:", error);
  }

  const branchLabel =
    branchData?.branch_name ??
    (session.branchScope === "all" ? "Seluruh Cabang" : "Cabang Utama");

  return (
    <div className="flex flex-col w-full min-h-screen pb-nav-plain lg:pb-8">
      <SubPageHeader
        title="Biaya Produksi (HPP Jasa)"
        branchName={branchLabel}
        backHref="/laporan"
      />
      <ProduksiView
        initialData={(reportData as ProductionReportData) ?? null}
        branchName={branchLabel}
      />
      <BottomNav role={session.role} />
    </div>
  );
}
