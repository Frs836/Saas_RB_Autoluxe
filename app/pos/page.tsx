import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { BottomNav } from "@/components/dashboard/bottom-nav";
import { PosConsole } from "@/components/pos/pos-console";
import { can, roleLabel } from "@/lib/rbac";
import { getSessionProfile } from "@/lib/rbac-guard";
import type { PosService } from "@/lib/pos";

export const instant = false;

export default async function PosPage() {
  const profile = await getSessionProfile();

  if (!profile) {
    redirect("/login");
  }

  const supabase = await createClient();
  const branchId = profile.branchId;

  const [servicesRes, teamRes, branchRes] = await Promise.all([
    supabase
      .from("services")
      .select(
        "id, name, category, price_s, price_m, price_l, price_xl, price_motor, is_addon",
      )
      .eq("is_active", true)
      .order("category", { ascending: true })
      .order("name", { ascending: true }),
    branchId
      ? supabase
          .from("profiles")
          .select("id, full_name")
          .eq("role", "karyawan")
          .eq("is_active", true)
          .eq("branch_id", branchId)
          .order("full_name", { ascending: true })
      : Promise.resolve({ data: [] }),
    branchId
      ? supabase
          .from("branches")
          .select("branch_name")
          .eq("id", branchId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const services = (servicesRes.data ?? []) as PosService[];
  const teamOptions = teamRes.data ?? [];
  const branchName = branchRes.data?.branch_name ?? "Cabang Utama";

  return (
    <div className="flex flex-col w-full min-h-screen">
      <PosConsole
        services={services}
        teamOptions={teamOptions}
        branchName={branchName}
        canCreate={can(profile.role, "pos.create")}
        role={profile.role}
        roleLabel={roleLabel(profile.role)}
      />
      <BottomNav role={profile.role} />
    </div>
  );
}