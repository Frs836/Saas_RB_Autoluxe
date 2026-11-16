import { createClient } from "@supabase/supabase-js";
import { loadEnv } from "./lib/config.mjs";

const env = loadEnv();
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

async function main() {
  console.log("=== MEMULAI PEMBERSIHAN DATABASE ===");

  // 1. Verifikasi akun maintainer
  const { data: maintainerProfiles, error: maintErr } = await supabase
    .from("profiles")
    .select("id, auth_id, full_name, role")
    .eq("role", "maintainer");

  if (maintErr || !maintainerProfiles || maintainerProfiles.length === 0) {
    throw new Error(`Maintainer tidak ditemukan! Abort. Error: ${maintErr?.message}`);
  }

  const maintainer = maintainerProfiles[0];
  console.log(`Maintainer aman: ${maintainer.full_name} (${maintainer.id})`);

  // 2. Reset self-referencing di profiles
  console.log("1. Reset foreign key profiles...");
  await supabase.from("profiles").update({ face_reviewed_by: null }).neq("id", "00000000-0000-0000-0000-000000000000");

  // 3. Hapus data order & transaksi
  console.log("2. Menghapus order, garansi, pembayaran, dan antrean...");
  await supabase.from("warranty_claims").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  await supabase.from("warranties").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  await supabase.from("invoices").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  await supabase.from("order_inspections").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  await supabase.from("order_payments").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  await supabase.from("order_team_members").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  await supabase.from("order_items").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  await supabase.from("cash_flow").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  await supabase.from("orders").delete().neq("id", "00000000-0000-0000-0000-000000000000");

  // 4. Hapus shift kasir
  console.log("3. Menghapus sesi kasir & shift handoff...");
  await supabase.from("shift_handoffs").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  await supabase.from("shifts").delete().neq("id", "00000000-0000-0000-0000-000000000000");

  // 5. Hapus absensi, cuti, tabungan libur
  console.log("4. Menghapus absensi, cuti, & tabungan libur...");
  await supabase.from("attendance_logs").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  await supabase.from("time_off_requests").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  await supabase.from("off_in_lieu_logs").delete().neq("id", "00000000-0000-0000-0000-000000000000");

  // 6. Hapus notifikasi & activity logs
  console.log("5. Menghapus notifikasi & log aktivitas...");
  await supabase.from("notifications").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  await supabase.from("push_subscriptions").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  await supabase.from("activity_logs").delete().neq("id", "00000000-0000-0000-0000-000000000000");

  // 7. Hapus non-maintainer profiles
  console.log("6. Menghapus profil karyawan non-maintainer...");
  const { data: nonMaintProfiles } = await supabase
    .from("profiles")
    .select("id, auth_id, full_name, role")
    .neq("id", maintainer.id);

  if (nonMaintProfiles && nonMaintProfiles.length > 0) {
    for (const p of nonMaintProfiles) {
      console.log(` - Menghapus profil: ${p.full_name} (${p.role})`);
      await supabase.from("profiles").delete().eq("id", p.id);
    }
  }

  // 8. Hapus auth users selain maintainer
  console.log("7. Menghapus user di auth.users selain maintainer...");
  const { data: usersData } = await supabase.auth.admin.listUsers({ perPage: 1000 });
  for (const u of usersData?.users || []) {
    if (u.id !== maintainer.auth_id) {
      console.log(` - Menghapus auth user: ${u.email} (${u.id})`);
      await supabase.auth.admin.deleteUser(u.id);
    }
  }

  // 9. Bersihkan storage buckets
  console.log("8. Menghapus semua file & foto di storage buckets...");
  const buckets = ["attendance-photos", "cash-proofs", "inspection-photos", "timeoff-proofs", "profile-avatars"];
  for (const bucket of buckets) {
    const { data: fileList } = await supabase.storage.from(bucket).list("", { limit: 1000 });
    if (fileList && fileList.length > 0) {
      const paths = fileList.map((f) => f.name);
      console.log(` - Menghapus ${paths.length} file di bucket ${bucket}`);
      await supabase.storage.from(bucket).remove(paths);
    }
  }

  // 10. Verifikasi sisa data
  console.log("\n=== VERIFIKASI AKHIR ===");
  const { count: ordersCount } = await supabase.from("orders").select("*", { count: "exact", head: true });
  const { count: cashCount } = await supabase.from("cash_flow").select("*", { count: "exact", head: true });
  const { count: profCount } = await supabase.from("profiles").select("*", { count: "exact", head: true });
  const { count: stockCount } = await supabase.from("inventory_items").select("*", { count: "exact", head: true });
  const { count: servicesCount } = await supabase.from("services").select("*", { count: "exact", head: true });

  console.log(`Orders tersisa: ${ordersCount}`);
  console.log(`Cash Flow tersisa: ${cashCount}`);
  console.log(`Profil tersisa: ${profCount} (Hanya Maintainer)`);
  console.log(`Stok Inventaris utuh: ${stockCount} items`);
  console.log(`Katalog Layanan utuh: ${servicesCount} items`);
  console.log("Pembersihan database selesai dengan sukses!");
}

main().catch((err) => {
  console.error("Gagal melakukan pembersihan:", err);
  process.exit(1);
});
