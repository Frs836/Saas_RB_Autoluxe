import { createClient } from "@/lib/supabase/server";
import { BottomNav } from "@/components/dashboard/bottom-nav";
import { SubPageHeader } from "@/components/pos/sub-page-header";
import { WhatsappConsole } from "@/components/whatsapp/whatsapp-console";
import { requirePermission } from "@/lib/rbac-guard";

export const instant = false;

export default async function WhatsappPage() {
  const profile = await requirePermission("whatsapp.draft");

  const supabase = await createClient();
  const { data: branch } = await supabase
    .from("branches")
    .select("branch_name")
    .eq("id", profile.branchId ?? "")
    .maybeSingle();

  return (
    <>
      <SubPageHeader title="Integrasi WhatsApp" subtitle={branch?.branch_name} backHref="/dashboard" />
      <main className="flex-1">
        <WhatsappConsole />
      </main>
      <BottomNav role={profile.role} />
    </>
  );
}
