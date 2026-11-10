import { redirect } from "next/navigation";
import { requireSession } from "@/lib/rbac-guard";
import { createClient } from "@/lib/supabase/server";
import { SubPageHeader } from "@/components/pos/sub-page-header";
import { AccountSettings } from "@/components/profil/account-settings";
import { BottomNav } from "@/components/dashboard/bottom-nav";
import { urlAvatar } from "@/lib/avatar";
import { toRole } from "@/lib/rbac";

export const metadata = { title: "Edit Profil" };

export default async function EditProfilPage() {
  const session = await requireSession();

  const supabase = await createClient();
  const { data: profile } = await supabase
    .from("profiles")
    .select("id, full_name, phone_number, date_of_birth, avatar_path")
    .eq("auth_id", session.authId)
    .maybeSingle();

  return (
    <div className="flex flex-col w-full min-h-screen pb-nav-plain lg:pb-8">
      <SubPageHeader title="Edit Profil" backHref="/profil" />
      <AccountSettings
        nama={session.fullName}
        telepon={profile?.phone_number ? String(profile.phone_number) : ""}
        tanggalLahir={
          profile?.date_of_birth
            ? String(profile.date_of_birth).slice(0, 10)
            : ""
        }
        email={session.email}
        avatarUrl={
          profile?.avatar_path ? urlAvatar(profile.avatar_path) : null
        }
      />
      <BottomNav role={toRole(session.role)} />
    </div>
  );
}
