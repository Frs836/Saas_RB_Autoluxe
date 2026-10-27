import Link from "next/link";
import { redirect } from "next/navigation";
import { BottomNav } from "@/components/dashboard/bottom-nav";
import { SubPageHeader } from "@/components/pos/sub-page-header";
import {
  RecipeManager,
  type RecipeItem,
  type RecipeRow,
  type RecipeService,
} from "@/components/pos/recipe-manager";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/rbac-guard";


/**
 * Resep bahan per layanan.
 *
 * Stok dan resep terikat cabang, jadi halaman ini selalu bekerja pada satu
 * cabang. Pengguna dengan cakupan seluruh cabang memilih cabang lewat tautan
 * di bawah judul; pengguna yang terikat satu cabang tidak melihat pilihan itu.
 */
export default async function ServiceRecipePage({
  searchParams,
}: {
  searchParams: Promise<{ branch?: string }>;
}) {
  const session = await requirePermission("services.manage");
  const params = await searchParams;

  const branches = session.branches.filter((branch) => branch.isActive);
  const branchId =
    branches.find((branch) => branch.id === params.branch)?.id ??
    branches.find((branch) => branch.id === session.homeBranchId)?.id ??
    branches.find((branch) => branch.id === session.branchId)?.id ??
    branches[0]?.id ??
    null;

  if (!branchId) {
    redirect("/dashboard");
  }

  const supabase = await createClient();

  const [servicesRes, itemsRes, recipesRes] = await Promise.all([
    supabase
      .from("services")
      .select("id, name, is_active")
      .order("name", { ascending: true }),
    supabase
      .from("inventory_items")
      .select("id, item_name, current_stock, unit")
      .eq("branch_id", branchId)
      .order("item_name", { ascending: true }),
    supabase
      .from("service_material_recipes")
      .select(
        "service_id, item_id, qty_s, qty_m, qty_l, qty_xl, qty_motor_s, qty_motor_m, qty_motor_l, qty_motor_xl"
      )
      .eq("branch_id", branchId),
  ]);

  const services: RecipeService[] = (servicesRes.data ?? []).map((row) => ({
    id: row.id as string,
    name: (row.name as string) ?? "",
  }));

  const items: RecipeItem[] = (itemsRes.data ?? []).map((row) => ({
    id: row.id as string,
    item_name: (row.item_name as string) ?? "",
    current_stock: Number(row.current_stock ?? 0),
    unit: (row.unit as string) ?? "",
  }));

  const recipes: RecipeRow[] = (recipesRes.data ?? []).map((row) => ({
    service_id: row.service_id as string,
    item_id: row.item_id as string,
    qty_s: row.qty_s !== null && row.qty_s !== undefined ? Number(row.qty_s) : undefined,
    qty_m: row.qty_m !== null && row.qty_m !== undefined ? Number(row.qty_m) : undefined,
    qty_l: row.qty_l !== null && row.qty_l !== undefined ? Number(row.qty_l) : undefined,
    qty_xl: row.qty_xl !== null && row.qty_xl !== undefined ? Number(row.qty_xl) : undefined,
    qty_motor_s: row.qty_motor_s !== null && row.qty_motor_s !== undefined ? Number(row.qty_motor_s) : undefined,
    qty_motor_m: row.qty_motor_m !== null && row.qty_motor_m !== undefined ? Number(row.qty_motor_m) : undefined,
    qty_motor_l: row.qty_motor_l !== null && row.qty_motor_l !== undefined ? Number(row.qty_motor_l) : undefined,
    qty_motor_xl: row.qty_motor_xl !== null && row.qty_motor_xl !== undefined ? Number(row.qty_motor_xl) : undefined,
  }));

  const branchName =
    branches.find((branch) => branch.id === branchId)?.name ?? "Cabang";

  return (
    <div className="flex min-h-screen w-full flex-col pb-nav-plain">
      <SubPageHeader title="Resep Bahan Jasa" backHref="/dashboard" />

      {session.branchScope === "all" && branches.length > 1 ? (
        <div className="-mx-1 flex gap-2 overflow-x-auto px-4 pb-1 pt-3">
          {branches.map((branch) => (
            <Link
              key={branch.id}
              href={`/pengaturan/resep?branch=${branch.id}`}
              className={`min-h-10 shrink-0 rounded-full px-3.5 font-body-bold text-body-bold ${
                branch.id === branchId
                  ? "bg-brand-600 text-white"
                  : "bg-surface text-text-secondary"
              }`}
            >
              {branch.name}
            </Link>
          ))}
        </div>
      ) : (
        <p className="px-gutter pt-3 font-caption text-caption text-text-muted">
          Cabang: {branchName}
        </p>
      )}

      {services.length === 0 || items.length === 0 ? (
        <main className="flex-1 px-gutter py-6">
          <p className="font-body text-body text-text-secondary">
            {services.length === 0
              ? "Belum ada jasa di katalog. Tambahkan jasa lebih dulu di Kelola Jasa POS."
              : "Belum ada bahan di gudang cabang ini. Tambahkan stok lebih dulu."}
          </p>
        </main>
      ) : (
        <RecipeManager
          branchId={branchId}
          services={services}
          items={items}
          initialRecipes={recipes}
        />
      )}

      <BottomNav role={session.role} />
    </div>
  );
}
