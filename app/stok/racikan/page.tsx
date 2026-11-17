import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { BottomNav } from "@/components/dashboard/bottom-nav";
import { SubPageHeader } from "@/components/pos/sub-page-header";
import {
  BundleManager,
  type BundleItem,
  type BundleClaim,
  type ActiveOrderOption,
} from "@/components/pos/bundle-manager";
import { getSessionProfile, scopedBranchId } from "@/lib/rbac-guard";
import { can } from "@/lib/rbac";

export default async function RacikanPage() {
  const session = await getSessionProfile();

  if (!session) {
    redirect("/login");
  }

  const supabase = await createClient();
  const rawBranchId = scopedBranchId(session);
  // Pastikan branchId selalu ada fallback jika scope owner 'all'
  const effectiveBranchId =
    rawBranchId ?? session.homeBranchId ?? session.branches[0]?.id ?? "";

  // --- Fetch bundle_items ---
  let bundleItemsQuery = supabase
    .from("bundle_items")
    .select("id, branch_id, bundle_name, unit, output_qty, current_stock, description, is_active")
    .eq("is_active", true);

  if (rawBranchId) {
    bundleItemsQuery = bundleItemsQuery.eq("branch_id", rawBranchId);
  }

  const { data: rawBundles } = await bundleItemsQuery.order("bundle_name");
  const bundles = rawBundles ?? [];

  // --- Fetch bundle_components joined inventory_items for each bundle ---
  const bundleIds = bundles.map((b) => b.id as string);

  let componentsByBundleId: Record<
    string,
    Array<{
      item_id: string;
      item_name: string;
      unit: string;
      quantity: number;
      unit_cost: number;
    }>
  > = {};

  if (bundleIds.length > 0) {
    const { data: rawComponents } = await supabase
      .from("bundle_components")
      .select("bundle_id, item_id, quantity, inventory_items(item_name, unit, unit_cost)")
      .in("bundle_id", bundleIds);

    for (const row of rawComponents ?? []) {
      const bundleId = row.bundle_id as string;
      const inv = row.inventory_items as {
        item_name: string;
        unit: string;
        unit_cost: number | null;
      } | null;

      if (!componentsByBundleId[bundleId]) componentsByBundleId[bundleId] = [];
      componentsByBundleId[bundleId].push({
        item_id: row.item_id as string,
        item_name: inv?.item_name ?? "Item",
        unit: inv?.unit ?? "",
        quantity: Number(row.quantity),
        unit_cost: Number(inv?.unit_cost ?? 0),
      });
    }
  }

  // --- Fetch available inventory items (for dropdowns in bundle form) ---
  let availableItemsQuery = supabase
    .from("inventory_items")
    .select("id, item_name, unit, unit_cost, current_stock");

  if (rawBranchId) {
    availableItemsQuery = availableItemsQuery.eq("branch_id", rawBranchId);
  }
  const { data: rawAvailableItems } = await availableItemsQuery.order("item_name");
  const availableItems = (rawAvailableItems ?? []).map((i) => ({
    id: i.id as string,
    item_name: i.item_name as string,
    unit: i.unit as string,
    unit_cost: Number(i.unit_cost ?? 0),
    current_stock: Number(i.current_stock ?? 0),
  }));

  // --- Fetch stock_claims where bundle_id IS NOT NULL ---
  let claimsQuery = supabase
    .from("stock_claims")
    .select(
      "id, bundle_id, quantity, unit, note, order_id, status, claimed_by, confirmed_by, created_at, confirmed_at, claim_type",
    )
    .not("bundle_id", "is", null)
    .order("created_at", { ascending: false })
    .limit(40);

  if (rawBranchId) {
    claimsQuery = claimsQuery.eq("branch_id", rawBranchId);
  }

  const { data: rawClaims } = await claimsQuery;

  // --- Fetch active orders (for claim order linkage dropdown) ---
  let activeOrdersQuery = supabase
    .from("orders")
    .select("id, order_number, license_plate, customer_name, vehicle_size, status")
    .in("status", ["queued", "in_progress"])
    .order("created_at", { ascending: false })
    .limit(30);

  if (rawBranchId) {
    activeOrdersQuery = activeOrdersQuery.eq("branch_id", rawBranchId);
  }

  const { data: rawActiveOrders } = await activeOrdersQuery;
  const activeOrders: ActiveOrderOption[] = (rawActiveOrders ?? []).map((o) => ({
    id: o.id as string,
    order_number: (o.order_number as string | null) ?? null,
    license_plate: (o.license_plate as string) ?? "-",
    customer_name: (o.customer_name as string) ?? "Pelanggan",
    vehicle_size: (o.vehicle_size as string | null) ?? null,
  }));

  // Map order lookup by id
  const orderLookup = Object.fromEntries(
    (rawActiveOrders ?? []).map((o) => [
      o.id as string,
      `#${o.order_number ?? o.id.slice(0, 6)} - ${o.license_plate} (${o.customer_name})`,
    ]),
  );

  // --- Fetch profile names ---
  const profileIds = Array.from(
    new Set(
      (rawClaims ?? [])
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
      (profiles ?? []).map((p) => [p.id as string, (p.full_name as string) ?? "Staf"]),
    );
  }

  // --- Build bundle name lookup ---
  const bundleNameById = Object.fromEntries(
    bundles.map((b) => [b.id as string, b.bundle_name as string]),
  );

  // Build typed BundleItem list dengan kalkulasi matematika HPP otomatis
  const bundleItems: BundleItem[] = bundles.map((b) => {
    const comps = componentsByBundleId[b.id as string] ?? [];
    const outputQty = Number(b.output_qty ?? 1);
    const totalBatchHpp = comps.reduce(
      (acc, c) => acc + c.quantity * (c.unit_cost || 0),
      0,
    );
    const hppPerUnit = outputQty > 0 ? totalBatchHpp / outputQty : 0;

    return {
      id: b.id as string,
      bundle_name: b.bundle_name as string,
      unit: b.unit as string,
      output_qty: outputQty,
      current_stock: Number(b.current_stock ?? 0),
      description: (b.description as string | null) ?? null,
      components: comps,
      total_hpp_batch: totalBatchHpp,
      hpp_per_unit: hppPerUnit,
    };
  });

  // Build typed BundleClaim list
  const claims: BundleClaim[] = (rawClaims ?? []).map((c) => {
    const bundleId = c.bundle_id as string;
    const orderText = c.order_id ? orderLookup[c.order_id] ?? `Order #${c.order_id.slice(0, 8)}` : null;
    const claimType: "produce" | "use" =
      (c.claim_type as "produce" | "use" | null) ??
      (c.unit === "batch" ? "produce" : "use");

    return {
      id: c.id as string,
      bundle_id: bundleId,
      bundle_name: bundleNameById[bundleId] ?? "Racikan",
      quantity: Number(c.quantity),
      unit: (c.unit as string) ?? "",
      claim_type: claimType,
      note: (c.note as string | null) ?? null,
      order_id: (c.order_id as string | null) ?? null,
      order_label: orderText,
      status: c.status as string,
      claimed_by_name: nameById[c.claimed_by as string] ?? "Staf",
      confirmed_by_name: c.confirmed_by ? (nameById[c.confirmed_by as string] ?? "Staf") : null,
      created_at: c.created_at as string,
      confirmed_at: (c.confirmed_at as string | null) ?? null,
      components: componentsByBundleId[bundleId] ?? [],
    };
  });

  // Hak kelola racikan: owner, maintainer, maintener, manager, finance
  const userRole = session.role as string;
  const canManage = [
    "owner",
    "maintainer",
    "maintener",
    "manager",
    "finance",
  ].includes(userRole);

  // Fetch branch name for header
  const branchRes = effectiveBranchId
    ? await supabase.from("branches").select("branch_name").eq("id", effectiveBranchId).maybeSingle()
    : { data: null };

  return (
    <div className="flex flex-col w-full min-h-screen pb-nav lg:pb-8">
      <SubPageHeader
        title="Kelola Racikan"
        branchName={branchRes.data?.branch_name ?? "Cabang Utama"}
        backHref="/stok"
      />
      <BundleManager
        bundles={bundleItems}
        claims={claims}
        availableItems={availableItems}
        activeOrders={activeOrders}
        canManage={canManage}
        branchId={effectiveBranchId}
      />
      <BottomNav role={session.role} />
    </div>
  );
}
