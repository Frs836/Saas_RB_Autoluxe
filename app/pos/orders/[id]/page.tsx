import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { BottomNav } from "@/components/dashboard/bottom-nav";
import {
  OrderDetailView,
  type InspectionPhoto,
} from "@/components/orders/order-detail-view";
import { can } from "@/lib/rbac";
import { requireSession } from "@/lib/rbac-guard";

export const instant = false;

type Params = Promise<{ id: string }>;

export async function generateMetadata() {
  return { title: "Detail Order - RB Autoluxe" };
}

export default async function OrderDetailPage({ params }: { params: Params }) {
  const session = await requireSession();
  const { id } = await params;

  const supabase = await createClient();

  // RLS sudah membatasi karyawan pada order miliknya, jadi kueri di bawah
  // otomatis mengembalikan nol baris untuk order di luar wewenang.
  const { data: order, error } = await supabase
    .from("orders")
    .select(
      "id, order_number, license_plate, vehicle_model, vehicle_size, customer_name, customer_phone, service_package, status, total_price, payment_method, payment_state, tracking_token, created_at, completed_at, cancellation_reason, created_by, branch_id",
    )
    .eq("id", id)
    .maybeSingle();

  if (error) {
    throw new Error(`Gagal memuat order: ${error.message}`);
  }

  if (!order) {
    notFound();
  }

  //.scopedBranchId null berarti "Seluruh Cabang" sehingga semua order boleh
  // dibuka. Kalau cabang tertentu dipilih, order di luar itu tidak boleh
  // dimasuki lewat URL langsung.
  const scopedBranchId = session.branchScope === "all" ? null : session.branchId;

  if (scopedBranchId && order.branch_id !== scopedBranchId) {
    redirect("/pos/orders");
  }

  const [itemsRes, teamRes, photoRes, warrantyRes, branchRes, creatorRes] =
    await Promise.all([
      supabase
        .from("order_items")
        .select("item_name, price, quantity")
        .eq("order_id", id)
        .order("created_at", { ascending: true }),
      supabase
        .from("order_team_members")
        .select("profile_id, is_lead")
        .eq("order_id", id),
      supabase
        .from("order_inspections")
        .select("id, phase, photo_url, notes, inspector_id, created_at")
        .eq("order_id", id)
        .order("created_at", { ascending: true }),
      supabase
        .from("warranties")
        .select("warranty_code, start_date, end_date, status")
        .eq("order_id", id)
        .maybeSingle(),
      order.branch_id
        ? supabase
            .from("branches")
            .select("branch_name")
            .eq("id", order.branch_id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      order.created_by
        ? supabase
            .from("profiles")
            .select("full_name")
            .eq("id", order.created_by)
            .maybeSingle()
        : Promise.resolve({ data: null }),
    ]);

  const teamRows = teamRes.data ?? [];
  const profileIds = teamRows
    .map((row) => row.profile_id as string)
    .filter(Boolean);

  let nameById: Record<string, string> = {};
  if (profileIds.length > 0) {
    const { data: teamProfiles } = await supabase
      .from("profiles")
      .select("id, full_name")
      .in("id", profileIds);
    nameById = Object.fromEntries(
      (teamProfiles ?? []).map((p) => [p.id, (p.full_name as string) ?? "Teknisi"]),
    );
  }

  const inspectorIds = Array.from(
    new Set(
      (photoRes.data ?? [])
        .map((row) => row.inspector_id as string | null)
        .filter((v): v is string => Boolean(v)),
    ),
  );

  let inspectorNameById: Record<string, string> = {};
  if (inspectorIds.length > 0) {
    const { data: inspectors } = await supabase
      .from("profiles")
      .select("id, full_name")
      .in("id", inspectorIds);
    inspectorNameById = Object.fromEntries(
      (inspectors ?? []).map((p) => [p.id, (p.full_name as string) ?? "Staf"]),
    );
  }

  const inspections: InspectionPhoto[] = (photoRes.data ?? []).map((row) => ({
    id: row.id as string,
    phase: row.phase as InspectionPhoto["phase"],
    photoPath: row.photo_url as string,
    notes: (row.notes as string) ?? null,
    inspectorId: (row.inspector_id as string) ?? null,
    inspectorName: inspectorNameById[row.inspector_id as string] ?? "Staf",
    createdAt: row.created_at as string,
  }));

  const headerList = await headers();
  const host = headerList.get("x-forwarded-host") ?? headerList.get("host");
  const protocol =
    headerList.get("x-forwarded-proto") ??
    (process.env.NODE_ENV === "production" ? "https" : "http");
  const origin = host ? `${protocol}://${host}` : "";

  return (
    <>
      <OrderDetailView
        order={{
          id: order.id as string,
          orderNumber: order.order_number as string,
          licensePlate: order.license_plate as string,
          vehicleModel: order.vehicle_model as string,
          vehicleSize: order.vehicle_size as string,
          customerName: order.customer_name as string,
          customerPhone: (order.customer_phone as string) ?? null,
          servicePackage: (order.service_package as string) ?? "-",
          status: order.status as string,
          totalPrice: Number(order.total_price),
          paymentMethod: (order.payment_method as string) ?? null,
          paymentState: (order.payment_state as string) ?? null,
          trackingToken: order.tracking_token as string,
          createdAt: order.created_at as string,
          completedAt: (order.completed_at as string) ?? null,
          cancellationReason: (order.cancellation_reason as string) ?? null,
          createdByName: (creatorRes.data?.full_name as string) ?? "-",
          items: (itemsRes.data ?? []).map((item) => ({
            name: item.item_name as string,
            price: Number(item.price),
            quantity: Number(item.quantity),
          })),
          team: teamRows.map((row) => ({
            id: row.profile_id as string,
            full_name: nameById[row.profile_id as string] ?? "Teknisi",
            is_lead: Boolean(row.is_lead),
          })),
        }}
        inspections={inspections}
        warranty={
          warrantyRes.data
            ? {
                warrantyCode: warrantyRes.data.warranty_code as string,
                startDate: warrantyRes.data.start_date as string,
                endDate: warrantyRes.data.end_date as string,
                status: warrantyRes.data.status as string,
              }
            : null
        }
        origin={origin}
        canUpload={can(session.role, "inspection.upload")}
        canDecideQc={can(session.role, "qc.review")}
        canDeleteAny={can(session.role, "inspection.delete_any")}
        viewerId={session.id}
        branchName={branchRes.data?.branch_name ?? "Cabang Utama"}
      />
      <BottomNav role={session.role} />
    </>
  );
}