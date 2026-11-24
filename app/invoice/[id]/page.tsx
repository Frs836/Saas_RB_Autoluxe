import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  InvoicePrintable,
  type PrintableInvoiceData,
} from "@/components/invoice/invoice-printable";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return {
    title: `Invoice #${id.slice(0, 8)} - RB Autoluxe`,
    description: "Invoice & Kartu Garansi Resmi RB Autoluxe",
  };
}

export default async function InvoiceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  // Cari order berdasarkan id, atau invoice_number, atau order_number
  let orderQuery = supabase
    .from("orders")
    .select(
      "id, order_number, branch_id, customer_name, customer_phone, license_plate, vehicle_model, vehicle_size, service_package, total_price, payment_method, payment_state, status, tracking_token, created_at, completed_at, paid_at",
    );

  // Jika UUID
  const isUuid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      id,
    );

  if (isUuid) {
    orderQuery = orderQuery.or(`id.eq.${id},tracking_token.eq.${id}`);
  } else {
    orderQuery = orderQuery.or(
      `order_number.eq.${id},tracking_token.eq.${id}`,
    );
  }

  const { data: order, error: orderErr } = await orderQuery.maybeSingle();

  if (orderErr || !order) {
    // Coba cari dari tabel invoices jika id adalah invoice id
    if (isUuid) {
      const { data: inv } = await supabase
        .from("invoices")
        .select("order_id")
        .eq("id", id)
        .maybeSingle();
      if (inv?.order_id) {
        const { data: ord } = await supabase
          .from("orders")
          .select(
            "id, order_number, branch_id, customer_name, customer_phone, license_plate, vehicle_model, vehicle_size, service_package, total_price, payment_method, payment_state, status, tracking_token, created_at, completed_at, paid_at",
          )
          .eq("id", inv.order_id)
          .maybeSingle();
        if (ord) {
          return renderInvoice(ord, supabase);
        }
      }
    }
    notFound();
  }

  return renderInvoice(order, supabase);
}

async function renderInvoice(
  order: {
    id: string;
    order_number: string;
    branch_id: string;
    customer_name: string | null;
    customer_phone: string | null;
    license_plate: string;
    vehicle_model: string;
    vehicle_size: string | null;
    service_package: string;
    total_price: number;
    payment_method: string | null;
    payment_state: string;
    status: string;
    tracking_token: string | null;
    created_at: string;
    completed_at: string | null;
    paid_at: string | null;
  },
  supabase: any,
) {
  const [branchRes, itemsRes, warrantyRes, schedulesRes] = await Promise.all([
    supabase
      .from("branches")
      .select("branch_name, address")
      .eq("id", order.branch_id)
      .maybeSingle(),
    supabase
      .from("order_items")
      .select("item_name, quantity, price")
      .eq("order_id", order.id)
      .order("created_at", { ascending: true }),
    supabase
      .from("warranties")
      .select("warranty_code, start_date, end_date, status")
      .eq("order_id", order.id)
      .maybeSingle(),
    supabase
      .from("maintenance_schedules")
      .select("id, schedule_type, due_date, status, notes")
      .eq("order_id", order.id)
      .order("due_date", { ascending: true }),
  ]);

  const items = (itemsRes.data ?? []).map((i: any) => ({
    name: i.item_name ?? "Layanan",
    quantity: Number(i.quantity ?? 1),
    price: Number(i.price ?? 0),
    total: Number(i.quantity ?? 1) * Number(i.price ?? 0),
  }));

  // Jika belum ada jadwal di tabel maintenance_schedules tapi ada completed_at, hitung dinamis
  let schedules = schedulesRes.data ?? [];
  if (
    schedules.length === 0 &&
    (order.service_package?.toLowerCase().includes("coating") ||
      order.service_package?.toLowerCase().includes("polish") ||
      warrantyRes.data)
  ) {
    const baseDate = new Date(order.completed_at || order.created_at);
    const d6 = new Date(baseDate);
    d6.setMonth(d6.getMonth() + 6);
    const d12 = new Date(baseDate);
    d12.setFullYear(d12.getFullYear() + 1);

    schedules = [
      {
        id: "est-6",
        scheduleType: "6_month",
        dueDate: d6.toISOString().split("T")[0],
        status: "pending",
        notes:
          "Perawatan berkala layer coating, pembersihan jamur & kerak air (Bulan ke-6).",
      },
      {
        id: "est-12",
        scheduleType: "12_month",
        dueDate: d12.toISOString().split("T")[0],
        status: "pending",
        notes:
          "Inspeksi tahunan, evaluasi garansi & touch-up proteksi cat (Bulan ke-12).",
      },
    ];
  } else {
    schedules = schedules.map((s: any) => ({
      id: s.id,
      scheduleType: s.schedule_type,
      dueDate: s.due_date,
      status: s.status,
      notes: s.notes,
    }));
  }

  const invoiceData: PrintableInvoiceData = {
    orderId: order.id,
    orderNumber: order.order_number,
    invoiceNumber: `INV/${order.order_number}`,
    createdAt: order.created_at,
    completedAt: order.completed_at,
    paidAt: order.paid_at,
    status: order.status,
    paymentState: order.payment_state,
    paymentMethod: order.payment_method ?? "cash",
    totalPrice: Number(order.total_price ?? 0),
    customerName: order.customer_name ?? "Pelanggan",
    customerPhone: order.customer_phone,
    licensePlate: order.license_plate,
    vehicleModel: order.vehicle_model,
    vehicleSize: order.vehicle_size,
    servicePackage: order.service_package,
    trackingToken: order.tracking_token,
    branchName: branchRes.data?.branch_name ?? "RB Autoluxe",
    branchAddress: branchRes.data?.address,
    items,
    warranty: warrantyRes.data
      ? {
          warrantyCode: warrantyRes.data.warranty_code,
          startDate: warrantyRes.data.start_date,
          endDate: warrantyRes.data.end_date,
          status: warrantyRes.data.status,
        }
      : null,
    maintenanceSchedules: schedules,
  };

  return <InvoicePrintable data={invoiceData} />;
}
