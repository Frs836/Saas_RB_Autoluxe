import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { BottomNav } from "@/components/dashboard/bottom-nav";
import { SubPageHeader } from "@/components/pos/sub-page-header";
import { BundleManager, type BundleItem, type BundleClaim } from "@/components/pos/bundle-manager";
import { getSessionProfile, scopedBranchId } from "@/lib/rbac-guard";
import { can } from "@/lib/rbac";

export default async function RacikanPage() {
  const session = await getSessionProfile();

  if (!session) {
    redirect("/login");
  }

  const supabase = await createClient();
  const branchId = scopedBranchId(session);

  // --- Fetch bundle_items ---
  let bundleItemsQuery = supabase
    .from("bundle_items")
    .select("id, bundle_name, unit, description, is_active")
    .eq("is_active", true);
  if (branchId) bundleItemsQuery = bundleItemsQuery.eq("branch_id", branchId);

  const { data: rawBundles } = await bundleItemsQuery.order("bundle_name");

  const bundles = rawBundles ?? [];

  // --- Fetch bundle_components joined inventory_items for each bundle ---
  const bundleIds = bundles.map((b) => b.id as string);

  let componentsByBundleId: Record<string, Array<{ item_id: string; item_name: string; unit: string; quantity: number }>> = {};

  if (bundleIds.length > 0) {
    const { data: rawComponents } = await supabase
      .from("bundle_components")
      .select("bundle_id, item_id, quantity, inventory_items(item_name, unit)")
      .in("bundle_id", bundleIds);

    for (const row of rawComponents ?? []) {
      const bundleId = row.bundle_id as string;
      const inv = row.inventory_items as { item_name: string; unit: string } | null;
      if (!componentsByBundleId[bundleId]) componentsByBundleId[bundleId] = [];
      componentsByBundleId[bundleId].push({
        item_id: row.item_id as string,
        item_name: inv?.item_name ?? "Item",
        unit: inv?.unit ?? "",
        quantity: Number(row.quantity),
      });
    }
  }

  // --- Fetch available inventory items (for dropdowns in bundle form) ---
  let availableItemsQuery = supabase
    .from("inventory_items")
    .select("id, item_name, unit");
  if (branchId) availableItemsQuery = availableItemsQuery.eq("branch_id", branchId);
  const { data: rawAvailableItems } = await availableItemsQuery.order("item_name");
  const availableItems = (rawAvailableItems ?? []).map((i) => ({
    id: i.id as string,
    item_name: i.item_name as string,
    unit: i.unit as string,
  }));

  // --- Fetch stock_claims where bundle_id IS NOT NULL ---
  let claimsQuery = supabase
    .from("stock_claims")
    .select("id, bundle_id, quantity, unit, note, status, claimed_by, confirmed_by, created_at, confirmed_at")
    .not("bundle_id", "is", null)
    .order("created_at", { ascending: false })
    .limit(30);
  if (branchId) claimsQuery = claimsQuery.eq("branch_id", branchId);

  const { data: rawClaims } = await claimsQuery;

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

  // Build typed BundleItem list
  const bundleItems: BundleItem[] = bundles.map((b) => ({
    id: b.id as string,
    bundle_name: b.bundle_name as string,
    unit: b.unit as string,
    description: (b.description as string | null) ?? null,
    components: componentsByBundleId[b.id as string] ?? [],
  }));

  // Build typed BundleClaim list
  const claims: BundleClaim[] = (rawClaims ?? []).map((c) => {
    const bundleId = c.bundle_id as string;
    return {
      id: c.id as string,
      bundle_id: bundleId,
      bundle_name: bundleNameById[bundleId] ?? "Racikan",
      quantity: Number(c.quantity),
      unit: (c.unit as string) ?? "",
      note: (c.note as string | null) ?? null,
      status: c.status as string,
      claimed_by_name: nameById[c.claimed_by as string] ?? "Staf",
      confirmed_by_name: c.confirmed_by ? (nameById[c.confirmed_by as string] ?? "Staf") : null,
      created_at: c.created_at as string,
      confirmed_at: (c.confirmed_at as string | null) ?? null,
      components: componentsByBundleId[bundleId] ?? [],
    };
  });

  const canManage = can(session.role, "stock.approve");

  // Fetch branch name for header
  const branchRes = branchId
    ? await supabase.from("branches").select("branch_name").eq("id", branchId).maybeSingle()
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
        canManage={canManage}
        branchId={branchId ?? ""}
      />
      <BottomNav role={session.role} />
    </div>
  );
}
