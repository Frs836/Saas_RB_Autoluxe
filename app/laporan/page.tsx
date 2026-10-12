import { createClient } from "@/lib/supabase/server";
import { BottomNav } from "@/components/dashboard/bottom-nav";
import { SubPageHeader } from "@/components/pos/sub-page-header";
import { LaporanView } from "@/components/laporan/laporan-view";
import { ATTENDANCE_ROLE_LABELS } from "@/lib/attendance";
import { canViewAllBranches } from "@/lib/rbac";
import { requirePermission } from "@/lib/rbac-guard";

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
  const role = session.role;
  const branchId = session.branchId;

  // Admin kasir hanya berhak atas cabangnya sendiri. Owner & Maintainer
  // melihat seluruh cabang karena mempunyai izin branch.switch.
  const globalScope = canViewAllBranches(role);
  const scopedOrders = globalScope
    ? supabase
        .from("orders")
        .select(
          "id, branch_id, total_price, status, assigned_to, completed_at, created_at",
        )
        .eq("status", "completed")
    : supabase
        .from("orders")
        .select(
          "id, branch_id, total_price, status, assigned_to, completed_at, created_at",
        )
        .eq("status", "completed")
        .eq("branch_id", branchId ?? "");

  const scopedCash = globalScope
    ? supabase
        .from("cash_flow")
        .select("id, type, amount, category, branch_id, created_at")
    : supabase
        .from("cash_flow")
        .select("id, type, amount, category, branch_id, created_at")
        .eq("branch_id", branchId ?? "");

  const scopedStock = globalScope
    ? supabase
        .from("inventory_items")
        .select("id, branch_id, item_name, current_stock, unit, min_stock_alert")
    : supabase
        .from("inventory_items")
        .select("id, branch_id, item_name, current_stock, unit, min_stock_alert")
        .eq("branch_id", branchId ?? "");

  const [branchRes, ordersRes, cashRes, stockRes, commissionRes, staffRes] =
    await Promise.all([
      globalScope
        ? supabase.from("branches").select("id, branch_name")
        : supabase
            .from("branches")
            .select("id, branch_name")
            .eq("id", branchId ?? ""),
      scopedOrders,
      scopedCash,
      scopedStock,
      supabase
        .from("commission_settings")
        .select("profile_id, commission_type, value, is_active"),
      globalScope
        ? supabase.from("profiles").select("id, full_name, role")
        : supabase
            .from("profiles")
            .select("id, full_name, role")
            .eq("branch_id", branchId ?? ""),
    ]);

  const branchMap = new Map(
    (branchRes.data ?? []).map((b) => [b.id, b.branch_name]),
  );

  const completedOrders = ordersRes.data ?? [];
  const cashRows = cashRes.data ?? [];
  const stockRows = stockRes.data ?? [];

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

  const activeCommission = (commissionRes.data ?? []).filter(
    (c) => c.is_active && c.profile_id,
  );
  const commissionByProfile = new Map<
    string,
    { type: string; value: number }
  >();
  for (const setting of activeCommission) {
    commissionByProfile.set(setting.profile_id as string, {
      type: setting.commission_type as string,
      value: Number(setting.value ?? 0),
    });
  }

  const commission = (staffRes.data ?? [])
    .map((s) => {
      const rows = completedOrders.filter((o) => o.assigned_to === s.id);
      const revenue = rows.reduce((sum, o) => sum + Number(o.total_price ?? 0), 0);
      const rule = commissionByProfile.get(s.id);
      const value = rule
        ? rule.type === "percent"
          ? (revenue * rule.value) / 100
          : rule.value * rows.length
        : 0;
      return {
        name: s.full_name ?? "Staf",
        roleLabel: ATTENDANCE_ROLE_LABELS[s.role ?? ""] ?? "Staf",
        orders: rows.length,
        revenue,
        commission: value,
        hasRule: Boolean(rule),
      };
    })
    .filter((row) => row.orders > 0 || row.hasRule)
    .sort((a, b) => b.revenue - a.revenue);

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
    finance: { income, expense, net: income - expense, monthly },
    branchRevenue,
    commission,
    stock: { total: stockRows.length, lowCount: lowStock.length, low: lowStock },
    generatedAt: new Date().toISOString(),
  };

  return (
    <div className="flex flex-col w-full min-h-screen">
      <SubPageHeader
        title="Laporan Eksekutif"
        branchName={branchMap.get(session.branchId ?? "") ?? "Cabang Utama"}
        backHref="/dashboard"
      />
      <LaporanView data={data} />
      <BottomNav role={session.role} />
    </div>
  );
}
