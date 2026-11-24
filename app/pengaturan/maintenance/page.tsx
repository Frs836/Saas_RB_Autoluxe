import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { BottomNav } from "@/components/dashboard/bottom-nav";
import { SubPageHeader } from "@/components/pos/sub-page-header";
import { MaintenanceView } from "@/components/maintenance/maintenance-view";
import { getSessionProfile } from "@/lib/rbac-guard";
import { maintainerPingBenchmarkAction } from "@/app/actions/maintenance";

export default async function MaintenancePage() {
  const session = await getSessionProfile();

  if (!session) {
    redirect("/login");
  }

  // Khusus Maintainer & Owner
  if (session.role !== "maintainer" && session.role !== "owner") {
    redirect("/dashboard");
  }

  const supabase = await createClient();

  const { data: branchesRaw } = await supabase
    .from("branches")
    .select("id, branch_name")
    .order("branch_name");

  const branches = (branchesRaw ?? []).map((b) => ({
    id: b.id as string,
    name: (b.branch_name as string) ?? "Cabang",
  }));

  // Jalankan benchmark awal untuk menampilkan live metrics saat pertama dibuka
  const benchRes = await maintainerPingBenchmarkAction(session.branchId);
  const initialBenchmark = benchRes.ok ? benchRes.data : null;

  const currentBranchName =
    session.branchScope === "all"
      ? "Seluruh Cabang"
      : branches.find((b) => b.id === session.branchId)?.name ?? "Cabang Utama";

  return (
    <div className="flex flex-col w-full min-h-screen pb-nav lg:pb-8">
      <SubPageHeader
        title="Maintenance & Speed Test"
        branchName={currentBranchName}
        backHref="/profil"
      />
      <main className="flex-1">
        <MaintenanceView
          branches={branches}
          initialBenchmark={initialBenchmark}
          currentBranchId={session.branchId}
        />
      </main>
      <BottomNav role={session.role} />
    </div>
  );
}
