import { redirect } from "next/navigation";
import { BottomNav } from "@/components/dashboard/bottom-nav";
import { SubPageHeader } from "@/components/pos/sub-page-header";
import { StaffManagementPage } from "@/components/branch/staff-management-page";
import { requirePermission, scopedBranchId } from "@/lib/rbac-guard";
import { createClient } from "@/lib/supabase/server";
import { getSessionProfile } from "@/lib/rbac-guard";


export default async function StaffSchedulePage() {
  const session = await requirePermission("branch.manage");

  if (!session) {
    redirect("/login");
  }

  const supabase = await createClient();
  const branchId = scopedBranchId(session);

  const [branchRes, branchOptionsRes] = await Promise.all([
    branchId
      ? supabase
          .from("branches")
          .select("branch_name")
          .eq("id", branchId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    supabase
      .from("branches")
      .select("id, branch_name")
      .order("branch_name")
  ]);

  const branch = branchRes.data;
  const branchOptions = (branchOptionsRes.data ?? []).map((b) => ({ id: b.id, name: b.branch_name }));

  return (
    <div className="flex flex-col w-full min-h-screen">
      <SubPageHeader
        title="Manajemen Staf"
        branchName={branch?.branch_name ?? "Cabang Utama"}
        backHref="/dashboard"
      />
      <StaffManagementPage
        session={session}
        branches={branchOptions}
        branchId={branchId}
      />
      <BottomNav role={session.role} />
    </div>
  );
}