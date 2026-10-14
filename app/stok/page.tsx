import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { BottomNav } from "@/components/dashboard/bottom-nav";
import { SubPageHeader } from "@/components/pos/sub-page-header";
import {
  StockManager,
  type InventoryItem,
  type StockClaim,
} from "@/components/pos/stock-manager";
import { can } from "@/lib/rbac";
import { getSessionProfile, scopedBranchId } from "@/lib/rbac-guard";
import { scopeBranchQuery } from "@/lib/branch";

export const instant = false;

export default async function StockPage() {
  const session = await getSessionProfile();

  if (!session) {
    redirect("/login");
  }

  const supabase = await createClient();
  const branchId = scopedBranchId(session);

  const [branchRes, itemsRes, claimsRes] = await Promise.all([
    branchId
      ? supabase
          .from("branches")
          .select("branch_name")
          .eq("id", branchId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    scopeBranchQuery(
      supabase
        .from("inventory_items")
        .select("id, item_name, current_stock, unit, min_stock_alert"),
      branchId,
      "inventory_items",
    ).order("item_name", { ascending: true }),
    scopeBranchQuery(
      supabase
        .from("stock_claims")
        .select(
          "id, item_id, quantity, unit, note, status, claimed_by, confirmed_by, created_at, confirmed_at",
        ),
      branchId,
      "stock_claims",
    )
      .order("created_at", { ascending: false })
      .limit(60),
  ]);

  const items = itemsRes.data ?? [];
  const rawClaims = claimsRes.data ?? [];

  const itemNameById = Object.fromEntries(
    items.map((i) => [i.id, i.item_name as string]),
  );

  const profileIds = Array.from(
    new Set(
      rawClaims
        .flatMap((c) => [c.claimed_by, c.confirmed_by])
        .filter((v): v is string => Boolean(v)),
    ),
  );
  let nameById: Record<string, string> = {};
  if (profileIds.length > 0) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, full_name")
      .in("id", profileIds);
    nameById = Object.fromEntries(
      (profiles ?? []).map((p) => [p.id, p.full_name as string]),
    );
  }

  const claims: StockClaim[] = rawClaims.map((c) => ({
    id: c.id,
    item_id: c.item_id,
    item_name: itemNameById[c.item_id] ?? "Item",
    quantity: Number(c.quantity),
    unit: c.unit,
    note: c.note,
    status: c.status,
    claimed_by_name: nameById[c.claimed_by] ?? "Staf",
    confirmed_by_name: c.confirmed_by ? nameById[c.confirmed_by] ?? "Staf" : null,
    created_at: c.created_at,
    confirmed_at: c.confirmed_at,
  }));

  const canManage = can(session.role, "stock.approve");

  return (
    <div className="flex flex-col w-full min-h-screen">
      <SubPageHeader
        title="Stok & Inventaris"
        branchName={branchRes.data?.branch_name ?? "Cabang Utama"}
        backHref="/dashboard"
      />
      <StockManager
        items={items as InventoryItem[]}
        claims={claims}
        canManage={canManage}
      />
      <BottomNav role={session.role} />
    </div>
  );
}
