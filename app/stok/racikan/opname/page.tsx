import { createClient } from "@/lib/supabase/server";
import { BottomNav } from "@/components/dashboard/bottom-nav";
import { SubPageHeader } from "@/components/pos/sub-page-header";
import {
  BundleOpnameView,
  type BundleOpnameLine,
  type BundleOpnameRow,
} from "@/components/stok/bundle-opname-view";
import { requirePermission, scopedBranchId } from "@/lib/rbac-guard";
import { queryError, scopeBranchQuery } from "@/lib/branch";
import { formatAngka } from "@/lib/pos";

export default async function BundleOpnamePage() {
  const session = await requirePermission("stock.approve");

  const supabase = await createClient();
  const branchId = scopedBranchId(session);

  const defaultPeriod = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
  }).format(new Date());

  const [branchRes, opnameRes] = await Promise.all([
    branchId
      ? supabase
          .from("branches")
          .select("branch_name")
          .eq("id", branchId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    scopeBranchQuery(
      (supabase.from("stock_opnames") as any)
        .select("id, period_month, status, notes, submitted_at, created_at")
        .eq("opname_type", "bundle"),
      branchId,
      "stock_opnames",
    )
      .order("period_month", { ascending: false })
      .limit(12),
  ]);

  const opnameRows = (opnameRes.data ?? []) as any[];
  const opnameIds = opnameRows.map((row) => row.id as string);

  const { data: lineRows, error: linesError } = opnameIds.length
    ? await (supabase.from("stock_opname_lines") as any)
        .select("id, opname_id, bundle_id, system_qty, physical_qty, difference, note")
        .in("opname_id", opnameIds)
    : { data: [], error: null };

  queryError({ error: linesError }, "bundle.opname.lines");

  const lines = (lineRows ?? []) as Array<{
    id: string;
    opname_id: string;
    bundle_id: string;
    system_qty: number;
    physical_qty: number | null;
    difference: number | null;
    note: string | null;
  }>;

  const bundleIds = Array.from(new Set(lines.map((l) => l.bundle_id).filter(Boolean)));

  let bundleInfoById: Record<
    string,
    {
      name: string;
      unit: string;
      output_qty: number;
      formula_preview: string | null;
      hpp_per_unit: number;
      total_batch_cost: number;
    }
  > = {};

  if (bundleIds.length > 0) {
    const [bundlesRes, componentsRes] = await Promise.all([
      supabase
        .from("bundle_items")
        .select("id, bundle_name, unit, output_qty")
        .in("id", bundleIds),
      supabase
        .from("bundle_components")
        .select("bundle_id, item_id, quantity, inventory_items(item_name, unit, unit_cost)")
        .in("bundle_id", bundleIds),
    ]);

    const compMap: Record<
      string,
      Array<{ name: string; qty: number; unit: string; cost: number }>
    > = {};

    for (const c of componentsRes.data ?? []) {
      const bId = c.bundle_id as string;
      const inv = c.inventory_items as {
        item_name: string;
        unit: string;
        unit_cost: number | null;
      } | null;

      if (!compMap[bId]) compMap[bId] = [];
      compMap[bId].push({
        name: inv?.item_name ?? "Item",
        qty: Number(c.quantity),
        unit: inv?.unit ?? "",
        cost: Number(inv?.unit_cost ?? 0),
      });
    }

    for (const b of bundlesRes.data ?? []) {
      const bId = b.id as string;
      const comps = compMap[bId] ?? [];
      const formulaStr = comps
        .map((cp) => `${formatAngka(cp.qty)} ${cp.unit.toUpperCase()} ${cp.name}`)
        .join(" + ");

      const totalBatchCost = comps.reduce((acc, cp) => acc + cp.qty * cp.cost, 0);
      const outQty = Math.max(1, Number(b.output_qty ?? 1));
      const hpp = totalBatchCost / outQty;

      bundleInfoById[bId] = {
        name: b.bundle_name as string,
        unit: (b.unit as string)?.toLowerCase() ?? "ml",
        output_qty: outQty,
        formula_preview: formulaStr || null,
        hpp_per_unit: Math.round(hpp),
        total_batch_cost: Math.round(totalBatchCost),
      };
    }
  }

  const linesByOpname: Record<string, BundleOpnameLine[]> = {};
  for (const line of lines) {
    const bucket = (linesByOpname[line.opname_id] ??= []);
    const info = bundleInfoById[line.bundle_id];

    bucket.push({
      id: line.id,
      bundle_id: line.bundle_id,
      bundle_name: info?.name ?? "Racikan",
      unit: info?.unit ?? "ml",
      output_qty: info?.output_qty ?? 1,
      hpp_per_unit: info?.hpp_per_unit ?? null,
      total_batch_cost: info?.total_batch_cost ?? null,
      formula_preview: info?.formula_preview ?? null,
      system_qty: Number(line.system_qty),
      physical_qty: line.physical_qty === null ? null : Number(line.physical_qty),
      difference: line.difference === null ? null : Number(line.difference),
      note: line.note ?? null,
    });
  }

  const opnames: BundleOpnameRow[] = opnameRows.map((row) => {
    const bucket = linesByOpname[row.id as string] ?? [];
    return {
      id: row.id as string,
      period_month: String(row.period_month).slice(0, 7),
      status: row.status as BundleOpnameRow["status"],
      notes: (row.notes as string) ?? null,
      submitted_at: (row.submitted_at as string) ?? null,
      created_at: row.created_at as string,
      line_count: bucket.length,
      counted_count: bucket.filter((line) => line.physical_qty !== null).length,
    };
  });

  const branchName =
    branchRes.data?.branch_name ??
    (session.branchScope === "all" ? "Seluruh Cabang" : "Cabang Utama");

  return (
    <div className="flex flex-col w-full min-h-screen pb-nav lg:pb-8">
      <SubPageHeader
        title="Opname Stok Racikan"
        branchName={branchName}
        backHref="/stok/racikan"
      />
      <main className="flex-1">
        <BundleOpnameView
          opnames={opnames}
          linesByOpname={linesByOpname}
          branchId={branchId}
          branchName={branchName}
          defaultPeriod={defaultPeriod}
        />
      </main>
      <BottomNav role={session.role} />
    </div>
  );
}
