import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { BottomNav } from "@/components/dashboard/bottom-nav";
import { SubPageHeader } from "@/components/pos/sub-page-header";
import {
  StockManager,
  type InventoryItem,
  type StockClaim,
} from "@/components/pos/stock-manager";
import { Icon } from "@/components/ui/icon";
import { can } from "@/lib/rbac";
import { getSessionProfile, scopedBranchId } from "@/lib/rbac-guard";
import { scopeBranchQuery } from "@/lib/branch";
import { BranchScopeBadges } from "@/components/branch/branch-scope-badges";


export default async function StockPage() {
  const session = await getSessionProfile();

  if (!session) {
    redirect("/login");
  }

  const supabase = await createClient();
  const branchId = scopedBranchId(session);

  const [branchRes, itemsRes, claimsRes, allBranchesRes, activeOrdersRes] = await Promise.all([
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
        .select("id, item_name, current_stock, unit, min_stock_alert, purchase_unit, purchase_price, purchase_content_qty, unit_cost"),
      branchId,
      "inventory_items",
    ).order("item_name", { ascending: true }),
    scopeBranchQuery(
      supabase
        .from("stock_claims")
        .select(
          "id, item_id, quantity, unit, note, order_id, status, claimed_by, confirmed_by, created_at, confirmed_at",
        )
        .not("item_id", "is", null),
      branchId,
      "stock_claims",
    )
      .order("created_at", { ascending: false })
      .limit(60),
    // Daftar cabang diambil sekali saja untuk badge cakupan.
    supabase.from("branches").select("id, branch_name, is_active").order("branch_name"),
    // Order aktif untuk dropdown klaim
    scopeBranchQuery(
      supabase
        .from("orders")
        .select("id, order_number, license_plate, customer_name, vehicle_size, status")
        .in("status", ["queued", "in_progress"]),
      branchId,
      "orders",
    )
      .order("created_at", { ascending: false })
      .limit(30),
  ]);

  const items = itemsRes.data ?? [];
  const rawClaims = claimsRes.data ?? [];
  const rawActiveOrders = activeOrdersRes.data ?? [];

  const activeOrders = rawActiveOrders.map((o) => ({
    id: o.id as string,
    order_number: (o.order_number as string | null) ?? null,
    license_plate: (o.license_plate as string) ?? "-",
    customer_name: (o.customer_name as string) ?? "Pelanggan",
    vehicle_size: (o.vehicle_size as string | null) ?? null,
  }));

  const orderLookup = Object.fromEntries(
    rawActiveOrders.map((o) => [
      o.id as string,
      `#${o.order_number ?? o.id.slice(0, 6)} - ${o.license_plate} (${o.customer_name})`,
    ]),
  );

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

  const claims: StockClaim[] = rawClaims
    .filter((c): c is typeof c & { item_id: string } => Boolean(c.item_id))
    .map((c) => ({
      id: c.id,
      item_id: c.item_id,
      item_name: itemNameById[c.item_id] ?? "Item",
      quantity: Number(c.quantity),
      unit: c.unit,
      note: c.note,
      order_id: c.order_id ?? null,
      order_label: c.order_id ? orderLookup[c.order_id] ?? `Order #${c.order_id.slice(0, 8)}` : null,
      status: c.status,
      claimed_by_name: nameById[c.claimed_by] ?? "Staf",
      confirmed_by_name: c.confirmed_by ? nameById[c.confirmed_by] ?? "Staf" : null,
      created_at: c.created_at,
      confirmed_at: c.confirmed_at,
    }));

  const canManage = can(session.role, "stock.approve");

  const branchOptions = (allBranchesRes.data ?? []).map((b) => ({
    id: b.id as string,
    name: (b.branch_name as string) ?? "Cabang",
    isActive: Boolean(b.is_active),
  }));

  return (
    <div className="flex flex-col w-full min-h-screen pb-nav-plain lg:pb-8">
      <SubPageHeader
        title="Stok & Inventaris"
        branchName={branchRes.data?.branch_name ?? "Cabang Utama"}
        backHref="/dashboard"
      />
      <BranchScopeBadges
        branches={can(session.role, "branch.switch") ? branchOptions : []}
        activeBranchId={branchId}
      />
      <div className="px-4 pt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Link
          href="/stok/racikan"
          className="flex items-center gap-3 bg-surface rounded-[16px] p-3.5 clay-card border border-white/80 active:scale-[0.99] transition-transform"
        >
          <div className="w-9 h-9 rounded-xl bg-purple-50 text-purple-600 flex items-center justify-center shrink-0">
            <Icon name="science" className="text-[18px]" />
          </div>
          <div className="flex-1 min-w-0">
            <span className="font-body-bold text-body-bold text-text-primary block">Stok Racikan</span>
            <span className="font-caption text-caption text-text-muted block">Paket racikan bahan (HF + HCL dll)</span>
          </div>
          <Icon name="chevron_right" className="text-text-muted text-[20px] shrink-0" />
        </Link>
        {canManage ? (
          <Link
            href="/stok/opname"
            className="flex items-center gap-3 bg-surface rounded-[16px] p-3.5 clay-card border border-white/80 active:scale-[0.99] transition-transform"
          >
            <div className="w-9 h-9 rounded-xl bg-brand-50 text-brand-600 flex items-center justify-center shrink-0">
              <Icon name="inventory" className="text-[18px]" />
            </div>
            <div className="flex-1 min-w-0">
              <span className="font-body-bold text-body-bold text-text-primary block">Stok Opname</span>
              <span className="font-caption text-caption text-text-muted block">Lakukan rekonsiliasi stok bulanan</span>
            </div>
            <Icon name="chevron_right" className="text-text-muted text-[20px] shrink-0" />
          </Link>
        ) : null}
      </div>
      <StockManager
        items={items as InventoryItem[]}
        claims={claims}
        activeOrders={activeOrders}
        canManage={canManage}
      />
      <BottomNav role={session.role} />
    </div>
  );
}
