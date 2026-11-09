import { BottomNav } from "@/components/dashboard/bottom-nav";
import { SubPageHeader } from "@/components/pos/sub-page-header";
import { CashFlowView } from "@/components/cashflow/cashflow-view";
import { requirePermission, scopedBranchId } from "@/lib/rbac-guard";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Arus Kas - RB AUTOLUXE" };

export default async function CashFlowPage() {
  const session = await requirePermission("reports.branch");
  const supabase = await createClient();
  const branchId = scopedBranchId(session);

  const now   = new Date();
  const from  = new Date(now.getFullYear(), now.getMonth(), 1);
  const fromStr = from.toISOString().slice(0, 10);
  const toStr   = now.toISOString().slice(0, 10);

  const { data: branchData } = branchId
    ? await supabase.from("branches").select("branch_name").eq("id", branchId).maybeSingle()
    : { data: null };

  const { data: report, error } = await (supabase as any).rpc("get_cash_flow_statement", {
    ...(branchId ? { p_branch_id: branchId } : {}),
    p_from: fromStr,
    p_to:   toStr,
  });

  return (
    <div className="flex flex-col w-full min-h-screen pb-nav-plain lg:pb-8">
      <SubPageHeader
        title="Laporan Arus Kas"
        branchName={branchData?.branch_name ?? (session.branchScope === "all" ? "Seluruh Cabang" : "Cabang Utama")}
        backHref="/profil"
      />
      <CashFlowView
        initialReport={report ?? null}
        branchId={branchId}
        defaultFrom={fromStr}
        defaultTo={toStr}
        error={error?.message ?? null}
      />
      <BottomNav role={session.role} />
    </div>
  );
}
