import { createClient } from "@/lib/supabase/server";
import { BottomNav } from "@/components/dashboard/bottom-nav";
import { SubPageHeader } from "@/components/pos/sub-page-header";
import { AuditView } from "@/components/audit/audit-view";
import { requirePermission, scopedBranchId } from "@/lib/rbac-guard";

export const metadata = { title: "Log Aktivitas - RB AUTOLUXE" };

export default async function AktivitasPage() {
  const session = await requirePermission("reports.branch");
  const supabase = await createClient();
  const branchId = scopedBranchId(session);

  // Default: 7 hari terakhir
  const to   = new Date();
  const from = new Date(to.getTime() - 7 * 24 * 60 * 60 * 1000);
  const fromStr = from.toISOString().slice(0, 10);
  const toStr   = to.toISOString().slice(0, 10);

  const { data: branchData } = branchId
    ? await supabase.from("branches").select("branch_name").eq("id", branchId).maybeSingle()
    : { data: null };

  const { data: rows, error } = await (supabase as any).rpc("get_audit_trail", {
    ...(branchId ? { p_branch_id: branchId } : {}),
    p_category: "all",
    p_from: fromStr,
    p_to:   toStr,
    p_limit: 100,
    p_offset: 0,
  });

  return (
    <div className="flex flex-col w-full min-h-screen pb-nav-plain lg:pb-8">
      <SubPageHeader
        title="Log Aktivitas"
        branchName={
          branchData?.branch_name ??
          (session.branchScope === "all" ? "Seluruh Cabang" : "Cabang Utama")
        }
        backHref="/profil"
      />
      <AuditView
        initialRows={(rows ?? []) as any[]}
        branchId={branchId}
        defaultFrom={fromStr}
        defaultTo={toStr}
        error={error?.message ?? null}
      />
      <BottomNav role={session.role} />
    </div>
  );
}
