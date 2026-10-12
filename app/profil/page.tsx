import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { BottomNav } from "@/components/dashboard/bottom-nav";
import { SubPageHeader } from "@/components/pos/sub-page-header";
import { ProfilView } from "@/components/profil/profil-view";
import { can, profileMenuFor, roleLabel, toRole } from "@/lib/rbac";
import { getSessionProfile } from "@/lib/rbac-guard";

export const instant = false;

export default async function ProfilPage() {
  const session = await getSessionProfile();

  if (!session) {
    redirect("/login");
  }

  const supabase = await createClient();
  const { data: profile } = await supabase
    .from("profiles")
    .select("id, phone_number")
    .eq("auth_id", session.authId)
    .maybeSingle();

  const branchRes = session.branchId
    ? await supabase
        .from("branches")
        .select("branch_name, latitude, longitude, operating_open_time, operating_close_time")
        .eq("id", session.branchId)
        .maybeSingle()
    : null;
  const branch = branchRes?.data ?? null;

  const role = session.role;

  return (
    <div className="flex flex-col w-full min-h-screen">
      <SubPageHeader
        title="Profil Saya"
        branchName={(branch?.branch_name as string) ?? "Cabang Utama"}
        backHref="/dashboard"
      />
      <ProfilView
        profile={{
          id: session.id,
          fullName: session.fullName,
          email: session.email,
          phone: profile?.phone_number ? String(profile.phone_number) : null,
          role,
          roleLabel: roleLabel(role),
        }}
        branch={{
          name: (branch?.branch_name as string) ?? "Cabang Utama",
          latitude:
            branch?.latitude === null || branch?.latitude === undefined
              ? null
              : Number(branch.latitude),
          longitude:
            branch?.longitude === null || branch?.longitude === undefined
              ? null
              : Number(branch.longitude),
          openTime: (branch?.operating_open_time as string) ?? "07:30:00",
          closeTime: (branch?.operating_close_time as string) ?? "21:00:00",
        }}
        menu={profileMenuFor(role)}
        canManageLocation={can(role, "attendance.manage_location")}
      />
      <BottomNav role={toRole(role)} />
    </div>
  );
}