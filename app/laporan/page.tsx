import { createClient } from "@/lib/supabase/server";
import { BottomNav } from "@/components/dashboard/bottom-nav";
import { SubPageHeader } from "@/components/pos/sub-page-header";
import { LaporanView } from "@/components/laporan/laporan-view";
import { BranchScopeBadges } from "@/components/branch/branch-scope-badges";
import { requirePermission, scopedBranchId } from "@/lib/rbac-guard";
import { queryError, scopeBranchQuery } from "@/lib/branch";
import { can } from "@/lib/rbac";

export const instant = false;

const MONTH_LABELS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "Mei",
  "Jun",
  "Jul",
  "Agu",
  "Sep",
  "Okt",
  "Nov",
  "Des",
];

function wibParts(value: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(new Date(value));
  const year = parts.find((p) => p.type === "year")?.value ?? "0000";
  const month = parts.find((p) => p.type === "month")?.value ?? "01";
  return { year, month };
}

function monthKey(value: string) {
  const { year, month } = wibParts(value);
  return `${year}-${month}`;
}

function monthLabel(offset: number) {
  const now = new Date();
  const base = new Date(
    Number(
      new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Jakarta",
        year: "numeric",
      }).format(now),
    ),
    Number(
      new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Jakarta",
        month: "numeric",
      }).format(now),
    ) - 1 - offset,
    1,
  );
  return {
    key: `${base.getFullYear()}-${String(base.getMonth() + 1).padStart(2, "0")}`,
    label: `${MONTH_LABELS[base.getMonth()]} ${base.getFullYear()}`,
  };
}

export default async function LaporanPage() {
  const session = await requirePermission("reports.branch");

const supabase = await createClient();
  const branchId = scopedBranchId(session);

  // Admin kasir tidak punya izin branch.switch, jadi scopedBranchId selalu
  // mengembalikan cabangnya sendiri. Owner dan Maintainer mengikuti cabang yang
  // sedang dipilih lewat switcher, dan "all" berarti seluruh cabang.
const [branchRes, ordersRes, cashRes, stockRes] = await Promise.all([
      // branches tidak punya kolom branch_id. Daftar cabang tidak boleh
      // ikut difilter, dan dulu pemanggilan di sini membuat PostgREST
      // mengembalikan error yang tidak pernah dibaca, sehingga seluruh peta
      // cabang kosong tanpa ada tanda kegagalan.
      supabase.from("branches").select("id, branch_name"),
      scopeBranchQuery(
        supabase
          .from("orders")
          .select(
"id, branch_id, total_price, status, assigned_to, completed_at, created_at, payment_state",
          ),
        branchId,
        "orders",
      ),
      scopeBranchQuery(
        supabase
          .from("cash_flow")
          .select("id, type, amount, category, branch_id, created_at"),
        branchId,
        "cash_flow",
      ),
scopeBranchQuery(
        supabase
          .from("inventory_items")
          .select("id, branch_id, item_name, current_stock, unit, min_stock_alert"),
        branchId,
        "inventory_items",
      ),
    ]);

  // Kegagalan di sini berarti angka di layar tidak boleh dipercaya. Tanpa
  // penanda, layar menampilkan nol dan kosong, yang terbaca seperti bisnis
  // sedang tidak berputar.
  queryError(branchRes, "laporan.branches");
  queryError(ordersRes, "laporan.orders");
  queryError(cashRes, "laporan.cash_flow");
queryError(stockRes, "laporan.inventory_items");

const branchMap = new Map(
    (branchRes.data ?? []).map((b) => [b.id, b.branch_name]),
  );

  // Badge cakupan cabang hanya relevan untuk yang boleh berpindah cabang.
  // Admin kasir dan karyawan sudah terkunci ke cabang sendiri, jadi
  // menampilkan daftar cabang hanya menambah pilihan yang tidak bisa dipakai.
  const branchOptions = (branchRes.data ?? []).map((b) => ({
    id: b.id as string,
    name: (b.branch_name as string) ?? "Cabang",
    isActive: true,
  }));

// Semua order cabang diambil tanpa filter status supaya tagihan (order belum
  // lunas) ikut terhitung. Omzet dan unit terjual tetap memakai order selesai.
  const allOrders = ordersRes.data ?? [];
  const completedOrders = allOrders.filter((o) => o.status === "completed");
  const cashRows = cashRes.data ?? [];
  const stockRows = stockRes.data ?? [];

  const completedIds = completedOrders.map((o) => o.id as string);

  // Rincian laporan memakai baris turunan: unit terjual per layanan diambil dari
  // order_items milik order yang sudah selesai (sudah tercakup cabang lewat
  // order induknya), dan mutasi stok dari stock_logs yang punya branch_id.
  const [itemsRes, logRes] = await Promise.all([
    completedIds.length > 0
      ? supabase
          .from("order_items")
          .select("item_name, quantity, price")
          .in("order_id", completedIds)
      : Promise.resolve({
          data: [] as { item_name: string; quantity: number; price: number }[],
          error: null,
        }),
    scopeBranchQuery(
      supabase
        .from("stock_logs")
        .select("id, item_id, log_type, quantity, balance_after, created_at"),
      branchId,
      "stock_logs",
    )
      .order("created_at", { ascending: false })
      .limit(30),
  ]);

  queryError(itemsRes, "laporan.order_items");
  queryError(logRes, "laporan.stock_logs");

  // Keuangan per kategori: pemasukan dan pengeluaran dikelompokkan menurut
  // category agar managerial bisa melihat asal-usul angka, bukan cuma total.
  const cashByCategory = new Map<
    string,
    { category: string; type: string; amount: number; count: number }
  >();
  for (const c of cashRows) {
    const key = `${c.type}:${c.category ?? "-"}`;
    const prev = cashByCategory.get(key) ?? {
      category: c.category ?? "-",
      type: c.type ?? "-",
      amount: 0,
      count: 0,
    };
    prev.amount += Number(c.amount ?? 0);
    prev.count += 1;
    cashByCategory.set(key, prev);
  }
  const financeByCategory = Array.from(cashByCategory.values()).sort(
    (a, b) => b.amount - a.amount,
  );

  // Unit terjual per layanan.
  const soldByName = new Map<string, { name: string; qty: number; revenue: number }>();
  for (const it of itemsRes.data ?? []) {
    const name = it.item_name ?? "Layanan";
    const prev = soldByName.get(name) ?? { name, qty: 0, revenue: 0 };
    prev.qty += Number(it.quantity ?? 0);
    prev.revenue += Number(it.price ?? 0) * Number(it.quantity ?? 0);
    soldByName.set(name, prev);
  }
  const unitsSold = Array.from(soldByName.values()).sort((a, b) => b.qty - a.qty);

  // Tagihan: order yang pembayarannya belum lunas.
  const unpaidOrders = allOrders.filter((o) => o.payment_state === "unpaid");

  // Mutasi stok terakhir beserta nama barangnya.
  const itemNameById = new Map(stockRows.map((s) => [s.id as string, s.item_name as string]));
  const stockMovement = (logRes.data ?? []).map((l) => ({
    itemName: l.item_id ? (itemNameById.get(l.item_id as string) ?? "Item") : "Item",
    logType: l.log_type ?? "-",
    quantity: Number(l.quantity ?? 0),
    balanceAfter: Number(l.balance_after ?? 0),
    createdAt: l.created_at as string,
  }));

  const income = cashRows
    .filter((c) => c.type === "in")
    .reduce((sum, c) => sum + Number(c.amount ?? 0), 0);
  const expense = cashRows
    .filter((c) => c.type === "out")
    .reduce((sum, c) => sum + Number(c.amount ?? 0), 0);

  const monthly = Array.from({ length: 6 }, (_, i) => 5 - i).map((offset) => {
    const { key, label } = monthLabel(offset);
    const rows = cashRows.filter((c) => monthKey(c.created_at) === key);
    return {
      label,
      income: rows
        .filter((c) => c.type === "in")
        .reduce((sum, c) => sum + Number(c.amount ?? 0), 0),
      expense: rows
        .filter((c) => c.type === "out")
        .reduce((sum, c) => sum + Number(c.amount ?? 0), 0),
    };
  });

  const branchRevenue = (branchRes.data ?? []).map((b) => {
    const rows = completedOrders.filter((o) => o.branch_id === b.id);
    return {
      branchName: b.branch_name,
      orders: rows.length,
      revenue: rows.reduce((sum, o) => sum + Number(o.total_price ?? 0), 0),
    };
  });

const lowStock = stockRows
    .filter(
      (s) => Number(s.current_stock ?? 0) <= Number(s.min_stock_alert ?? 0),
    )
    .map((s) => ({
      itemName: s.item_name ?? "Item",
      branchName: s.branch_id ? branchMap.get(s.branch_id) ?? "-" : "-",
      current: Number(s.current_stock ?? 0),
      unit: s.unit ?? "",
      min: Number(s.min_stock_alert ?? 0),
    }));

const data = {
    finance: {
      income,
      expense,
      net: income - expense,
      monthly,
      byCategory: financeByCategory,
    },
    branchRevenue,
    unitsSold,
    receivables: {
      count: unpaidOrders.length,
      total: unpaidOrders.reduce((sum, o) => sum + Number(o.total_price ?? 0), 0),
    },
    stock: {
      total: stockRows.length,
      lowCount: lowStock.length,
      low: lowStock,
      movement: stockMovement,
    },
    generatedAt: new Date().toISOString(),
  };

  return (
    <div className="flex flex-col w-full min-h-screen">
      <SubPageHeader
        title="Laporan Eksekutif"
        branchName={
          branchId ? (branchMap.get(branchId) ?? "Cabang Utama") : "Seluruh Cabang"
        }
        backHref="/dashboard"
      />
      <BranchScopeBadges
        branches={can(session.role, "branch.switch") ? branchOptions : []}
        activeBranchId={branchId}
      />
      <LaporanView data={data} />
      <BottomNav role={session.role} />
    </div>
  );
}

