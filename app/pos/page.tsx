import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { BottomNav } from "@/components/dashboard/bottom-nav";
import { PosConsole } from "@/components/pos/pos-console";
import type { PosService } from "@/lib/pos";

export const instant = false;

const ROLE_LABELS: Record<string, string> = {
  owner: "Pemilik / Owner",
  admin_kasir: "Admin Kasir",
  maintainer: "Maintainer",
  karyawan: "Karyawan",
};

const PRIVILEGED = ["owner", "admin_kasir", "maintainer"];

export default async function PosPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, role, branch_id")
    .eq("auth_id", user.id)
    .maybeSingle();

  if (!profile) {
    return (
      <main className="flex-1 flex items-center justify-center px-gutter">
        <div className="max-w-[420px] bg-surface rounded-3xl p-6 clay-card text-center flex flex-col items-center gap-3">
          <span className="material-symbols-outlined text-[40px] text-warning-text">
            pending_actions
          </span>
          <h1 className="font-headline-1 text-headline-1 text-text-primary">
            Akun Menunggu Verifikasi
          </h1>
          <p className="font-caption text-caption text-text-secondary leading-relaxed">
            Profil operasional Anda belum terhubung ke cabang.
          </p>
        </div>
      </main>
    );
  }

  const branchId = profile.branch_id as string | null;

  const [servicesRes, teamRes, branchRes] = await Promise.all([
    supabase
      .from("services")
      .select(
        "id, name, category, price_s, price_m, price_l, price_xl, price_motor, is_addon",
      )
      .eq("is_active", true)
      .order("category", { ascending: true })
      .order("name", { ascending: true }),
    branchId
      ? supabase
          .from("profiles")
          .select("id, full_name")
          .eq("role", "karyawan")
          .eq("is_active", true)
          .eq("branch_id", branchId)
          .order("full_name", { ascending: true })
      : Promise.resolve({ data: [] }),
    branchId
      ? supabase
          .from("branches")
          .select("branch_name")
          .eq("id", branchId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const services = (servicesRes.data ?? []) as PosService[];
  const teamOptions = teamRes.data ?? [];
  const branchName = branchRes.data?.branch_name ?? "Cabang Utama";
  const canCreate = PRIVILEGED.includes(profile.role as string);

  return (
    <div className="flex flex-col w-full min-h-screen">
      <PosConsole
        services={services}
        teamOptions={teamOptions}
        branchName={branchName}
        canCreate={canCreate}
        roleLabel={ROLE_LABELS[profile.role] ?? profile.role}
      />
      <BottomNav />
    </div>
  );
}
