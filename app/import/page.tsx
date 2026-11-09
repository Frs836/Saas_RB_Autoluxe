import { BottomNav } from "@/components/dashboard/bottom-nav";
import { SubPageHeader } from "@/components/pos/sub-page-header";
import { BulkImportConsole } from "@/components/import/bulk-import-console";
import { requirePermission, scopedBranchId } from "@/lib/rbac-guard";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Import Data - RB AUTOLUXE" };

export default async function ImportPage() {
  const session = await requirePermission("staff.manage");
  const supabase = await createClient();
  const branchId = scopedBranchId(session);

  const { data: branches } = await supabase
    .from("branches")
    .select("id, branch_name")
    .order("branch_name");

  const { data: branchData } = branchId
    ? await supabase.from("branches").select("branch_name").eq("id", branchId).maybeSingle()
    : { data: null };

  return (
    <div className="flex flex-col w-full min-h-screen pb-nav-plain lg:pb-8">
      <SubPageHeader
        title="Import Data Excel"
        branchName={branchData?.branch_name ?? (session.branchScope === "all" ? "Seluruh Cabang" : "Cabang Utama")}
        backHref="/profil"
      />
      <BulkImportConsole
        branchId={branchId}
        branches={(branches ?? []).map((b) => ({ id: b.id, name: b.branch_name ?? "" }))}
      />
      <BottomNav role={session.role} />
    </div>
  );
}
