import { createClient } from "@/lib/supabase/server";
import { BottomNav } from "@/components/dashboard/bottom-nav";
import { SubPageHeader } from "@/components/pos/sub-page-header";
import { KasConsole } from "@/components/kas/kas-console";
import { requirePermission } from "@/lib/rbac-guard";

export const instant = false;

export default async function KasPage() {
  const session = await requirePermission("cash.petty_manage");

  const supabase = await createClient();
  const branchId = session.branchId;

  const { data: branch } = await supabase
    .from("branches")
    .select("branch_name")
    .eq("id", branchId ?? "")
    .maybeSingle();

  const { data: pettyCash } = await supabase
    .from("petty_cash")
    .select("id, created_at, amount, category, description, proof_photo_url, payment_method")
    .eq("branch_id", branchId ?? "")
    .order("created_at", { ascending: false })
    .limit(50);

  const { data: handoff } = await supabase
    .from("shift_handoffs")
    .select("id, status, opening_cash, expected_cash, actual_cash")
    .eq("branch_id", branchId ?? "")
    .eq("status", "open")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return (
    <>
      <SubPageHeader title="Arus Kas & Petty Cash" subtitle={branch?.branch_name} backHref="/dashboard" />
      <main className="flex-1">
        <KasConsole
          branchName={branch?.branch_name ?? "RB AUTOLUXE"}
          canManage={true}
          pettyCash={(pettyCash ?? []).map((row) => ({
            id: row.id,
            createdAt: row.created_at,
            amount: Number(row.amount),
            category: row.category,
            description: row.description,
            paymentMethod: row.payment_method,
            proofPhotoUrl: row.proof_photo_url,
          }))}
handoff={
            handoff
              ? {
                  id: handoff.id,
                  opening: Number(handoff.opening_cash),
                  status: handoff.status,
                  expected: handoff.expected_cash ? Number(handoff.expected_cash) : null,
                  actual: handoff.actual_cash ? Number(handoff.actual_cash) : null,
                }
              : null
          }
        />
      </main>
      <BottomNav role={session.role} />
    </>
  );
}
