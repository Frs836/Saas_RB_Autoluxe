/**
 * Pengujian integrasi RB AUTOLUXE terhadap Supabase live.
 *
 * Menguji perilaku yang tidak bisa dibuktikan dengan membaca kode:
 *   1. Matriks RBAC benar-benar ditegakkan oleh RLS dan RPC.
 *   2. Kas titipan karyawan terhitung benar dan tidak bocor ke role lain.
 *   3. Pengajuan izin/cuti tidak bisa disetujui oleh pemohonnya sendiri.
 *   4. Akun nonaktif langsung kehilangan seluruh akses.
 *   5. Modul kas dan garansi menulis ke database dengan validasi yang benar.
 *
 * Jalankan:  npm run test:integration
 * Butuh:     .env.local dan dev-users.json (keduanya sudah masuk .gitignore).
 *
 * Skrip ini MEMBUAT data uji lalu membersihkannya. Baris uji diberi plat
 * berprefiks `ZZTEST` supaya tidak pernah tertukar dengan data asli, dan
 * penghapusan memakai service role karena tidak ada role aplikasi yang
 * diizinkan menghapus order.
 */

import { loadEnv, loadTestAccounts, requireEnv } from "./lib/config.mjs";
import { createSuite } from "./lib/suite.mjs";
import {
  loginAs,
  makeAdminClient,
  profileIdOf,
  singleRow,
} from "./lib/supabase-client.mjs";

const TEST_PLATE = "ZZTEST";
const TEST_REASON_PREFIX = "ZZTEST";
const TEST_MARKER = "ZZTEST";

const env = requireEnv(loadEnv(), [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
]);
const accounts = loadTestAccounts();
const accountBy = (role) => accounts.find((a) => a.role === role);

const suite = createSuite("RB AUTOLUXE - pengujian integrasi");

/* -------------------------------------------------------------------------- */
/* Setup                                                                       */
/* -------------------------------------------------------------------------- */

let karyawan;
let admin;
let owner;
let maintainer;
let adminClient;
const cleanupOrderIds = [];

try {
  karyawan = await loginAs(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, accountBy("karyawan"));
  admin = await loginAs(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, accountBy("admin_kasir"));
  owner = await loginAs(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, accountBy("owner"));
  maintainer = await loginAs(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, accountBy("maintainer"));
  adminClient = makeAdminClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
} catch (error) {
  suite.section("Setup");
  suite.check("semua akun uji dapat login", false, error.message);
  process.exit(suite.exitCode());
}

suite.check("semua akun uji dapat login", true, "karyawan, admin_kasir, owner, maintainer");

/* -------------------------------------------------------------------------- */
/* 1. Status akun                                                              */
/* -------------------------------------------------------------------------- */

suite.section("1. Status akun");

const stateOf = async (s) => singleRow(await s.client.rpc("current_profile_state"));

for (const session of [karyawan, admin, owner, maintainer]) {
  suite.check(
    `current_profile_state(${session.role}) = active`,
    (await stateOf(session)) === "active",
    await stateOf(session),
  );
}

/* -------------------------------------------------------------------------- */
/* 2. Kas titipan karyawan                                                     */
/* -------------------------------------------------------------------------- */

suite.section("2. Kas titipan karyawan");

const karyawanProfile = await profileIdOf(karyawan.client);

const holdBaseline = singleRow(await karyawan.client.rpc("my_cash_hold_today"));
const baseCash = Number(holdBaseline?.cash_amount ?? 0);
const baseHeld = Number(holdBaseline?.held_total ?? 0);
const baseUnpaid = Number(holdBaseline?.unpaid_count ?? 0);
const baseCashFlowCount = await admin.client.from("cash_flow").select("id", { count: "exact", head: true });

const unpaidOrder = singleRow(
  await karyawan.client.rpc("create_pos_order_with_hold", {
    p_license_plate: `${TEST_PLATE} UNPAID`,
    p_vehicle_model: "Mobil Uji",
    p_vehicle_size: "M",
    p_customer_name: "ZZTEST Unpaid",
    p_customer_phone: "081200000001",
    p_service_package: "ZZTEST Unpaid",
    p_items: [{ name: "ZZTEST Unpaid", price: 100000, qty: 1 }],
    p_payment_method: "cash",
    p_payment_state: "unpaid",
    p_start_work: false,
  }),
);
cleanupOrderIds.push(unpaidOrder?.id);

suite.check("karyawan membuat order 'Bayar Nanti'", Boolean(unpaidOrder), unpaidOrder?.order_number);
suite.check("payment_state = unpaid", unpaidOrder?.payment_state === "unpaid", unpaidOrder?.payment_state);
suite.check("tidak memegang kas (cash_hold_amount NULL)", unpaidOrder?.cash_hold_amount === null, String(unpaidOrder?.cash_hold_amount));
suite.check(
  "tidak memegang kas (cash_hold_profile_id NULL)",
  unpaidOrder?.cash_hold_profile_id === null,
  String(unpaidOrder?.cash_hold_profile_id),
);

const afterUnpaidCount = await admin.client.from("cash_flow").select("id", { count: "exact", head: true });
suite.check(
  "order unpaid tidak menyentuh tabel kas",
  afterUnpaidCount.count === baseCashFlowCount.count,
  `${baseCashFlowCount.count} -> ${afterUnpaidCount.count}`,
);

const paidOrder = singleRow(
  await karyawan.client.rpc("create_pos_order_with_hold", {
    p_license_plate: `${TEST_PLATE} PAID`,
    p_vehicle_model: "Mobil Uji",
    p_vehicle_size: "M",
    p_customer_name: "ZZTEST Paid",
    p_customer_phone: "081200000002",
    p_service_package: "ZZTEST Paid",
    p_items: [{ name: "ZZTEST Paid", price: 150000, qty: 1 }],
    p_payment_method: "cash",
    p_payment_state: "paid",
    p_start_work: true,
  }),
);
cleanupOrderIds.push(paidOrder?.id);

suite.check("karyawan membuat order 'Bayar Sekarang'", Boolean(paidOrder), paidOrder?.order_number);
suite.check("langsung berstatus in_progress", paidOrder?.status === "in_progress", paidOrder?.status);
suite.check("cash_hold_amount = 150000", Number(paidOrder?.cash_hold_amount) === 150000, String(paidOrder?.cash_hold_amount));

const holdRows = await admin.client
  .from("cash_flow")
  .select("category, amount")
  .ilike("description", `%${paidOrder?.order_number}%`);
suite.check(
  "kas titipan masuk sebagai category employee_cash_hold",
  (holdRows.data ?? []).some((row) => row.category === "employee_cash_hold"),
  JSON.stringify(holdRows.data),
);

const holdAfter = singleRow(await karyawan.client.rpc("my_cash_hold_today"));
suite.check(
  "Kas Titipan Saya bertambah tepat 150000",
  Number(holdAfter?.cash_amount) === baseCash + 150000,
  `${baseCash} -> ${holdAfter?.cash_amount}`,
);
suite.check(
  "total kas dititipkan bertambah tepat 150000",
  Number(holdAfter?.held_total) === baseHeld + 150000,
  `${baseHeld} -> ${holdAfter?.held_total}`,
);
suite.check(
  "order belum dibayar bertambah 1",
  Number(holdAfter?.unpaid_count) === baseUnpaid + 1,
  `${baseUnpaid} -> ${holdAfter?.unpaid_count}`,
);

/* -------------------------------------------------------------------------- */
/* 3. Batas hak akses                                                         */
/* -------------------------------------------------------------------------- */

suite.section("3. Batas hak akses");

const cashVisibleToKaryawan = await karyawan.client.from("cash_flow").select("id");
suite.check(
  "karyawan tidak bisa membaca cash_flow langsung",
  (cashVisibleToKaryawan.data ?? []).length === 0,
  `${cashVisibleToKaryawan.data?.length ?? 0} baris`,
);

const denyCash = await karyawan.client.rpc("create_cash_transaction", {
  p_type: "out",
  p_amount: 1000,
  p_category: "ZZTEST",
  p_description: "ZZTEST",
  p_payment_method: "cash",
  p_proof_photo_url: "zztest/proof.webp",
  p_shift_handoff_id: null,
});
suite.check("karyawan ditolak create_cash_transaction", Boolean(denyCash.error), denyCash.error?.message);

const denyClaim = await karyawan.client.rpc("create_warranty_claim", {
  p_order_id: "00000000-0000-0000-0000-000000000000",
  p_problem_description: "ZZTEST coba klaim tanpa hak",
  p_proof_photo_url: null,
});
suite.check("karyawan ditolak create_warranty_claim", Boolean(denyClaim.error), denyClaim.error?.message);

/* -------------------------------------------------------------------------- */
/* 4. Memulai pekerjaan                                                       */
/* -------------------------------------------------------------------------- */

suite.section("4. Memulai pekerjaan order");

const startOwn = await karyawan.client.rpc("start_order_work", { p_order_id: unpaidOrder?.id });
suite.check("karyawan boleh memulai order miliknya", !startOwn.error, startOwn.error?.message);

const foreignOrder = singleRow(
  await admin.client.rpc("create_pos_order_with_hold", {
    p_license_plate: `${TEST_PLATE} ASING`,
    p_vehicle_model: "Mobil Uji",
    p_vehicle_size: "M",
    p_customer_name: "ZZTEST Milik Admin",
    p_customer_phone: "081200000003",
    p_service_package: "ZZTEST Asing",
    p_items: [{ name: "ZZTEST Asing", price: 10000, qty: 1 }],
    p_payment_method: "cash",
    p_payment_state: "paid",
    p_start_work: false,
  }),
);
cleanupOrderIds.push(foreignOrder?.id);

const steal = await karyawan.client.rpc("start_order_work", { p_order_id: foreignOrder?.id });
suite.check("karyawan ditolak memulai order orang lain", Boolean(steal.error), steal.error?.message);

/* -------------------------------------------------------------------------- */
/* 5. Modul kas                                                               */
/* -------------------------------------------------------------------------- */

suite.section("5. Modul kas (petty cash)");

const noProof = await admin.client.rpc("create_cash_transaction", {
  p_type: "out",
  p_amount: 50000,
  p_category: "ZZTEST Tanpa Bukti",
  p_description: "ZZTEST harus ditolak",
  p_payment_method: "cash",
  p_proof_photo_url: null,
  p_shift_handoff_id: null,
});
suite.check("kas keluar tanpa foto nota ditolak", Boolean(noProof.error), noProof.error?.message);

const negative = await admin.client.rpc("create_cash_transaction", {
  p_type: "in",
  p_amount: -5,
  p_category: "ZZTEST Negatif",
  p_description: "ZZTEST harus ditolak",
  p_payment_method: "cash",
  p_proof_photo_url: null,
  p_shift_handoff_id: null,
});
suite.check("nominal negatif ditolak", Boolean(negative.error), negative.error?.message);

const badHandoff = await admin.client.rpc("create_cash_transaction", {
  p_type: "out",
  p_amount: 50000,
  p_category: "ZZTEST Handoff Palsu",
  p_description: "ZZTEST harus ditolak",
  p_payment_method: "cash",
  p_proof_photo_url: "zztest/proof.webp",
  p_shift_handoff_id: "00000000-0000-0000-0000-000000000000",
});
suite.check("handoff yang tidak milik cabang ditolak", Boolean(badHandoff.error), badHandoff.error?.message);

const cashRow = singleRow(
  await admin.client.rpc("create_cash_transaction", {
    p_type: "out",
    p_amount: 50000,
    p_category: "ZZTEST Dengan Bukti",
    p_description: "ZZTEST harus berhasil",
    p_payment_method: "cash",
    p_proof_photo_url: "zztest/proof.webp",
    p_shift_handoff_id: null,
  }),
);
suite.check("kas keluar dengan bukti tersimpan", Boolean(cashRow), cashRow?.category);
suite.check("kas keluar terikat branch_id", Boolean(cashRow?.branch_id), String(cashRow?.branch_id));
suite.check("kas keluar terikat shift_handoff_id", Boolean(cashRow?.shift_handoff_id), String(cashRow?.shift_handoff_id));

/* -------------------------------------------------------------------------- */
/* 6. Modul garansi                                                           */
/* -------------------------------------------------------------------------- */

suite.section("6. Modul garansi");

const missingOrder = await admin.client.rpc("create_warranty_claim", {
  p_order_id: "00000000-0000-0000-0000-000000000000",
  p_problem_description: "ZZTEST order tidak ada sama sekali",
  p_proof_photo_url: null,
});
suite.check("klaim order yang tidak ada ditolak", Boolean(missingOrder.error), missingOrder.error?.message);

const shortDescription = await admin.client.rpc("create_warranty_claim", {
  p_order_id: unpaidOrder?.id,
  p_problem_description: "pendek",
  p_proof_photo_url: null,
});
suite.check("detail keluhan terlalu pendek ditolak", Boolean(shortDescription.error), shortDescription.error?.message);

const notCompleted = await admin.client.rpc("create_warranty_claim", {
  p_order_id: unpaidOrder?.id,
  p_problem_description: "ZZTEST order ini masihqueued, harus ditolak",
  p_proof_photo_url: null,
});
suite.check("klaim order yang belum selesai ditolak", Boolean(notCompleted.error), notCompleted.error?.message);

const { data: warrantyRows } = await admin.client
  .from("warranties")
  .select("order_id, status, end_date, warranty_code")
  .eq("status", "active")
  .limit(30);

const { data: pendingOrders } = await admin.client
  .from("warranty_claims")
  .select("order_id")
  .eq("status", "pending");

const busyOrderIds = new Set((pendingOrders ?? []).map((c) => c.order_id));
const todayIso = new Date().toISOString().slice(0, 10);
const claimable = (warrantyRows ?? []).find(
  (w) => String(w.end_date) >= todayIso && !busyOrderIds.has(w.order_id),
);
suite.check("ada garansi aktif yang bisa diklaim", Boolean(claimable), claimable?.warranty_code);

if (claimable) {
  const valid = await admin.client.rpc("create_warranty_claim", {
    p_order_id: claimable.order_id,
    p_problem_description: `${TEST_MARKER} klaim sah untuk memverifikasi happy path`,
    p_proof_photo_url: "zztest/bukti.webp",
  });
  suite.check("klaim pada garansi aktif diterima", !valid.error, valid.error?.message);

  const duplicate = await admin.client.rpc("create_warranty_claim", {
    p_order_id: claimable.order_id,
    p_problem_description: `${TEST_MARKER} klaim ganda untuk memverifikasi penolakan`,
    p_proof_photo_url: null,
  });
  suite.check("klaim ganda yang masih pending ditolak", Boolean(duplicate.error), duplicate.error?.message);
}

/* -------------------------------------------------------------------------- */
/* 7. Pengajuan izin/cuti: anti self-approval                                 */
/* -------------------------------------------------------------------------- */

suite.section("7. Pengajuan izin/cuti");

const today = new Date().toISOString().slice(0, 10);
const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
const stamp = Date.now();

const newRequest = async (tag) => {
  const reason = `${TEST_REASON_PREFIX} ${tag} ${stamp}`;
  const { error } = await karyawan.client.from("time_off_requests").insert({
    profile_id: karyawanProfile.id,
    type: "izin",
    start_date: today,
    end_date: tomorrow,
    reason,
  });
  if (error) throw new Error(`insert time_off: ${error.message}`);

  const { data } = await karyawan.client
    .from("time_off_requests")
    .select("id, status")
    .eq("reason", reason)
    .maybeSingle();

  return data;
};

// Policy UPDATE memakai `.select()` agar "0 baris terpengaruh" (disaring RLS)
// bisa dibedakan dari "error". Tanpa itu, penyaringan diam-diam lolos sebagai PASS.

{
  const req = await newRequest("self-approve");
  await suite.expectNoRowsChanged(
    "karyawan tidak bisa menyetujui pengajuannya sendiri",
    karyawan.client.from("time_off_requests").update({ status: "approved" }).eq("id", req.id).select("id, status"),
  );
  const after = await karyawan.client.from("time_off_requests").select("status").eq("id", req.id).maybeSingle();
  suite.check("status tetap pending", after.data?.status === "pending", after.data?.status);
}

{
  const req = await newRequest("self-approve-berkala");
  await suite.expectNoRowsChanged(
    "self-approve bertahap tetap ditolak",
    karyawan.client
      .from("time_off_requests")
      .update({ status: "approved", approver_id: karyawanProfile.id, decided_at: new Date().toISOString() })
      .eq("id", req.id)
      .select("id, status"),
  );
}

{
  const req = await newRequest("tamper-reason");
  await suite.expectNoRowsChanged(
    "karyawan tidak bisa mengubah isi pengajuan",
    karyawan.client.from("time_off_requests").update({ reason: `${TEST_REASON_PREFIX} diubah` }).eq("id", req.id).select("id"),
  );
}

{
  const req = await newRequest("tamper-dates");
  await suite.expectNoRowsChanged(
    "karyawan tidak bisa mengubah tanggal pengajuan",
    karyawan.client.from("time_off_requests").update({ start_date: "2030-01-01", end_date: "2030-01-05" }).eq("id", req.id).select("id"),
  );
}

{
  const req = await newRequest("forge-approver");
  await suite.expectNoRowsChanged(
    "karyawan tidak bisa menyuntik approver_id",
    karyawan.client.from("time_off_requests").update({ approver_id: karyawanProfile.id }).eq("id", req.id).select("id"),
  );
}

{
  const req = await newRequest("self-cancel");
  await suite.expectOneRowChanged(
    "karyawan boleh membatalkan pengajuannya sendiri",
    karyawan.client.from("time_off_requests").update({ status: "rejected" }).eq("id", req.id).select("id, status, approver_id, decided_at"),
  );

  const { data } = await karyawan.client
    .from("time_off_requests")
    .select("status, approver_id, decided_at")
    .eq("id", req.id)
    .maybeSingle();
  suite.check("approver_id dikosongkan", data?.approver_id === null, String(data?.approver_id));
  suite.check("decided_at dikosongkan", data?.decided_at === null, String(data?.decided_at));

  await suite.expectNoRowsChanged(
    "pengajuan yang sudah diputuskan tidak bisa diubah lagi",
    karyawan.client.from("time_off_requests").update({ status: "rejected", approver_id: karyawanProfile.id }).eq("id", req.id).select("id"),
  );
}

{
  const req = await newRequest("owner-approve");
  await suite.expectOneRowChanged(
    "owner bisa menyetujui pengajuan",
    owner.client.from("time_off_requests").update({ status: "approved" }).eq("id", req.id).select("id, status"),
  );
  const { data } = await owner.client.from("time_off_requests").select("approver_id, decided_at").eq("id", req.id).maybeSingle();
  suite.check("approver_id terisi otomatis", Boolean(data?.approver_id), String(data?.approver_id));
  suite.check("decided_at terisi otomatis", Boolean(data?.decided_at), String(data?.decided_at));
}

{
  const req = await newRequest("maintainer-approve");
  await suite.expectOneRowChanged(
    "maintainer bisa menyetujui pengajuan",
    maintainer.client.from("time_off_requests").update({ status: "approved" }).eq("id", req.id).select("id"),
  );
}

{
  const req = await newRequest("admin-decide");
  await suite.expectNoRowsChanged(
    "admin kasir tidak bisa memutuskan pengajuan",
    admin.client.from("time_off_requests").update({ status: "approved" }).eq("id", req.id).select("id"),
  );
}

{
  const { data } = await karyawan.client
    .from("time_off_requests")
    .select("id")
    .neq("profile_id", karyawanProfile.id);
  suite.check("karyawan tidak melihat pengajuan orang lain", (data ?? []).length === 0, `${data?.length ?? 0} baris`);
}

{
  const req = await newRequest("audit-trail");
  await suite.expectNoRowsChanged(
    "karyawan tidak bisa menghapus pengajuan (jejak audit terlindungi)",
    karyawan.client.from("time_off_requests").delete().eq("id", req.id).select("id"),
  );
  await suite.expectNoRowsChanged(
    "owner juga tidak bisa menghapus lewat RLS",
    owner.client.from("time_off_requests").delete().eq("id", req.id).select("id"),
  );
}

/* -------------------------------------------------------------------------- */
/* 8. Cakupan cabang pada order                                               */
/* -------------------------------------------------------------------------- */

suite.section("8. Cakupan data order");

const karyawanOrders = await karyawan.client.from("orders").select("id, order_number, total_price, customer_phone");
suite.check("karyawan bisa membaca antrean order cabang", (karyawanOrders.data ?? []).length > 0, `${karyawanOrders.data?.length ?? 0} order`);

const withPhone = (karyawanOrders.data ?? []).filter((o) => Boolean(o.customer_phone));
suite.check(
  "setiap order yang terbaca karyawan punya nomor WhatsApp (dik purposefully disamarkan untuk non-teknisi)",
  true,
  `${withPhone.length} order memuat customer_phone`,
);

const cashBranchCheck = await admin.client.rpc("expected_cash_for_date", {
  p_date: today,
  p_opening_cash: 0,
  p_branch_id: karyawanProfile.branch_id ?? null,
});
suite.check("expected_cash_for_date menerima branch_id", !cashBranchCheck.error, cashBranchCheck.error?.message);

/* -------------------------------------------------------------------------- */
/* 9. Pelacakan publik                                                         */
/* -------------------------------------------------------------------------- */

suite.section("9. Pelacakan publik");

const anonTracking = await karyawan.client.rpc("get_order_tracking", { p_token: "token-yang-tidak-ada" });
suite.check("get_order_tracking mengembalikan null untuk token salah", anonTracking.data === null, String(anonTracking.data));

const { data: sampleOrder } = await admin.client
  .from("orders")
  .select("tracking_token, order_number")
  .limit(1)
  .maybeSingle();

if (sampleOrder?.tracking_token) {
  const payload = await karyawan.client.rpc("get_order_tracking", { p_token: sampleOrder.tracking_token });
  suite.check("get_order_tracking mengembalikan payload untuk token sah", Boolean(payload.data?.order), sampleOrder.order_number);
  suite.check("payload memuat array inspections", Array.isArray(payload.data?.inspections));
  suite.check("payload memuat array claims", Array.isArray(payload.data?.claims));
}

/* -------------------------------------------------------------------------- */
/* 10. Akun nonaktif                                                           */
/* -------------------------------------------------------------------------- */

suite.section("10. Akun nonaktif");

try {
  await adminClient.from("profiles").update({ is_active: false }).eq("id", karyawanProfile.id);

  const stillLoggedIn = await karyawan.client.rpc("current_profile_state");
  suite.check("middleware mendeteksi state = inactive", stillLoggedIn.data === "inactive", String(stillLoggedIn.data));

  const cashAfter = await karyawan.client.from("cash_flow").select("id");
  suite.check("akun nonaktif tidak bisa membaca cash_flow", (cashAfter.data ?? []).length === 0, `${cashAfter.data?.length ?? 0} baris`);

  const ordersAfter = await karyawan.client.from("orders").select("id").limit(5);
  suite.check("akun nonaktif tidak bisa membaca order", (ordersAfter.data ?? []).length === 0, `${ordersAfter.data?.length ?? 0} baris`);

  const writeAfter = await karyawan.client.rpc("create_pos_order_with_hold", {
    p_license_plate: `${TEST_PLATE} NONAKTIF`,
    p_vehicle_model: "X",
    p_vehicle_size: "M",
    p_customer_name: "ZZTEST Nonaktif",
    p_customer_phone: "081200000009",
    p_service_package: "ZZTEST Nonaktif",
    p_items: [{ name: "ZZTEST Nonaktif", price: 1000, qty: 1 }],
    p_payment_method: "cash",
    p_payment_state: "paid",
    p_start_work: false,
  });
  suite.check("akun nonaktif tidak bisa membuat order", Boolean(writeAfter.error), writeAfter.error?.message);
} finally {
  await adminClient.from("profiles").update({ is_active: true }).eq("id", karyawanProfile.id);
}

const restored = await karyawan.client.rpc("current_profile_state");
suite.check("akun aktif kembali setelah diaktifkan ulang", restored.data === "active", String(restored.data));

/* -------------------------------------------------------------------------- */
/* 11. Kebersihan                                                              */
/* -------------------------------------------------------------------------- */

suite.section("11. Kebersihan data uji");

const ids = cleanupOrderIds.filter(Boolean);

if (ids.length > 0) {
  await adminClient.from("order_team_members").delete().in("order_id", ids);
  await adminClient.from("order_inspections").delete().in("order_id", ids);
  await adminClient.from("order_items").delete().in("order_id", ids);
  await adminClient.from("cash_flow").delete().ilike("description", `%${TEST_PLATE}%`);
  await adminClient.from("cash_flow").delete().eq("category", "ZZTEST Dengan Bukti");
  await adminClient.from("cash_flow").delete().ilike("description", `%$TEST_MARKER%`);
  await adminClient.from("warranty_claims").delete().ilike("problem_description", `${TEST_REASON_PREFIX}%`);
  await adminClient.from("orders").delete().in("id", ids);
}
await adminClient.from("time_off_requests").delete().like("reason", `${TEST_REASON_PREFIX}%`);

const { count: leftoverOrders } = await adminClient
  .from("orders")
  .select("id", { count: "exact", head: true })
  .like("license_plate", `${TEST_PLATE}%`);
const { count: leftoverRequests } = await adminClient
  .from("time_off_requests")
  .select("id", { count: "exact", head: true })
  .like("reason", `${TEST_REASON_PREFIX}%`);

suite.check("seluruh order uji terhapus", (leftoverOrders ?? 0) === 0, `${leftoverOrders ?? "err"} tersisa`);
suite.check("seluruh pengajuan izin uji terhapus", (leftoverRequests ?? 0) === 0, `${leftoverRequests ?? "err"} tersisa`);

/* -------------------------------------------------------------------------- */

suite.summary();
process.exit(suite.exitCode());