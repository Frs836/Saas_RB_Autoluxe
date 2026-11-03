import { createClient } from "@/lib/supabase/server";
import { BottomNav } from "@/components/dashboard/bottom-nav";
import { SubPageHeader } from "@/components/pos/sub-page-header";
import { StatistikSayaView } from "@/components/komisi/statistik-saya-view";
import { requirePermission } from "@/lib/rbac-guard";
import { formatRupiah } from "@/lib/format";
import { Icon } from "@/components/ui/icon";

export const metadata = { title: "Statistik Saya - RB AUTOLUXE" };

export default async function StatistikSayaPage() {
  const session = await requirePermission("reports.self");
  const supabase = await createClient();

  // Bulan berjalan
  const now = new Date();
  const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const fromDate = firstOfMonth.toISOString().slice(0, 10);
  const toDate   = now.toISOString().slice(0, 10);

  // Ambil profil_id karyawan ini
  const profileId = session.id;

  // Ambil semua order yang dikerjakan oleh user ini (via order_team_members)
  const { data: teamRows } = await supabase
    .from("order_team_members")
    .select("order_id, is_lead, orders!inner(id, total_price, status, service_package, completed_at, created_at, license_plate, vehicle_model)")
    .eq("profile_id", profileId)
    .gte("orders.created_at", `${fromDate}T00:00:00.000Z`)
    .lte("orders.created_at", `${toDate}T23:59:59.999Z`);

  type OrderRow = {
    id: string;
    totalPrice: number;
    status: string;
    servicePackage: string;
    completedAt: string | null;
    createdAt: string;
    licensePlate: string | null;
    vehicleModel: string | null;
    isLead: boolean;
  };

  const orders: OrderRow[] = (teamRows ?? []).map((r) => {
    const o = (r as any).orders;
    return {
      id:             o.id as string,
      totalPrice:     Number(o.total_price ?? 0),
      status:         o.status as string,
      servicePackage: o.service_package as string,
      completedAt:    o.completed_at as string | null,
      createdAt:      o.created_at as string,
      licensePlate:   o.license_plate as string | null,
      vehicleModel:   o.vehicle_model as string | null,
      isLead:         r.is_lead as boolean,
    };
  });

  const completedOrders = orders.filter((o) =>
    ["completed","menunggu_diambil","diserahkan","menunggu_pembayaran"].includes(o.status)
  );

  const totalRevenue = completedOrders.reduce((s, o) => s + o.totalPrice, 0);
  const leadCount    = completedOrders.filter((o) => o.isLead).length;
  const memberCount  = completedOrders.filter((o) => !o.isLead).length;

  // Breakdown layanan
  const byService = new Map<string, number>();
  for (const o of completedOrders) {
    const key = o.servicePackage || "Lainnya";
    byService.set(key, (byService.get(key) ?? 0) + 1);
  }
  const topServices = Array.from(byService.entries()).sort((a,b) => b[1]-a[1]).slice(0,5);

  return (
    <div className="flex flex-col w-full min-h-screen pb-nav-plain">
      <SubPageHeader title="Statistik Saya" branchName={session.fullName} backHref="/profil" />

      <div className="px-gutter py-4 flex flex-col gap-4">
        {/* Hero card */}
        <div className="relative overflow-hidden rounded-[20px] p-5 primary-gradient text-on-primary clay-glow">
          <div className="absolute -right-4 -bottom-4 opacity-10 pointer-events-none text-white">
            <Icon name="bar_chart" className="text-[120px]" />
          </div>
          <div className="relative z-10">
            <p className="font-caption text-caption text-brand-100">Bulan Ini</p>
            <p className="font-metric-display text-metric-display text-white tracking-tight leading-none mt-1">
              {completedOrders.length}
            </p>
            <p className="font-caption text-caption text-brand-100 mt-1">
              unit selesai dikerjakan
            </p>
            <p className="font-headline-2 text-headline-2 text-white mt-2">
              {formatRupiah(totalRevenue)}
            </p>
          </div>
        </div>

        {/* Lead vs Anggota */}
        <div className="grid grid-cols-2 gap-3">
          <div className="clay-card p-4 flex flex-col gap-1">
            <div className="w-9 h-9 rounded-xl bg-brand-50 flex items-center justify-center">
              <Icon name="star" className="text-brand-600 text-[20px]" />
            </div>
            <p className="font-caption text-caption text-text-muted mt-2">Sebagai Lead</p>
            <p className="font-headline-1 text-headline-1 text-text-primary">{leadCount}</p>
            <p className="font-micro-badge text-micro-badge text-text-muted">unit</p>
          </div>
          <div className="clay-card p-4 flex flex-col gap-1">
            <div className="w-9 h-9 rounded-xl bg-surface-container flex items-center justify-center">
              <Icon name="groups" className="text-text-secondary text-[20px]" />
            </div>
            <p className="font-caption text-caption text-text-muted mt-2">Anggota Tim</p>
            <p className="font-headline-1 text-headline-1 text-text-primary">{memberCount}</p>
            <p className="font-micro-badge text-micro-badge text-text-muted">unit</p>
          </div>
        </div>

        {/* Top layanan */}
        {topServices.length > 0 && (
          <div className="clay-card p-4 flex flex-col gap-3">
            <h3 className="font-headline-2 text-headline-2 text-text-primary">Layanan Dikerjakan</h3>
            <div className="flex flex-col gap-2">
              {topServices.map(([name, count]) => (
                <div key={name} className="flex items-center justify-between py-1.5 border-b border-outline-variant last:border-0">
                  <p className="font-caption text-caption text-text-secondary truncate flex-1 mr-3">{name}</p>
                  <span className="font-body-bold text-body-bold text-text-primary shrink-0">{count}x</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Daftar order */}
        <StatistikSayaView orders={orders} from={fromDate} to={toDate} profileId={profileId} />
      </div>

      <BottomNav role={session.role} />
    </div>
  );
}
