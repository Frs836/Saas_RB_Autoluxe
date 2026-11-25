import { createClient } from "@/lib/supabase/server";
import { SubPageHeader } from "@/components/pos/sub-page-header";
import { BottomNav } from "@/components/dashboard/bottom-nav";
import { requirePermission } from "@/lib/rbac-guard";
import { KomisiSettingView } from "@/components/komisi/komisi-setting-view";

export default async function PengaturanKomisiPage() {
  const session = await requirePermission("commission.manage");
  const supabase = await createClient();

  // Ambil semua setting komisi beserta data profil dan jasa
  const { data: settings } = await supabase
    .from("commission_settings")
    .select(
      "id, profile_id, service_id, commission_type, value, is_active, created_at, updated_at",
    )
    .order("created_at", { ascending: false });

  // Semua profil staf aktif (karyawan, kepala_karyawan, dll.)
  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, full_name, role, branch_id")
    .in("role", ["karyawan", "kepala_karyawan", "admin_kasir", "manager"])
    .eq("is_active", true)
    .order("full_name");

  // Semua jasa aktif untuk dropdown
  const { data: services } = await supabase
    .from("services")
    .select("id, name")
    .eq("is_active", true)
    .order("name");

  return (
    <div className="flex flex-col w-full min-h-screen">
      <SubPageHeader
        title="Pengaturan Komisi"
        branchName="RB AUTOLUXE"
        backHref="/profil"
      />
      <KomisiSettingView
        initialSettings={(settings ?? []).map((s) => ({
          id: s.id as string,
          profileId: s.profile_id as string,
          serviceId: (s.service_id as string | null) ?? null,
          commissionType: s.commission_type as "percent" | "flat",
          value: Number(s.value ?? 0),
          isActive: Boolean(s.is_active),
        }))}
        profiles={(profiles ?? []).map((p) => ({
          id: p.id as string,
          fullName: (p.full_name as string) ?? "—",
          role: (p.role as string) ?? "karyawan",
        }))}
        services={(services ?? []).map((s) => ({
          id: s.id as string,
          name: (s.name as string) ?? "—",
        }))}
      />
      <BottomNav role={session.role} />
    </div>
  );
}
