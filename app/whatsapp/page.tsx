import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { BottomNav } from "@/components/dashboard/bottom-nav";
import { SubPageHeader } from "@/components/pos/sub-page-header";
import { WhatsappConsole } from "@/components/whatsapp/whatsapp-console";

export const instant = false;

export default async function WhatsappPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, role, branch_id")
    .eq("auth_id", user.id)
    .maybeSingle();

  if (!profile) {
    redirect("/dashboard");
  }

  const branchId = profile.branch_id as string | null;
  const { data: branch } = await supabase
    .from("branches")
    .select("branch_name")
    .eq("id", branchId ?? "")
    .maybeSingle();

  return (
    <>
      <SubPageHeader title="Integrasi WhatsApp" subtitle={branch?.branch_name} backHref="/dashboard" />
      <main className="flex-1">
        <WhatsappConsole />
      </main>
      <BottomNav />
    </>
  );
}
