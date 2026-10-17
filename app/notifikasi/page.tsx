import { BottomNav } from "@/components/dashboard/bottom-nav";
import { SubPageHeader } from "@/components/pos/sub-page-header";
import { getSessionProfile } from "@/lib/rbac-guard";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { NotificationList } from "@/components/dashboard/notification-list";

export const instant = false;

export const metadata = { title: "Notifikasi" };

export default async function NotificationPage() {
  // Notifikasi milik pengguna sendiri, jadi penjaga yang dipakai cukup sesi
  // yang masuk. RLS di baris notifikasi sudah membatasi baris milik orang.
  const session = await getSessionProfile();
  if (!session) redirect("/login");

  const supabase = await createClient();

  // Notifikasi diambil di server supaya halaman sudah terisi saat dibuka.
  // Difilter eksplisit ke penerima supaya tidak bergantung pada RLS saja:
  // policy lama sempat memberi owner, admin kasir, dan maintainer akses ke
  // notifikasi seluruh pengguna.
  const { data, error } = await supabase
    .from("notifications")
    .select("id, title, body, category, is_read, payload, created_at")
    .eq("recipient_id", session.id)
    .order("created_at", { ascending: false })
    .limit(60);

  return (
    <div className="flex flex-col w-full min-h-screen">
      {/* Tanpa header ini halaman notifikasi tidak punya jalan kembali, karena
          lonceng hanya ada di dashboard. */}
      <SubPageHeader
        title="Notifikasi"
        branchName="Semua Peringatan"
        backHref="/dashboard"
      />
      <main className="flex-1">
        <NotificationList
          awal={error ? [] : (data ?? [])}
          bisaTandaiSemua={!error}
          role={session.role}
        />
      </main>
      <BottomNav role={session.role} />
    </div>
  );
}