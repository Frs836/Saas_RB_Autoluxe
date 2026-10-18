import { createClient } from "@/lib/supabase/server";
import { BottomNav } from "@/components/dashboard/bottom-nav";
import { SubPageHeader } from "@/components/pos/sub-page-header";
import { ServiceManager, type ServiceRow } from "@/components/pos/service-manager";
import { requirePermission } from "@/lib/rbac-guard";

export const instant = false;

/**
 * Halaman pengelolaan jasa POS.
 *
 * Katalog dibaca kasir setiap kali membuat order, jadi harga dan status aktif
 * harus bisa diubah dari perangkat mana pun. Halaman ini menyediakan seluruh
 * tulisan lewat RPC yang memvalidasi harga, dan daftar disiarkan realtime
 * supaya dua kasir yang membuka halaman ini tidak saling menimpa.
 */
export default async function ServiceSettingsPage() {
  const session = await requirePermission("services.manage");

  const supabase = await createClient();
  const { data } = await supabase
    .from("services")
    .select(
      "id, name, category, price_s, price_m, price_l, price_xl, price_motor, price_motor_s, price_motor_m, price_motor_l, price_motor_xl, is_addon, is_active, updated_at",
    )
    .order("category", { ascending: true })
    .order("name", { ascending: true });

  const services: ServiceRow[] = (data ?? []).map((row) => ({
    id: row.id as string,
    name: (row.name as string) ?? "",
    category: (row.category as string) ?? "wash",
    priceS: Number(row.price_s ?? 0),
    priceM: Number(row.price_m ?? 0),
    priceL: Number(row.price_l ?? 0),
    priceXL: Number(row.price_xl ?? 0),
    priceMotor: Number(row.price_motor ?? 0),
    priceMotorS: Number(row.price_motor_s ?? 0),
    priceMotorM: Number(row.price_motor_m ?? 0),
    priceMotorL: Number(row.price_motor_l ?? 0),
    priceMotorXL: Number(row.price_motor_xl ?? 0),
    isAddon: Boolean(row.is_addon),
    isActive: Boolean(row.is_active),
  }));

  if (services.length === 0) {
    return (
      <div className="flex flex-col w-full min-h-screen">
        <SubPageHeader title="Kelola Jasa POS" backHref="/dashboard" />
        <main className="flex-1 px-gutter py-4">
          <p className="font-body text-body text-text-secondary">
            Belum ada jasa di katalog.
          </p>
        </main>
        <BottomNav role={session.role} />
      </div>
    );
  }

  return (
    <div className="flex flex-col w-full min-h-screen">
      <SubPageHeader title="Kelola Jasa POS" backHref="/dashboard" />
      <ServiceManager initialServices={services} />
      <BottomNav role={session.role} />
    </div>
  );
}