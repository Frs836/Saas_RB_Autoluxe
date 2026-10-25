import { createClient } from "@/lib/supabase/server";
import { BottomNav } from "@/components/dashboard/bottom-nav";
import { SubPageHeader } from "@/components/pos/sub-page-header";
import {
  InvoiceHistory,
  type InvoiceRow,
} from "@/components/invoice/invoice-history";
import { requirePermission, scopedBranchId } from "@/lib/rbac-guard";
import { queryError, scopeBranchQuery } from "@/lib/branch";


/**
 * Riwayat invoice.
 *
 * Nota sebelumnya hanya hidup di printer atau di percakapan WhatsApp. Halaman
 * ini membaca baris invoices yang terbit bersama order, sehingga struk lama
 * bisa dicari dan dicetak ulang tanpa harus menggali order satu per satu.
 */
export default async function InvoicePage() {
  const session = await requirePermission("reports.branch");
  const supabase = await createClient();
  const branchId = scopedBranchId(session);

  const [branchRes, invoicesRes, itemsRes, ordersRes] = await Promise.all([
    branchId
      ? supabase
          .from("branches")
          .select("branch_name")
          .eq("id", branchId)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    scopeBranchQuery(
      supabase
        .from("invoices")
        .select(
          "id, order_id, invoice_number, total_price, payment_method, payment_state, status, customer_name, customer_phone, license_plate, vehicle_model, vehicle_size, service_package, issued_at, branch_id",
        ),
      branchId,
      "invoices",
    )
      .order("issued_at", { ascending: false })
      .limit(120),
    supabase.from("order_items").select("order_id, item_name, quantity, price"),
    supabase
      .from("orders")
      .select("id, tracking_token")
      .limit(200),
  ]);

  queryError(branchRes, "invoice.branches");
  queryError(invoicesRes, "invoice.invoices");

  const raw = invoicesRes.data ?? [];

  // Rincian item diambil terpisah lalu digabung berdasarkan order_id. Baris
  // invoice tetap yang jadi sumber utama supaya halaman ini tetap terbaca
  // walau rincian item belum tersedia.
  const itemsByOrder = new Map<
    string,
    { name: string; quantity: number; total: number }[]
  >();
  for (const item of itemsRes.data ?? []) {
    const key = item.order_id as string;
    const list = itemsByOrder.get(key) ?? [];
    list.push({
      name: (item.item_name as string) ?? "Layanan",
      quantity: Number(item.quantity ?? 0),
      total: Number(item.price ?? 0) * Number(item.quantity ?? 0),
    });
    itemsByOrder.set(key, list);
  }

  const tokenByOrder = new Map<string, string>();
  for (const order of ordersRes.data ?? []) {
    const token = order.tracking_token as string | null;
    if (token) tokenByOrder.set(order.id as string, token);
  }

  const branchName =
    (branchRes.data?.branch_name as string | undefined) ??
    (branchId ? "Cabang" : "Seluruh Cabang");

  const invoices: InvoiceRow[] = raw.map((row) => ({
    id: row.id as string,
    orderId: row.order_id as string,
    invoiceNumber: row.invoice_number as string,
    totalPrice: Number(row.total_price ?? 0),
    paymentMethod: (row.payment_method as string) ?? "cash",
    paymentState: (row.payment_state as string) ?? "paid",
    status: (row.status as string) ?? "queued",
    customerName: (row.customer_name as string) ?? "-",
    customerPhone: (row.customer_phone as string) ?? "",
    licensePlate: (row.license_plate as string) ?? "-",
    vehicleModel: (row.vehicle_model as string) ?? "-",
    vehicleSize: (row.vehicle_size as string) ?? "",
    servicePackage: (row.service_package as string) ?? "-",
    issuedAt: (row.issued_at as string) ?? "",
    branchName,
    trackingToken: tokenByOrder.get(row.order_id as string) ?? "",
    items: itemsByOrder.get(row.order_id as string) ?? [],
  }));

  return (
    <div className="flex flex-col w-full min-h-screen">
      <SubPageHeader
        title="Riwayat Invoice"
        branchName={branchName}
        backHref="/dashboard"
      />
      <InvoiceHistory invoices={invoices} />
      <BottomNav role={session.role} />
    </div>
  );
}
