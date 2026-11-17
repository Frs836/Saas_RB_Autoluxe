import { createClient } from "@/lib/supabase/server";
import { BottomNav } from "@/components/dashboard/bottom-nav";
import { SubPageHeader } from "@/components/pos/sub-page-header";
import {
  StockOpnameView,
  type OpnameLine,
  type OpnameRow,
} from "@/components/stok/stock-opname-view";
import { requirePermission, scopedBranchId } from "@/lib/rbac-guard";
import { queryError, scopeBranchQuery } from "@/lib/branch";


export default async function StockOpnamePage() {
  const session = await requirePermission("stock.approve");

  const supabase = await createClient();
  const branchId = scopedBranchId(session);

  // month() di PostgREST mengembalikan kolom tanggal terpotong bulan, sehingga
  // hasilnya selalu tanggal satu.
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
      supabase
        .from("stock_opnames")
        .select("id, period_month, status, notes, submitted_at, created_at")
        .or("opname_type.eq.inventory,opname_type.is.null"),
      branchId,
      "stock_opnames",
    )
      .order("period_month", { ascending: false })
      .limit(12),
  ]);

  const opnameRows = opnameRes.data ?? [];
  const opnameIds = opnameRows.map((row) => row.id as string);

  // stock_opname_lines tidak punya kolom branch_id. Cakupannya sudah benar
  // lewat opname_ids di atas, yang diambil dari stock_opnames yang sudah
  // difilter cabang. Difilter lagi di sini hanya menghasilkan error PostgREST
  // yang selama ini tidak terbaca, sehingga detail item selalu tampil kosong.
  const { data: lineRows, error: linesError } = opnameIds.length
    ? await supabase
        .from("stock_opname_lines")
        .select(
          "id, opname_id, item_id, system_qty, physical_qty, difference, note",
        )
        .in("opname_id", opnameIds)
    : { data: [], error: null };

  queryError({ error: linesError }, "opname.lines");

  const lines = (lineRows ?? []) as Array<{
    id: string;
    opname_id: string;
    item_id: string;
    system_qty: number;
    physical_qty: number | null;
    difference: number | null;
    note: string | null;
  }>;

  const itemIds = Array.from(new Set(lines.map((line) => line.item_id)));
  let itemInfoById: Record<string, {
    name: string;
    unit: string;
    unit_cost: number | null;
    purchase_unit: string | null;
    purchase_content_qty: number | null;
  }> = {};
  if (itemIds.length > 0) {
    const { data: items } = await scopeBranchQuery(
      supabase.from("inventory_items").select("id, item_name, unit, unit_cost, purchase_unit, purchase_content_qty"),
      branchId,
      "inventory_items",
    ).in("id", itemIds);
    itemInfoById = Object.fromEntries(
      (items ?? []).map((item) => [
        item.id as string,
        {
          name: (item.item_name as string) ?? "Item",
          unit: (item.unit as string) ?? "",
          unit_cost: item.unit_cost !== null && item.unit_cost !== undefined ? Number(item.unit_cost) : null,
          purchase_unit: (item.purchase_unit as string) ?? null,
          purchase_content_qty: item.purchase_content_qty !== null && item.purchase_content_qty !== undefined ? Number(item.purchase_content_qty) : null,
        },
      ]),
    );
  }

  const linesByOpname: Record<string, OpnameLine[]> = {};
  for (const line of lines) {
    const bucket = (linesByOpname[line.opname_id] ??= []);
    const info = itemInfoById[line.item_id];
    bucket.push({
      id: line.id,
      item_id: line.item_id,
      item_name: info?.name ?? "Item",
      unit: info?.unit ?? "",
      unit_cost: info?.unit_cost ?? null,
      purchase_unit: info?.purchase_unit ?? null,
      purchase_content_qty: info?.purchase_content_qty ?? null,
      system_qty: Number(line.system_qty),
      physical_qty: line.physical_qty === null ? null : Number(line.physical_qty),
      difference: line.difference === null ? null : Number(line.difference),
      note: line.note ?? null,
    });
  }

  const opnames: OpnameRow[] = opnameRows.map((row) => {
    const bucket = linesByOpname[row.id as string] ?? [];
    return {
      id: row.id as string,
      period_month: String(row.period_month).slice(0, 7),
      status: row.status as OpnameRow["status"],
      notes: (row.notes as string) ?? null,
      submitted_at: (row.submitted_at as string) ?? null,
      created_at: row.created_at as string,
      line_count: bucket.length,
      counted_count: bucket.filter((line) => line.physical_qty !== null).length,
    };
  });

  return (
    <div className="flex flex-col w-full min-h-screen pb-nav lg:pb-8">
      <SubPageHeader
        title="Opname Fisik Bulanan"
        branchName={
          branchRes.data?.branch_name ??
          (session.branchScope === "all" ? "Seluruh Cabang" : "Cabang Utama")
        }
        backHref="/stok"
      />
      <main className="flex-1">
        <StockOpnameView
          opnames={opnames}
          linesByOpname={linesByOpname}
          branchId={branchId}
          branchName={
            branchRes.data?.branch_name ??
            (session.branchScope === "all" ? "Seluruh Cabang" : "Cabang Utama")
          }
          defaultPeriod={defaultPeriod}
        />
      </main>
      <BottomNav role={session.role} />
    </div>
  );
}
