import { createClient } from "@/lib/supabase/server";
import { BottomNav } from "@/components/dashboard/bottom-nav";
import { SubPageHeader } from "@/components/pos/sub-page-header";
import { BranchSettingsView } from "@/components/branch/branch-settings-view";
import { requirePermission } from "@/lib/rbac-guard";
import type { BranchRecord } from "@/lib/branch";


export default async function BranchSettingsPage() {
  const session = await requirePermission("branch.manage");

  const supabase = await createClient();

  const { data: branches } = await supabase
    .from("branches")
    .select(
      "id, branch_name, address, latitude, longitude, geofence_radius_meters, operating_open_time, operating_close_time, is_active",
    )
    .order("branch_name", { ascending: true });

  const rows = branches ?? [];
  const branchIds = rows.map((row) => row.id as string);

  let staffByBranch: Record<string, number> = {};
  if (branchIds.length > 0) {
    const { data: staff } = await supabase
      .from("profiles")
      .select("branch_id")
      .in("branch_id", branchIds)
      .eq("is_active", true);

    staffByBranch = {};
    for (const person of staff ?? []) {
      const key = person.branch_id as string;
      staffByBranch[key] = (staffByBranch[key] ?? 0) + 1;
    }
  }

  const records: BranchRecord[] = rows.map((row) => ({
    id: row.id as string,
    name: row.branch_name as string,
    address: (row.address as string) ?? "",
    latitude: row.latitude === null ? null : Number(row.latitude),
    longitude: row.longitude === null ? null : Number(row.longitude),
    radiusMeters: Number(row.geofence_radius_meters ?? 30),
    openTime: row.operating_open_time as string,
    closeTime: row.operating_close_time as string,
    isActive: Boolean(row.is_active),
    staffCount: staffByBranch[row.id as string] ?? 0,
  }));

  return (
    <div className="flex flex-col w-full min-h-screen pb-nav">
      <SubPageHeader
        title="Pengaturan Cabang"
        branchName={
          session.branchScope === "all"
            ? "Seluruh Cabang"
            : (records.find((b) => b.id === session.branchId)?.name ?? "Cabang Utama")
        }
        backHref="/dashboard"
      />
      <main className="flex-1">
        <BranchSettingsView
          branches={records}
          activeBranchId={session.branchId}
        />
      </main>
      <BottomNav role={session.role} />
    </div>
  );
}
