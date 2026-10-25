import { createClient } from "@/lib/supabase/server";
import { BottomNav } from "@/components/dashboard/bottom-nav";
import { SubPageHeader } from "@/components/pos/sub-page-header";
import { KasConsole } from "@/components/kas/kas-console";
import { requirePermission, scopedBranchId } from "@/lib/rbac-guard";
import { scopeBranchQuery } from "@/lib/branch";


export default async function KasPage() {
  const session = await requirePermission("cash.petty_manage");

  const supabase = await createClient();
  const branchId = scopedBranchId(session);

  const { data: branch } = branchId
    ? await supabase
        .from("branches")
        .select("branch_name")
        .eq("id", branchId)
        .maybeSingle()
    : { data: null };

  const { data: pettyCash } = await scopeBranchQuery(
    supabase
      .from("petty_cash")
      .select(
        "id, created_at, amount, category, description, proof_photo_url, payment_method",
      ),
    branchId,
    "petty_cash",
  )
    .order("created_at", { ascending: false })
    .limit(50);

  // Fetch unpaid orders (Bayar Nanti) - orders with payment_state = 'unpaid' and cash_hold_amount > 0
  const { data: unpaidOrders } = await scopeBranchQuery(
    supabase
      .from("orders")
      .select(
        "id, order_number, license_plate, vehicle_model, customer_name, total_price, cash_hold_amount, cash_hold_payment_method, created_at",
      )
      .eq("payment_state", "unpaid")
      .gt("cash_hold_amount", 0),
    branchId,
    "orders",
  )
    .order("created_at", { ascending: false });

  // Handoff adalah satu catatan aktif per cabang, jadi tidak ada makna saat
  // manajer sedang melihat seluruh cabang sekaligus.
  const { data: handoff } = branchId
    ? await supabase
        .from("shift_handoffs")
        .select("id, status, opening_cash, expected_cash, actual_cash")
        .eq("branch_id", branchId)
        .eq("status", "open")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle()
    : { data: null };

  return (
    <>
      <SubPageHeader
        title="Arus Kas & Petty Cash"
        subtitle={
          branch?.branch_name ??
          (session.branchScope === "all" ? "Seluruh Cabang" : undefined)
        }
        backHref="/dashboard"
      />
      <main className="flex-1">
        <KasConsole
          branchName={branch?.branch_name ?? "RB AUTOLUXE"}
          canManage={true}
          pettyCash={(pettyCash ?? []).map((row) => ({
            id: row.id ?? "",
            createdAt: row.created_at ?? "",
            amount: Number(row.amount),
            category: row.category ?? "",
            description: row.description,
            paymentMethod: row.payment_method ?? "",
            proofPhotoUrl: row.proof_photo_url,
          }))}
          unpaidOrders={(unpaidOrders ?? []).map((row) => ({
            id: row.id,
            orderNumber: row.order_number,
            licensePlate: row.license_plate,
            vehicleModel: row.vehicle_model,
            customerName: row.customer_name ?? "",
            totalPrice: Number(row.total_price),
            cashHoldAmount: Number(row.cash_hold_amount),
            cashHoldPaymentMethod: row.cash_hold_payment_method ?? "",
            createdAt: row.created_at,
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
