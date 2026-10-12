import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { BottomNav } from "@/components/dashboard/bottom-nav";
import { SubPageHeader } from "@/components/pos/sub-page-header";
import { ProfilView } from "@/components/profil/profil-view";
import { ATTENDANCE_ROLE_LABELS } from "@/lib/attendance";

export const instant = false;

export default async function ProfilPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, full_name, role, branch_id, phone_number")
    .eq("auth_id", user.id)
    .maybeSingle();

  if (!profile) {
    redirect("/dashboard");
  }

  const branchId = profile.branch_id as string | null;

  const { data: branch } = branchId
    ? await supabase
        .from("branches")
        .select("branch_name, latitude, longitude, operating_open_time, operating_close_time")
        .eq("id", branchId)
        .maybeSingle()
    : { data: null };

  const role = profile.role as string;

  return (
    <div className="flex flex-col w-full min-h-screen">
      <SubPageHeader
        title="Profil Saya"
        branchName={(branch?.branch_name as string) ?? "Cabang Utama"}
        backHref="/dashboard"
      />
      <ProfilView
        profile={{
          id: profile.id as string,
          fullName: (profile.full_name as string) ?? user.email ?? "Staf",
          email: user.email ?? "",
          phone: profile.phone_number ? String(profile.phone_number) : null,
          role,
          roleLabel: ATTENDANCE_ROLE_LABELS[role] ?? role,
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
        isPrivileged={["owner", "admin_kasir", "maintainer"].includes(role)}
        canManageLocation={["owner", "maintainer"].includes(role)}
      />
      <BottomNav />
    </div>
  );
}