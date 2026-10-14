import { loadEnv, requireEnv } from "./scripts/lib/config.mjs";
import { makeAdminClient } from "./scripts/lib/supabase-client.mjs";
import { createClient } from "@supabase/supabase-js";

const env = requireEnv(loadEnv(), [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
]);
const admin = makeAdminClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const anon = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
  auth: { persistSession: false },
});

let bom = 0;
const cek = (nama, tertutup, detail = "") => {
  if (!tertutup) bom++;
  console.log(`${tertutup ? "TERTUTUP" : "BOCOR   "}  ${nama.padEnd(44)}${detail}`);
};

console.log("=== 1. kebocoran kas ke anonim ===");
{
  const { data, error } = await anon.rpc("expected_cash_for_date", {
    p_date: new Date().toISOString().slice(0, 10),
    p_opening_cash: 0,
    p_branch_id: null,
  });
  cek("anon tidak bisa baca total kas", !!error, error ? "ditolak" : `LOLOS ${JSON.stringify(data)}`);
}

console.log("\n=== 2. fungsi tracking lama ===");
for (const fn of ["public_order_tracking", "public_order_inspections"]) {
  const { error } = await anon.rpc(fn, { p_token: "x" });
  cek(`anon tidak bisa panggil ${fn}`, !!error, error ? "ditolak" : "LOLOS");
}

const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
  auth: { persistSession: false },
});
await sb.auth.signInWithPassword({ email: "posadmin@gmail.com", password: "Posadmin@RB-Autoluxe#2026" });
const { data: svc } = await admin
  .from("services")
  .select("id, name, price_l")
  .eq("name", "Wash Salju (Snow Wash)")
  .maybeSingle();
const hargaKatalog = Number(svc.price_l);

console.log(`\n=== 3. harga POS (katalog L = Rp ${hargaKatalog.toLocaleString("id-ID")}) ===`);
const palsu = await sb.rpc("create_pos_order_with_hold", {
  p_license_plate: "B 9001 UJI",
  p_vehicle_model: "Uji",
  p_vehicle_size: "L",
  p_customer_name: "Uji Harga Palsu",
  p_customer_phone: "080000000000",
  p_service_package: "Nama Palsu",
  p_items: [{ service_id: svc.id, name: svc.name, price: 1, qty: 1 }],
  p_payment_method: "cash",
  p_payment_state: "paid",
  p_start_work: false,
});
const order = Array.isArray(palsu.data) ? palsu.data[0] : palsu.data;
if (order?.id) {
  const { data: o } = await admin
    .from("orders")
    .select("total_price, service_package")
    .eq("id", order.id)
    .single();
  const benar = Number(o.total_price) === hargaKatalog;
  cek("harga Rp 1 dihitung ulang dari katalog", benar, `tersimpan Rp ${Number(o.total_price).toLocaleString("id-ID")}`);
  cek("paket layanan diambil dari katalog", o.service_package === svc.name, `tersimpan "${o.service_package}"`);
  await admin.from("order_items").delete().eq("order_id", order.id);
  await admin.from("cash_flow").delete().eq("order_id", order.id);
  await admin.from("orders").delete().eq("id", order.id);
} else {
  cek("harga Rp 1 dihitung ulang dari katalog", true, `ditolak: ${palsu.error?.message.slice(0, 60)}`);
}

console.log("\n=== 4. item tanpa service_id ===");
{
  const { error } = await sb.rpc("create_pos_order_with_hold", {
    p_license_plate: "B 9002 UJI",
    p_vehicle_model: "Uji",
    p_vehicle_size: "L",
    p_customer_name: "Uji",
    p_customer_phone: "080000000000",
    p_service_package: "Uji",
    p_items: [{ name: "Layanan Karangan", price: 1000, qty: 1 }],
    p_payment_method: "cash",
    p_payment_state: "paid",
    p_start_work: false,
  });
  cek("item tanpa service_id ditolak", !!error, error ? "ditolak" : "LOLOS");
}

console.log("\n=== 5. layanan tidak aktif / ukuran tidak tersedia ===");
{
  const { data: kecil } = await admin
    .from("services")
    .select("id, name, price_s")
    .eq("price_s", 0)
    .limit(1)
    .maybeSingle();
  if (kecil) {
    const { error } = await sb.rpc("create_pos_order_with_hold", {
      p_license_plate: "B 9003 UJI",
      p_vehicle_model: "Uji",
      p_vehicle_size: "S",
      p_customer_name: "Uji",
      p_customer_phone: "080000000000",
      p_service_package: "Uji",
      p_items: [{ service_id: kecil.id, name: kecil.name, price: 50000, qty: 1 }],
      p_payment_method: "cash",
      p_payment_state: "paid",
      p_start_work: false,
    });
    cek("ukuran tanpa harga ditolak", !!error, error ? "ditolak" : "LOLOS");
  } else {
    console.log("INFO     tidak ada layanan dengan harga 0, cek dilewati");
  }
}

console.log("\n=== 6. radius geofence di luar 5-5000 ===");
{
  const { data: cab } = await admin.from("branches").select("id, geofence_radius_meters").limit(1);
  const r = await admin.rpc("set_branch_location", {
    p_branch_id: cab[0].id,
    p_latitude: -6.2,
    p_longitude: 106.8,
    p_radius_meters: 999999,
  });
  cek("radius 999999 meter ditolak", !!r.error, r.error ? "ditolak" : "LOLOS");
}

console.log("\n=== 7. pengajuan izin dibuat langsung sebagai approved ===");
{
  const { data: profil } = await admin
    .from("profiles")
    .select("id")
    .eq("role", "karyawan")
    .limit(1)
    .maybeSingle();
  const { error } = await sb.from("time_off_requests").insert({
    profile_id: profil.id,
    type: "cuti",
    start_date: "2026-11-01",
    end_date: "2026-11-02",
    reason: "uji bypass",
    status: "approved",
    approver_id: profil.id,
  });
  if (!error) {
    const { data: baris } = await admin
      .from("time_off_requests")
      .select("status, approver_id")
      .eq("reason", "uji bypass")
      .order("created_at", { ascending: false })
      .limit(1);
    const aman = baris[0].status === "pending" && baris[0].approver_id === null;
    cek("insert izin tidak bisa langsung approved", aman, `tersimpan status=${baris[0].status} approver=${baris[0].approver_id}`);
    await admin.from("time_off_requests").delete().eq("reason", "uji bypass");
  } else {
    cek("insert izin tidak bisa langsung approved", true, "ditolak RLS");
  }
}

console.log(`\n===== ${bom === 0 ? "SEMUA TERTUTUP" : bom + " MASIH BOCOR"} =====`);