import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { BottomNav } from "@/components/dashboard/bottom-nav";
import { SubPageHeader } from "@/components/pos/sub-page-header";
import {
  WhatsappConsole,
  type WaClaim,
  type WaOrder,
} from "@/components/whatsapp/whatsapp-console";
import { requirePermission, scopedBranchId } from "@/lib/rbac-guard";
import { scopeBranchQuery } from "@/lib/branch";


export default async function WhatsappPage() {
  const session = await requirePermission("whatsapp.draft");

  const supabase = await createClient();
  // null berarti seluruh cabang, sesuai pilihan pada branch switcher.
  const branchId = scopedBranchId(session);

  const [branchRes, ordersRes] = await Promise.all([
    branchId
      ? supabase
          .from("branches")
          .select("branch_name")
          .eq("id", branchId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    scopeBranchQuery(
      supabase
        .from("orders")
        .select(
"id, order_number, customer_name, customer_phone, license_plate, vehicle_model, vehicle_size, service_package, status, total_price, payment_method, payment_state, tracking_token, created_at, completed_at, branch_id",
        ),
        branchId,
        "orders",
      )
      .order("created_at", { ascending: false })
      .limit(100),
  ]);

  // RLS sudah membatasi karyawan pada order miliknya; filter cabang di sini
  // berlaku untuk role manajerial.
  const branchName =
    branchRes.data?.branch_name ??
    (session.branchScope === "all" ? "Seluruh Cabang" : "Cabang Utama");

  const orderRows = ordersRes.data ?? [];

  const orderIds = orderRows.map((row) => row.id as string);

  const [itemsRes, warrantyRes, claimsRes] = await Promise.all([
    orderIds.length
      ? supabase
          .from("order_items")
          .select("order_id, item_name, price, quantity")
          .in("order_id", orderIds)
      : Promise.resolve({ data: [] }),
    orderIds.length
      ? supabase
          .from("warranties")
          .select("order_id, warranty_code, end_date, status")
          .in("order_id", orderIds)
      : Promise.resolve({ data: [] }),
    orderIds.length
      ? supabase
          .from("warranty_claims")
          .select("order_id, claim_date, status, problem_description, resolution_note")
          .in("order_id", orderIds)
          .order("claim_date", { ascending: false })
      : Promise.resolve({ data: [] }),
  ]);

  const itemsByOrder = new Map<string, { name: string; price: number; quantity: number }[]>();
  for (const item of itemsRes.data ?? []) {
    const list = itemsByOrder.get(item.order_id) ?? [];
    list.push({
      name: item.item_name as string,
      price: Number(item.price),
      quantity: Number(item.quantity),
    });
    itemsByOrder.set(item.order_id, list);
  }

  const warrantyByOrder = new Map<
    string,
    { warrantyCode: string; endDate: string; status: string }
  >();
  for (const warranty of warrantyRes.data ?? []) {
    if (!warrantyByOrder.has(warranty.order_id)) {
      warrantyByOrder.set(warranty.order_id, {
        warrantyCode: warranty.warranty_code as string,
        endDate: warranty.end_date as string,
        status: warranty.status as string,
      });
    }
  }

  const claims: WaClaim[] = (claimsRes.data ?? []).map((claim) => ({
    orderId: claim.order_id as string,
    claimDate: claim.claim_date as string,
    status: claim.status as string,
    problemDescription: claim.problem_description as string,
    resolutionNote: (claim.resolution_note as string) ?? null,
  }));

  const orders: WaOrder[] = orderRows.map((row) => ({
    id: row.id as string,
    orderNumber: row.order_number as string,
    customerName: row.customer_name as string,
    customerPhone: (row.customer_phone as string) ?? null,
    licensePlate: row.license_plate as string,
    vehicleModel: row.vehicle_model as string,
    vehicleSize: row.vehicle_size as string,
    servicePackage: (row.service_package as string) ?? "-",
    status: row.status as string,
    totalPrice: Number(row.total_price),
    paymentMethod: (row.payment_method as string) ?? null,
    paymentState: (row.payment_state as string) ?? null,
    trackingToken: row.tracking_token as string,
    createdAt: row.created_at as string,
    completedAt: (row.completed_at as string) ?? null,
    items: itemsByOrder.get(row.id as string) ?? [],
    warranty: warrantyByOrder.get(row.id as string) ?? null,
  }));

  const headerList = await headers();
  const host = headerList.get("x-forwarded-host") ?? headerList.get("host");
  const protocol =
    headerList.get("x-forwarded-proto") ??
    (process.env.NODE_ENV === "production" ? "https" : "http");
  const origin = host ? `${protocol}://${host}` : "";

  return (
    <>
      <SubPageHeader
        title="Integrasi WhatsApp"
        subtitle={branchName}
        backHref="/dashboard"
      />
      <main className="flex-1">
        <WhatsappConsole
          orders={orders}
          claims={claims}
          branchName={branchName}
          origin={origin}
        />
      </main>
      <BottomNav role={session.role} />
    </>
  );
}
