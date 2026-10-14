import { createClient } from "@/lib/supabase/server";
import { BottomNav } from "@/components/dashboard/bottom-nav";
import { SubPageHeader } from "@/components/pos/sub-page-header";
import { GaransiConsole } from "@/components/garansi/garansi-console";
import { requirePermission, scopedBranchId } from "@/lib/rbac-guard";
import { scopeBranchQuery } from "@/lib/branch";

export const instant = false;

export default async function GaransiPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const session = await requirePermission("warranty.manage");

  const supabase = await createClient();
  const branchId = scopedBranchId(session);
  const { q } = await searchParams;
  const search = (q ?? "").trim();

  const { data: branch } = branchId
    ? await supabase
        .from("branches")
        .select("branch_name")
        .eq("id", branchId)
        .maybeSingle()
    : { data: null };

  // PRD menetapkan klaim garansi dicari lewat plat nomor. Karena itu daftar
  // order tidak lagi dipotong 30 baris yang membuat order lama tidak bisa
  // diklaim, melainkan difilter di server sesuai pencarian. Tanpa pencarian,
  // 200 order terbaru dipakai sebagai daftar awal.
  const ORDER_FIELDS =
    "id, order_number, customer_name, license_plate, total_price, completed_at";
  const BASE_LIMIT = 200;

  type CompletedOrder = {
    id: string;
    order_number: string;
    customer_name: string;
    license_plate: string | null;
    total_price: number;
    completed_at: string | null;
  };

  let orderRows: CompletedOrder[] = [];

  if (search.length > 0) {
    // ilike hanya berlaku pada satu kolom, jadi plat dan nomor order dicari
    // terpisah lalu digabung agar tidak ada order yang terlewat.
    const [byPlate, byNumber] = await Promise.all([
      scopeBranchQuery(
        supabase.from("orders").select(ORDER_FIELDS),
        branchId,
        "orders",
      )
        .eq("status", "completed")
        .ilike("license_plate", `%${search}%`)
        .order("completed_at", { ascending: false })
        .limit(BASE_LIMIT),
      scopeBranchQuery(
        supabase.from("orders").select(ORDER_FIELDS),
        branchId,
        "orders",
      )
        .eq("status", "completed")
        .ilike("order_number", `%${search}%`)
        .order("completed_at", { ascending: false })
        .limit(BASE_LIMIT),
    ]);

    const merged = new Map<string, CompletedOrder>();
    for (const row of [...(byPlate.data ?? []), ...(byNumber.data ?? [])]) {
      merged.set(row.id as string, row as CompletedOrder);
    }

    orderRows = Array.from(merged.values()).sort((a, b) =>
      String(b.completed_at ?? "").localeCompare(String(a.completed_at ?? "")),
    );
  } else {
    const recent = await scopeBranchQuery(
      supabase.from("orders").select(ORDER_FIELDS),
      branchId,
      "orders",
    )
      .eq("status", "completed")
      .order("completed_at", { ascending: false })
      .limit(BASE_LIMIT);
    orderRows = (recent.data ?? []) as CompletedOrder[];
  }
  const orderIds = orderRows.map((o) => o.id as string);

  // warranties tidak punya branch_id sendiri, jadi cakupan cabang diambil dari
  // order induknya. Query langsung ke warranties dengan filter branch_id akan
  // gagal dan membocorkan garansi cabang lain.
  const { data: warranties } = orderIds.length
    ? await supabase
        .from("warranties")
        .select("id, order_id, warranty_code, start_date, end_date, status")
        .in("order_id", orderIds)
        .order("start_date", { ascending: false })
    : { data: [] as { id: string; order_id: string | null; warranty_code: string; start_date: string; end_date: string; status: string }[] };

  const { data: claims } = orderIds.length
    ? await supabase
        .from("warranty_claims")
        .select("order_id, claim_date, status, problem_description")
        .in("order_id", orderIds)
        .order("claim_date", { ascending: false })
    : { data: [] as { order_id: string; claim_date: string; status: string; problem_description: string }[] };

  return (
    <>
      <SubPageHeader
        title="Klaim Garansi"
        subtitle={
          branch?.branch_name ??
          (session.branchScope === "all" ? "Seluruh Cabang" : undefined)
        }
        backHref="/dashboard"
      />
      <main className="flex-1">
        <GaransiConsole
          canManage={true}
          search={search || null}
          orders={orderRows.map((o) => ({
            id: o.id as string,
            orderNumber: o.order_number as string,
            customerName: o.customer_name as string,
            vehiclePlate: (o.license_plate as string) ?? null,
            totalPrice: Number(o.total_price),
            completedAt: (o.completed_at as string) ?? null,
          }))}
          warranties={(warranties ?? []).map((w) => ({
            id: w.id as string,
            orderId: (w.order_id as string) ?? null,
            warrantyCode: w.warranty_code as string,
            startDate: w.start_date as string,
            endDate: w.end_date as string,
            status: w.status as string,
          }))}
          claims={(claims ?? []).map((c) => ({
            orderId: c.order_id as string,
            claimDate: c.claim_date as string,
            status: c.status as string,
            problemDescription: c.problem_description as string,
          }))}
        />
      </main>
      <BottomNav role={session.role} />
    </>
  );
}