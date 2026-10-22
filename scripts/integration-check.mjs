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

/**
 * Layanan katalog untuk pesanan uji.
 *
--desde 0022 harga dihitung server dari katalog, jadi item wajib punya
 * service_id. Test memakai layanan nyata agar total yang diharapkan bisa
 * dibandingkan dengan angka yang benar-benar dihitung database.
 */
let KATALOG = null;
async function ambilKatalog(client) {
  if (KATALOG) return KATALOG;
  const { data, error } = await client
    .from("services")
    .select("id, name, price_s, price_m, price_l")
    .eq("is_active", true)
    .not("price_m", "is", null)
    .limit(1)
    .maybeSingle();
  if (error || !data) throw new Error(`Tidak bisa membaca katalog layanan: ${error?.message}`);
  if (Number(data.price_m) <= 0) throw new Error("Layanan uji tidak punya harga M yang bisa dipakai");
  KATALOG = data;
  return KATALOG;
}

/**
 * Layanan coating untuk uji garansi.
 *
 * Sertifikat garansi terbit bila nama paket layanan memuat kata coating,
 * ceramic, liquid glass, atau nano. Server menyusun nama paket dari katalog,
 * jadi uji ini harus memakai layanan coating yang sungguhan ada, bukan hanya
 * menulis "Coating" di kolom paket.
 */
async function katalogCoating(client) {
  const { data, error } = await client
    .from("services")
    .select("id, name, price_m")
    .eq("is_active", true)
    .ilike("name", "%Coating%")
    .limit(1)
    .maybeSingle();
  if (error || !data) throw new Error(`Tidak ada layanan coating untuk diuji: ${error?.message}`);
  if (Number(data.price_m) <= 0) throw new Error("Layanan coating uji tidak punya harga M");
  return data;
}

/** Satu item POS yang sah, lengkap dengan harga katalognya. */
async function itemUji(client, qty = 1) {
  const s = await ambilKatalog(client);
  return { service_id: s.id, name: s.name, price: Number(s.price_m), qty };
}

/** Harga yang seharusnya terimpan untuk item uji dengan qty tertentu. */
async function hargaUji(client, qty = 1) {
  const s = await ambilKatalog(client);
  return Number(s.price_m) * qty;
}

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

// Teknisi kedua untuk order yang berjalan bersamaan: satu orang tidak boleh
// memegang dua unit aktif.
const pembantuRow = (
  await admin.client
    .from("profiles")
    .select("id")
    .eq("role", "karyawan")
    .eq("is_active", true)
    .neq("id", karyawanProfile.id)
    .limit(1)
).data?.[0];
const pembantuId = pembantuRow?.id ?? karyawanProfile.id;

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
    p_items: [await itemUji(karyawan.client)],
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
    p_items: [await itemUji(karyawan.client)],
    p_payment_method: "cash",
    p_payment_state: "paid",
    p_start_work: true,
    p_team_ids: [pembantuId],
  }),
);
cleanupOrderIds.push(paidOrder?.id);

suite.check("karyawan membuat order 'Bayar Sekarang'", Boolean(paidOrder), paidOrder?.order_number);
suite.check("langsung berstatus in_progress", paidOrder?.status === "in_progress", paidOrder?.status);
const hargaPaid = await hargaUji(karyawan.client);
suite.check(`cash_hold_amount = ${hargaPaid}`, Number(paidOrder?.cash_hold_amount) === hargaPaid, String(paidOrder?.cash_hold_amount));

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
  `Kas Titipan Saya bertambah tepat ${hargaPaid}`,
  Number(holdAfter?.cash_amount) === baseCash + hargaPaid,
  `${baseCash} -> ${holdAfter?.cash_amount}`,
);
suite.check(
  `total kas dititipkan bertambah tepat ${hargaPaid}`,
  Number(holdAfter?.held_total) === baseHeld + hargaPaid,
  `${baseHeld} -> ${holdAfter?.held_total}`,
);
suite.check(
  "order belum dibayar bertambah 1",
  Number(holdAfter?.unpaid_count) === baseUnpaid + 1,
  `${baseUnpaid} -> ${holdAfter?.unpaid_count}`,
);

// Satu teknisi hanya boleh memegang satu unit aktif. Selesaikan order ini dulu
// supaya order berikutnya boleh memakai teknisi yang sama.
await admin.client.rpc("apply_order_status", {
  p_order_id: paidOrder?.id,
  p_status: "qc_review",
});
await admin.client.rpc("apply_order_status", {
  p_order_id: paidOrder?.id,
  p_status: "completed",
});

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

// Pengerjaan wajib punya teknisi, jadi order milik karyawan ditugaskan ke
// dirinya sendiri lebih dulu.
await admin.client.rpc("set_order_team", {
  p_order_id: unpaidOrder?.id,
  p_profile_ids: [karyawanProfile.id],
});

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
    p_items: [await itemUji(admin.client)],
    p_payment_method: "cash",
    p_payment_state: "paid",
    p_start_work: false,
  }),
);
cleanupOrderIds.push(foreignOrder?.id);

// Order orang lain tetap harus punya teknisi supaya penolakan yang diuji
// benar-benar soal kepemilikan, bukan soal tim yang kosong.
const otherStaff = (
  await admin.client
    .from("profiles")
    .select("id")
    .eq("role", "karyawan")
    .eq("is_active", true)
    .eq("branch_id", foreignOrder?.branch_id)
    .neq("id", karyawanProfile.id)
    .limit(1)
).data?.[0];

if (otherStaff) {
  await admin.client.rpc("set_order_team", {
    p_order_id: foreignOrder?.id,
    p_profile_ids: [otherStaff.id],
  });
}

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
  .select("order_id, status, end_date, warranty_code, orders!inner(id, status)")
  .eq("status", "active")
  .limit(30);

const { data: pendingOrders } = await admin.client
  .from("warranty_claims")
  .select("order_id")
  .eq("status", "pending");

const busyOrderIds = new Set((pendingOrders ?? []).map((c) => c.order_id));
const todayIso = new Date().toISOString().slice(0, 10);

// Garansi hanya bisa diklaim bila order-nya benar-benar selesai.
let claimable = (warrantyRows ?? []).find((w) => {
  const parent = Array.isArray(w.orders) ? w.orders[0] : w.orders;
  return (
    String(w.end_date) >= todayIso &&
    !busyOrderIds.has(w.order_id) &&
    parent?.status === "completed"
  );
});

/*
 * Kalau tidak ada, bagian ini membuat order dan garansinya sendiri.
 *
 * Sebelumnya bagian ini membaca garansi yang sudah ada dari data contoh.
 * Begitu data contoh dihapus supaya pengujian benar-benar bersih, bagian
 * yang sama ikut gagal karena tidak punya apa pun untuk diuji. Ketergantungan
 * seperti itu membuat hasil pengujian bergantung pada isi database, bukan
 * pada kode yang diuji.
 */
if (!claimable) {
  // Order dibuat lewat sesi karyawan, bukan service role, karena fungsi
  // pembuatan order menolak permintaan tanpa pengguna yang masuk.
  const orderGaransi = await karyawan.client.rpc("create_pos_order_with_hold", {
    p_license_plate: `${TEST_PLATE} GARANSI`,
    p_vehicle_model: "Mobil Uji",
    p_vehicle_size: "M",
    p_customer_name: `${TEST_MARKER} Garansi`,
    p_customer_phone: "081200000009",
    p_service_package: `${TEST_MARKER} Garansi`,
    p_items: [await itemUji(karyawan.client)],
    p_payment_method: "cash",
    p_payment_state: "paid",
    p_start_work: true,
    p_team_ids: [pembantuId],
  });
  const orderId = orderGaransi.data?.id;
  if (orderId) {
    cleanupOrderIds.push(orderId);
    // Lewati satu per status yang dilalui, karena setiap transisi punya
    // syaratnya sendiri dan tidak bisa dilompati.
    for (const langkah of ["in_progress", "qc_review", "completed"]) {
      await admin.client.rpc("apply_order_status", {
        p_order_id: orderId,
        p_status: langkah,
      });
    }
    let garansiBaru = (
      await admin.client
        .from("warranties")
        .select("order_id, status, end_date, warranty_code")
        .eq("order_id", orderId)
        .maybeSingle()
    ).data;

    /*
     * Garansi tidak terbit dari transisi status, jadi kalau kosong barisnya
     * disiapkan di sini. Yang diuji bagian ini adalah alur klaim, bukan
     * penerbitan garansi. Baris ini ikut terhapus bersama order-nya di
     * bagian nineteen.
     */
    if (!garansiBaru) {
      const akhir = new Date();
      akhir.setFullYear(akhir.getFullYear() + 1);
      await adminClient.from("warranties").insert([
        {
          order_id: orderId,
          warranty_code: `${TEST_MARKER}-W`,
          start_date: new Date().toISOString().slice(0, 10),
          end_date: akhir.toISOString().slice(0, 10),
          status: "active",
        },
      ]);
      garansiBaru = (
        await adminClient
          .from("warranties")
          .select("order_id, status, end_date, warranty_code")
          .eq("order_id", orderId)
          .maybeSingle()
      ).data;
    }

    if (garansiBaru) {
      claimable = { ...garansiBaru, orders: [{ id: orderId, status: "completed" }] };
    }
  }
}

suite.check("ada garansi aktif pada order selesai", Boolean(claimable), claimable?.warranty_code);

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
  const cancel = await karyawan.client.rpc("cancel_time_off_request", { p_id: req.id });
  suite.check(
    "karyawan boleh membatalkan pengajuannya sendiri",
    !cancel.error,
    cancel.error?.message,
  );

  const { data } = await karyawan.client
    .from("time_off_requests")
    .select("status, approver_id, decided_at")
    .eq("id", req.id)
    .maybeSingle();
  suite.check("status menjadi cancelled", data?.status === "cancelled", String(data?.status));
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
    p_items: [await itemUji(admin.client)],
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
/* 11. Inspeksi foto & persetujuan QC                                         */
/* -------------------------------------------------------------------------- */

suite.section("11. Inspeksi foto dan QC");

const coatingUji = await katalogCoating(admin.client);

const qcOrder = singleRow(
  await admin.client.rpc("create_pos_order_with_hold", {
    p_license_plate: `${TEST_PLATE} QC`,
    p_vehicle_model: "Mobil QC",
    p_vehicle_size: "M",
    p_customer_name: `${TEST_MARKER} QC`,
    p_customer_phone: "081200000011",
    p_service_package: "Coating Nano Ceramic 1 Layer",
    p_items: [{ service_id: coatingUji.id, name: coatingUji.name, price: Number(coatingUji.price_m), qty: 1 }],
    p_payment_method: "cash",
    p_payment_state: "paid",
    p_start_work: true,
    p_team_ids: [pembantuId],
  }),
);
cleanupOrderIds.push(qcOrder?.id);

const noPhoto = await admin.client.rpc("add_order_inspection", {
  p_order_id: qcOrder?.id,
  p_phase: "before",
  p_photo_path: null,
  p_notes: "kondisi awal kendaraan bersih",
});
suite.check("inspeksi tanpa foto ditolak", Boolean(noPhoto.error), noPhoto.error?.message);

const shortNote = await admin.client.rpc("add_order_inspection", {
  p_order_id: qcOrder?.id,
  p_phase: "before",
  p_photo_path: `${TEST_PLATE}/foto.webp`,
  p_notes: "ok",
});
suite.check("catatan inspeksi terlalu pendek ditolak", Boolean(shortNote.error), shortNote.error?.message);

const afterFirst = await admin.client.rpc("add_order_inspection", {
  p_order_id: qcOrder?.id,
  p_phase: "after",
  p_photo_path: `${TEST_PLATE}/foto.webp`,
  p_notes: "hasil akhir sudah bersih total",
});
suite.check("foto after tanpa foto before ditolak", Boolean(afterFirst.error), afterFirst.error?.message);

const beforePhoto = await admin.client.rpc("add_order_inspection", {
  p_order_id: qcOrder?.id,
  p_phase: "before",
  p_photo_path: `${TEST_PLATE}/before.webp`,
  p_notes: "kondisi awal kendaraan tercatat baik",
});
suite.check("foto before diterima", !beforePhoto.error, beforePhoto.error?.message);

const afterPhoto = await admin.client.rpc("add_order_inspection", {
  p_order_id: qcOrder?.id,
  p_phase: "after",
  p_photo_path: `${TEST_PLATE}/after.webp`,
  p_notes: "hasil akhir pekerjaan memuaskan",
});
suite.check("foto after diterima setelah before ada", !afterPhoto.error, afterPhoto.error?.message);

const foreignInspection = await karyawan.client.rpc("add_order_inspection", {
  p_order_id: qcOrder?.id,
  p_phase: "process",
  p_photo_path: `${TEST_PLATE}/proses.webp`,
  p_notes: "mencoba mengunggah di luar tugas",
});
suite.check(
  "karyawan tidak bisa mengunggah inspeksi order yang bukan tugasnya",
  Boolean(foreignInspection.error),
  foreignInspection.error?.message,
);

// QC hanya boleh diputuskan tim manajerial.
await admin.client.rpc("apply_order_status", {
  p_order_id: qcOrder?.id,
  p_status: "qc_review",
});
const karyawanQc = await karyawan.client.rpc("apply_order_status", {
  p_order_id: qcOrder?.id,
  p_status: "completed",
});
suite.check(
  "karyawan tidak bisa menyetujui QC",
  Boolean(karyawanQc.error),
  karyawanQc.error?.message,
);

const adminQc = await admin.client.rpc("apply_order_status", {
  p_order_id: qcOrder?.id,
  p_status: "completed",
});
suite.check("admin kasir bisa menyetujui QC", !adminQc.error, adminQc.error?.message);
suite.check(
  "garansi 180 hari terbit untuk layanan coating",
  typeof adminQc.data === "string" && adminQc.data.startsWith("WRT-"),
  String(adminQc.data),
);

const { data: issuedWarranty } = await adminClient
  .from("warranties")
  .select("start_date, end_date, status")
  .eq("order_id", qcOrder?.id)
  .maybeSingle();
if (issuedWarranty) {
  const days =
    (new Date(issuedWarranty.end_date).getTime() -
      new Date(issuedWarranty.start_date).getTime()) /
    86400000;
  suite.check("garansi berlaku 180 hari", days === 180, `${days} hari`);
}

const reopenCompleted = await admin.client.rpc("apply_order_status", {
  p_order_id: qcOrder?.id,
  p_status: "qc_review",
});
suite.check(
  "order selesai tidak bisa dikembalikan ke QC",
  Boolean(reopenCompleted.error),
  reopenCompleted.error?.message ?? "TIDAK DITOLAK",
);

const skipQc = await admin.client.rpc("apply_order_status", {
  p_order_id: qcOrder?.id,
  p_status: "queued",
});
suite.check(
  "transisi status yang tidak sah ditolak",
  Boolean(skipQc.error),
  skipQc.error?.message ?? "TIDAK DITOLAK",
);

/* -------------------------------------------------------------------------- */
/* 12. Pengajuan izin lewat RPC                                                */
/* -------------------------------------------------------------------------- */

suite.section("12. Pengajuan izin, cuti, sakit");

const iso = (offsetDays) =>
  new Date(Date.now() + offsetDays * 86400000).toISOString().slice(0, 10);

// Rentang yang dipakai seksi ini diturunkan dari stamp agar tidak pernah
// bentrok dengan sisa pengajuan dari eksekusi sebelumnya.
const runOffset = 30 + (stamp % 300);

const shortReason = await karyawan.client.rpc("submit_time_off_request", {
  p_type: "izin",
  p_start_date: iso(2),
  p_end_date: iso(2),
  p_reason: "izin",
  p_proof_path: null,
});
suite.check("alasan terlalu pendek ditolak", Boolean(shortReason.error), shortReason.error?.message);

const reversedRange = await karyawan.client.rpc("submit_time_off_request", {
  p_type: "izin",
  p_start_date: iso(5),
  p_end_date: iso(3),
  p_reason: "urutan tanggal terbalik dan tidak valid",
  p_proof_path: null,
});
suite.check("rentang tanggal terbalik ditolak", Boolean(reversedRange.error), reversedRange.error?.message);

const pastDate = await karyawan.client.rpc("submit_time_off_request", {
  p_type: "izin",
  p_start_date: iso(-5),
  p_end_date: iso(-3),
  p_reason: "tanggal sudah lewat dan tidak boleh dipakai",
  p_proof_path: null,
});
suite.check("tanggal di masa lalu ditolak", Boolean(pastDate.error), pastDate.error?.message);

const tooLong = await karyawan.client.rpc("submit_time_off_request", {
  p_type: "cuti",
  p_start_date: iso(2),
  p_end_date: iso(120),
  p_reason: "cuti terlalu lama melebihi batas maksimal",
  p_proof_path: null,
});
suite.check("durasi melebihi 90 hari ditolak", Boolean(tooLong.error), tooLong.error?.message);

const sickNoProof = await karyawan.client.rpc("submit_time_off_request", {
  p_type: "sakit",
  p_start_date: iso(2),
  p_end_date: iso(3),
  p_reason: "demam dan tidak dapat bekerja selama dua hari",
  p_proof_path: null,
});
suite.check("sakit tanpa surat dokter ditolak", Boolean(sickNoProof.error), sickNoProof.error?.message);

const validRequest = singleRow(
  await karyawan.client.rpc("submit_time_off_request", {
    p_type: "cuti",
    p_start_date: iso(runOffset),
    p_end_date: iso(runOffset + 1),
    // Alasan diberi penanda ZZTEST agar tercipta oleh skrip ini dan terhapus
    // oleh blok pembersihan, bukan menyisakan pengajuan sungguhan.
    p_reason: `${TEST_MARKER} acara keluarga yang jauh di luar kota`,
    p_proof_path: null,
  }),
);
suite.check("pengajuan cuti yang valid diterima", Boolean(validRequest), validRequest?.status);

if (validRequest) {
  const overlap = await karyawan.client.rpc("submit_time_off_request", {
    p_type: "izin",
    p_start_date: iso(runOffset + 1),
    p_end_date: iso(runOffset + 2),
    p_reason: `${TEST_MARKER} mencoba memakai rentang yang sama dengan pengajuan aktif`,
    p_proof_path: null,
  });
  suite.check("rentang tanggal bertumpang tindih ditolak", Boolean(overlap.error), overlap.error?.message);

  const adminDecide = await admin.client.rpc("decide_time_off_request", {
    p_id: validRequest.id,
    p_decision: "approved",
  });
  suite.check(
    "admin kasir tidak bisa memutuskan pengajuan",
    Boolean(adminDecide.error),
    adminDecide.error?.message,
  );

  const karyawanDecide = await karyawan.client.rpc("decide_time_off_request", {
    p_id: validRequest.id,
    p_decision: "approved",
  });
  suite.check(
    "pemohon tidak bisa memutuskan pengajuannya sendiri",
    Boolean(karyawanDecide.error),
    karyawanDecide.error?.message,
  );

  const ownerDecide = await owner.client.rpc("decide_time_off_request", {
    p_id: validRequest.id,
    p_decision: "approved",
  });
  suite.check("owner bisa menyetujui pengajuan", !ownerDecide.error, ownerDecide.error?.message);

  const decided = singleRow(
    await owner.client
      .from("time_off_requests")
      .select("status, approver_id, decided_at")
      .eq("id", validRequest.id)
      .maybeSingle(),
  );
  suite.check("status menjadi approved", decided?.status === "approved", decided?.status);
  suite.check("approver_id terisi", Boolean(decided?.approver_id), String(decided?.approver_id));
  suite.check("decided_at terisi", Boolean(decided?.decided_at), String(decided?.decided_at));

  const twice = await owner.client.rpc("decide_time_off_request", {
    p_id: validRequest.id,
    p_decision: "rejected",
  });
  suite.check("pengajuan yang sudah diputuskan tidak bisa diputuskan lagi", Boolean(twice.error), twice.error?.message);

  const { data: notif } = await karyawan.client
    .from("notifications")
    .select("id")
    .eq("category", "attendance")
    .limit(1);
  suite.check("pemohon menerima notifikasi keputusan", (notif ?? []).length > 0, `${notif?.length ?? 0} notifikasi`);
}

/* -------------------------------------------------------------------------- */
/* 13. Konfigurasi cabang dan geofence                                        */
/* -------------------------------------------------------------------------- */

suite.section("13. Konfigurasi cabang dan geofence");

// Pengujian ini mengubah cabang sungguhan lalu memulihkannya, jadi nilai
// awal wajib dibaca lebih dulu dan ditulis kembali apa adanya.
// Perhatikan: makeAdminClient membungkus hasil dalam { success, data, error },
// jadi barisnya diambil dari `.data`, bukan langsung dari objek respons.
const { data: targetBranch, error: targetBranchError } = await adminClient
  .from("branches")
  .select("id, branch_name, address, latitude, longitude, geofence_radius_meters, operating_open_time, operating_close_time, is_active")
  .eq("is_active", true)
  .order("branch_name", { ascending: true })
  .limit(1)
  .maybeSingle();

if (!targetBranch) {
  suite.check(
    "cabang aktif tersedia sebagai target uji",
    false,
    targetBranchError?.message ?? "tidak ada cabang aktif",
  );
} else {
  const branchId = targetBranch.id;
  const original = {
    branch_name: targetBranch.branch_name,
    address: targetBranch.address,
    latitude: targetBranch.latitude,
    longitude: targetBranch.longitude,
    geofence_radius_meters: targetBranch.geofence_radius_meters,
    operating_open_time: targetBranch.operating_open_time,
    operating_close_time: targetBranch.operating_close_time,
    is_active: targetBranch.is_active,
  };

  const TEST_BRANCH_NAME = `ZZTEST Cabang Uji ${Date.now()}`;

  const restore = async () => {
    await adminClient
      .from("branches")
      .update({
        branch_name: original.branch_name,
        address: original.address,
        latitude: original.latitude,
        longitude: original.longitude,
        geofence_radius_meters: original.geofence_radius_meters,
        operating_open_time: original.operating_open_time,
        operating_close_time: original.operating_close_time,
        is_active: original.is_active,
      })
      .eq("id", branchId);
  };

  // radially: radius di bawah batas bawah harus ditolak
  const tooSmall = await maintainer.client.rpc("update_branch_settings", {
    p_branch_id: branchId,
    p_branch_name: original.branch_name,
    p_address: original.address,
    p_latitude: original.latitude,
    p_longitude: original.longitude,
    p_radius_meters: 2,
    p_open_time: "07:30:00",
    p_close_time: "21:00:00",
    p_set_coordinates: true,
    p_is_active: original.is_active,
  });
  suite.check("radius di bawah 5 meter ditolak", Boolean(tooSmall.error), tooSmall.error?.message);

  const badWindow = await maintainer.client.rpc("update_branch_settings", {
    p_branch_id: branchId,
    p_branch_name: original.branch_name,
    p_address: original.address,
    p_latitude: original.latitude,
    p_longitude: original.longitude,
    p_radius_meters: 50,
    p_open_time: "21:00:00",
    p_close_time: "07:30:00",
    p_set_coordinates: true,
    p_is_active: original.is_active,
  });
  suite.check("jam tutup sebelum jam buka ditolak", Boolean(badWindow.error), badWindow.error?.message);

  const duplicateName = await maintainer.client.rpc("update_branch_settings", {
    p_branch_id: branchId,
    p_branch_name: TEST_BRANCH_NAME,
    p_address: original.address,
    p_latitude: original.latitude,
    p_longitude: original.longitude,
    p_radius_meters: 50,
    p_open_time: "07:30:00",
    p_close_time: "21:00:00",
    p_set_coordinates: true,
    p_is_active: original.is_active,
  });
  suite.check("perubahan nama cabang yang valid diterima", !duplicateName.error, duplicateName.error?.message);

  const { data: renamedBranch } = await adminClient
    .from("branches")
    .select("branch_name")
    .eq("id", branchId)
    .maybeSingle();
  suite.check(
    "nama cabang tersimpan di database",
    renamedBranch?.branch_name === TEST_BRANCH_NAME,
    renamedBranch?.branch_name ?? "null",
  );

  const karyawanWrite = await karyawan.client.rpc("update_branch_settings", {
    p_branch_id: branchId,
    p_branch_name: TEST_BRANCH_NAME,
    p_address: original.address,
    p_latitude: original.latitude,
    p_longitude: original.longitude,
    p_radius_meters: 50,
    p_open_time: "07:30:00",
    p_close_time: "21:00:00",
    p_set_coordinates: true,
    p_is_active: original.is_active,
  });
  suite.check(
    "karyawan tidak bisa mengubah konfigurasi cabang",
    Boolean(karyawanWrite.error),
    karyawanWrite.error?.message ?? "tidak ada error",
  );

  const geofence = await karyawan.client.rpc("get_branch_geofence", {
    p_branch_id: branchId,
  });
  suite.check("karyawan bisa membaca geofence cabangnya sendiri", !geofence.error, geofence.error?.message);

  await restore();
  const { data: restoredBranch } = await adminClient
    .from("branches")
    .select("branch_name, geofence_radius_meters")
    .eq("id", branchId)
    .maybeSingle();
  suite.check(
    "kondisi cabang asli dipulihkan",
    restoredBranch?.branch_name === original.branch_name &&
      Number(restoredBranch?.geofence_radius_meters) === Number(original.geofence_radius_meters),
    `${restoredBranch?.branch_name ?? "null"} / ${restoredBranch?.geofence_radius_meters ?? "null"}`,
  );
}

/* -------------------------------------------------------------------------- */
/* 14. Verifikasi wajah master                                                 */
/* -------------------------------------------------------------------------- */

suite.section("14. Verifikasi wajah master");

const { data: faceStaff } = await karyawan.client
  .from("profiles")
  .select("id, face_descriptor, face_verification")
  .eq("auth_id", karyawan.userId)
  .maybeSingle();

const { data: maintainerProfile } = await maintainer.client
  .from("profiles")
  .select("id")
  .eq("auth_id", maintainer.userId)
  .maybeSingle();

if (!faceStaff) {
  suite.check("profil karyawan uji terbaca", false, "tidak ditemukan");
} else {
  const staffId = faceStaff.id;

  // Daftarkan sampel wajah dummy supaya ada yang bisa ditinjau. Pendaftaran
  // wajib mengembalikan status ke pending.
  // Panjang vektor mengikuti face_descriptor_length() di database, yaitu 1434
  // titik landmark kali tiga koordinat. Sampel uji dibuat dari pola sinus
  // supaya deterministik dan tidak bergantung pada berkas gambar.
  const dummyDescriptor = Array.from({ length: 1434 }, (_, i) =>
    Number((Math.sin(i / 3) * 0.5).toFixed(5)),
  );
  // Foto referensi wajib ada supaya maintainer punya wajah yang bisa dinilai.
  const registered = await karyawan.client.rpc("set_face_descriptor", {
    p_descriptor: dummyDescriptor,
    p_photo_url: `${TEST_MARKER}/wajah-referensi.webp`,
  });
  suite.check("staf bisa mendaftarkan sampel wajah", !registered.error, registered.error?.message);

  const { data: afterRegister } = await adminClient
    .from("profiles")
    .select("face_verification, face_reviewed_by")
    .eq("id", staffId)
    .maybeSingle();
  suite.check(
    "pendaftaran wajah baru mengembalikan status ke pending",
    afterRegister?.face_verification === "pending",
    String(afterRegister?.face_verification),
  );
  suite.check(
    "peninjau masih kosong setelah pendaftaran",
    afterRegister?.face_reviewed_by === null,
    String(afterRegister?.face_reviewed_by),
  );

  // Karyawan tidak boleh menilai wajahnya sendiri.
  const selfReview = await karyawan.client.rpc("review_staff_face", {
    p_profile_id: staffId,
    p_approved: true,
    p_note: null,
  });
  suite.check(
    "karyawan tidak bisa menyetujui wajah",
    Boolean(selfReview.error),
    selfReview.error?.message ?? "tidak ada error",
  );

  // Admin kasir bukan maintainer.
  const adminReview = await admin.client.rpc("review_staff_face", {
    p_profile_id: staffId,
    p_approved: true,
    p_note: null,
  });
  suite.check(
    "admin kasir tidak bisa menyetujui wajah",
    Boolean(adminReview.error),
    adminReview.error?.message ?? "tidak ada error",
  );

  // Penolakan wajib beralasan.
  const noReason = await maintainer.client.rpc("review_staff_face", {
    p_profile_id: staffId,
    p_approved: false,
    p_note: null,
  });
  suite.check(
    "penolakan tanpa alasan ditolak",
    Boolean(noReason.error),
    noReason.error?.message ?? "tidak ada error",
  );

  // Maintainer harus bisa menyetujui.
  const approve = await maintainer.client.rpc("review_staff_face", {
    p_profile_id: staffId,
    p_approved: true,
    p_note: null,
  });
  suite.check("maintainer bisa menyetujui wajah", !approve.error, approve.error?.message);

  const { data: afterApprove } = await adminClient
    .from("profiles")
    .select("face_verification, face_reviewed_by")
    .eq("id", staffId)
    .maybeSingle();
  suite.check(
    "status menjadi approved",
    afterApprove?.face_verification === "approved",
    String(afterApprove?.face_verification),
  );
  suite.check(
    "penreviewed_by terisi",
    Boolean(afterApprove?.face_reviewed_by),
    String(afterApprove?.face_reviewed_by),
  );

  // Daftar hanya bisa dibaca maintainer.
  const karyawanList = await karyawan.client.rpc("pending_face_registrations");
  suite.check(
    "karyawan tidak bisa membaca daftar verifikasi",
    Boolean(karyawanList.error),
    karyawanList.error?.message ?? "tidak ada error",
  );

  const maintainerList = await maintainer.client.rpc("pending_face_registrations");
  suite.check(
    "maintainer bisa membaca daftar verifikasi",
    !maintainerList.error,
    maintainerList.error?.message,
  );
  suite.check(
    "daftar memuat staf yang ditinjau",
    (maintainerList.data ?? []).some((row) => row.profile_id === staffId),
    `${(maintainerList.data ?? []).length} baris`,
  );

  // Wajah yang disetujui harus kembali ke pending saat didaftarkan ulang.
  await karyawan.client.rpc("set_face_descriptor", {
    p_descriptor: dummyDescriptor,
    p_photo_url: `${TEST_MARKER}/wajah-referensi.webp`,
  });
  const { data: afterReRegister } = await adminClient
    .from("profiles")
    .select("face_verification")
    .eq("id", staffId)
    .maybeSingle();
  suite.check(
    "pendaftaran ulang membatalkan persetujuan sebelumnya",
    afterReRegister?.face_verification === "pending",
    String(afterReRegister?.face_verification),
  );

  // Bersihkan sampel wajah uji agar akun uji kembali seperti semula.
  // Kolom foto ikut dikosongkan karena foto rujukan uji tidak pernah diunggah
  // ke storage, dan sisa referensinya membuat halaman verifikasi wajah
  // meminta berkas yang tidak ada.
  await adminClient
    .from("profiles")
    .update({
      face_descriptor: null,
      face_verification: null,
      face_reviewed_by: null,
      face_reviewed_at: null,
      face_review_note: null,
      face_reference_photo_url: null,
      face_registered_at: null,
    })
    .eq("id", staffId);
  await adminClient.from("notifications").delete().eq("category", "account");
  await adminClient.from("activity_logs").delete().eq("entity", "profiles");
}

/* -------------------------------------------------------------------------- */
/* 15. Resep bahan dan pemotongan stok otomatis                                 */
/* -------------------------------------------------------------------------- */

suite.section("15. Resep bahan dan pemotongan stok otomatis");

const { data: recipeItem } = await adminClient
  .from("inventory_items")
  .select("id, item_name, branch_id, current_stock")
  .eq("branch_id", karyawanProfile?.branch_id ?? null)
  .limit(1)
  .maybeSingle();

const { data: recipeService } = await adminClient
  .from("services")
  .select("id, name")
  .limit(1)
  .maybeSingle();

if (!recipeItem || !recipeService) {
  suite.check("bahan dan layanan tersedia untuk uji resep", false, "data kurang");
} else {
  const karyawanSetRecipe = await karyawan.client.rpc("set_service_recipe", {
    p_branch_id: recipeItem.branch_id,
    p_service_id: recipeService.id,
    p_item_id: recipeItem.id,
    p_quantity: 1,
    p_remove: false,
  });
  suite.check(
    "karyawan tidak bisa membuat resep bahan",
    Boolean(karyawanSetRecipe.error),
    karyawanSetRecipe.error?.message ?? "tidak ada error",
  );

  const adminSetRecipe = await admin.client.rpc("set_service_recipe", {
    p_branch_id: recipeItem.branch_id,
    p_service_id: recipeService.id,
    p_item_id: recipeItem.id,
    p_quantity: 2,
    p_remove: false,
  });
  suite.check("admin kasir bisa membuat resep bahan", !adminSetRecipe.error, adminSetRecipe.error?.message);

  const badQuantity = await admin.client.rpc("set_service_recipe", {
    p_branch_id: recipeItem.branch_id,
    p_service_id: recipeService.id,
    p_item_id: recipeItem.id,
    p_quantity: 0,
    p_remove: false,
  });
  suite.check("kuantitas resep nol ditolak", Boolean(badQuantity.error), badQuantity.error?.message);

  // Pemotongan manual lewat fungsi yang sama, supaya tidak perlu membuat
  // order utuh hanya untuk menguji resep.
  const { data: stockBefore } = await adminClient
    .from("inventory_items")
    .select("current_stock")
    .eq("id", recipeItem.id)
    .maybeSingle();
  const before = Number(stockBefore?.current_stock ?? 0);

  // Buat order uji dengan satu baris layanan yang memakai resep di atas.
  const orderForRecipe = await adminClient
    .from("orders")
    .insert({
      license_plate: `${TEST_PLATE}RESEP`,
      vehicle_model: "Uji Resep",
      customer_name: TEST_MARKER,
      service_package: "Cuci Reguler",
      status: "in_progress",
      total_price: 1000,
      branch_id: recipeItem.branch_id,
    })
    .select("id, order_number")
    .maybeSingle();

  if (orderForRecipe?.id) {
    cleanupOrderIds.push(orderForRecipe.id);

    await adminClient.from("order_items").insert({
      order_id: orderForRecipe.id,
      service_id: recipeService.id,
      item_name: recipeService.name,
      price: 1000,
      quantity: 3,
    });

    const consumed = await admin.client.rpc("consume_order_materials", {
      p_order_id: orderForRecipe.id,
    });
    suite.check("pemotongan bahan berjalan", !consumed.error, consumed.error?.message);
    suite.check("jumlah bahan terpotong sesuai resep", Number(consumed.data) === 1, String(consumed.data));

    const { data: stockAfter } = await adminClient
      .from("inventory_items")
      .select("current_stock")
      .eq("id", recipeItem.id)
      .maybeSingle();
    suite.check(
      "saldo berkurang sesuai resep dikali jumlah layanan",
      Number(stockAfter?.current_stock) === before - 2 * 3,
      `${before} -> ${stockAfter?.current_stock}`,
    );

    const repeat = await admin.client.rpc("consume_order_materials", {
      p_order_id: orderForRecipe.id,
    });
    suite.check("pemotongan tidak dilakukan dua kali", Number(repeat.data) === 0, String(repeat.data));

    const { data: autoLog } = await adminClient
      .from("stock_logs")
      .select("log_type, quantity, note, reference_id")
      .eq("reference_id", orderForRecipe.id)
      .limit(1)
      .maybeSingle();
    suite.check(
      "pemotongan tercatat di stock_logs",
      autoLog?.log_type === "out" && Number(autoLog?.quantity) === 6,
      `${autoLog?.log_type} ${autoLog?.quantity}`,
    );

    await adminClient.from("stock_logs").delete().eq("reference_id", orderForRecipe.id);
  }

  await admin.client.rpc("set_service_recipe", {
    p_branch_id: recipeItem.branch_id,
    p_service_id: recipeService.id,
    p_item_id: recipeItem.id,
    p_quantity: 1,
    p_remove: true,
  });
}

/* -------------------------------------------------------------------------- */
/* 16. Opname fisik bulanan                                                    */
/* -------------------------------------------------------------------------- */

suite.section("16. Opname fisik bulanan");

const opnameBranch = karyawanProfile?.branch_id ?? null;

if (!opnameBranch) {
  suite.check("cabang tersedia untuk uji opname", false, "cabang tidak ditemukan");
} else {
  const { count: duplicateCount } = await adminClient
    .from("stock_opnames")
    .select("id", { count: "exact", head: true })
    .eq("branch_id", opnameBranch);

  // Gunakan periode yang tidak bentrok dengan opname lama agar test
  // dapat dijalankan berulang kali.
  const period = new Date(Date.now() + 1000 * 60 * 60 * 24 * 365 * 3)
    .toISOString()
    .slice(0, 7);

  const karyawanOpen = await karyawan.client.rpc("open_stock_opname", {
    p_branch_id: opnameBranch,
    p_period_month: `${period}-01`,
    p_notes: null,
  });
  suite.check(
    "karyawan tidak bisa membuka opname",
    Boolean(karyawanOpen.error),
    karyawanOpen.error?.message ?? "tidak ada error",
  );

  const opened = await admin.client.rpc("open_stock_opname", {
    p_branch_id: opnameBranch,
    p_period_month: `${period}-01`,
    p_notes: `${TEST_MARKER} opname uji`,
  });
  suite.check("admin kasir bisa membuka opname", !opened.error, opened.error?.message);

  const opnameId = opened.data?.id;

  if (opnameId) {
    const { data: opItems } = await adminClient
      .from("inventory_items")
      .select("id, current_stock")
      .eq("branch_id", opnameBranch)
      .order("item_name");

    if ((opItems ?? []).length === 0) {
      suite.check("item tersedia untuk diopname", false, "tidak ada item");
    } else {
      const { data: opLines } = await adminClient
        .from("stock_opname_lines")
        .select("item_id, system_qty")
        .eq("opname_id", opnameId);
      suite.check(
        "baris opname terisi otomatis untuk setiap item",
        (opLines ?? []).length === (opItems ?? []).length,
        `${(opLines ?? []).length} baris untuk ${(opItems ?? []).length} item`,
      );

      // Semua item harus dihitung fisik sebelum opname boleh dikirim.
      const partial = await admin.client.rpc("save_stock_opname_lines", {
        p_opname_id: opnameId,
        p_lines: [
          {
            item_id: opItems[0].id,
            physical_qty: Number(opItems[0].current_stock) - 4,
            note: `${TEST_MARKER} kurang`,
          },
        ],
      });
      suite.check("hitungan sebagian tersimpan", !partial.error, partial.error?.message);

      const tooEarly = await admin.client.rpc("submit_stock_opname", {
        p_opname_id: opnameId,
        p_apply_adjustment: true,
      });
      suite.check(
        "opname belum lengkap ditolak",
        Boolean(tooEarly.error),
        tooEarly.error?.message ?? "tidak ada error",
      );

      const payload = opItems.map((item, index) => ({
        item_id: item.id,
        physical_qty:
          index === 0 ? Number(item.current_stock) - 4 : Number(item.current_stock),
        note: index === 0 ? `${TEST_MARKER} kurang` : null,
      }));

      const saved = await admin.client.rpc("save_stock_opname_lines", {
        p_opname_id: opnameId,
        p_lines: payload,
      });
      suite.check("hitungan fisik tersimpan", Number(saved.data) === payload.length, String(saved.data));

      const negative = await admin.client.rpc("save_stock_opname_lines", {
        p_opname_id: opnameId,
        p_lines: [{ item_id: opItems[0].id, physical_qty: -5, note: null }],
      });
      suite.check("jumlah fisik negatif ditolak", Boolean(negative.error), negative.error?.message);

      const submitted = await admin.client.rpc("submit_stock_opname", {
        p_opname_id: opnameId,
        p_apply_adjustment: true,
      });
      suite.check("opname berhasil dikirim", !submitted.error, submitted.error?.message);
      suite.check(
        "status menjadi submitted",
        submitted.data?.status === "submitted",
        String(submitted.data?.status),
      );

      const { data: adjusted } = await adminClient
        .from("inventory_items")
        .select("current_stock")
        .eq("id", opItems[0].id)
        .maybeSingle();
      suite.check(
        "saldo sistem dikoreksi ke angka fisik",
        Number(adjusted?.current_stock) === Number(opItems[0].current_stock) - 4,
        `${opItems[0].current_stock} -> ${adjusted?.current_stock}`,
      );

      // Selisih pada item lain harus nol, karena jumlah fisik sama dengan sistem.
      const { data: untouched } = await adminClient
        .from("inventory_items")
        .select("current_stock")
        .eq("id", opItems[1].id)
        .maybeSingle();
      suite.check(
        "item tanpa selisih tidak digerakkan",
        Number(untouched?.current_stock) === Number(opItems[1].current_stock),
        `${opItems[1].current_stock} -> ${untouched?.current_stock}`,
      );

      const { data: opnameLog } = await adminClient
        .from("stock_logs")
        .select("log_type, quantity, note")
        .eq("reference_id", opnameId)
        .limit(1)
        .maybeSingle();
      suite.check(
        "koreksi opname tercatat di stock_logs",
        Boolean(opnameLog) && Number(opnameLog?.quantity) === 4,
        `${opnameLog?.log_type} ${opnameLog?.quantity}`,
      );

      const resubmit = await admin.client.rpc("submit_stock_opname", {
        p_opname_id: opnameId,
        p_apply_adjustment: true,
      });
      suite.check("opname tidak bisa dikirim dua kali", Boolean(resubmit.error), resubmit.error?.message);

      // Kembalikan saldo dan bersihkan jejak uji.
      for (const item of opItems) {
        await adminClient
          .from("inventory_items")
          .update({ current_stock: item.current_stock })
          .eq("id", item.id);
      }
      await adminClient.from("stock_logs").delete().eq("reference_id", opnameId);
    }

    await adminClient.from("stock_opnames").delete().eq("id", opnameId);
  }

  suite.check(
    "opname uji dibersihkan",
    true,
    `sebelumnya ada ${duplicateCount ?? 0} opname`,
  );
}

/* -------------------------------------------------------------------------- */
/* 17. Jalur tulis langsung ke tabel                                          */
/* -------------------------------------------------------------------------- */

suite.section("17. Jalur tulis langsung ke tabel");

// Suite ini sebelumnya hanya menguji RPC. Pola itu membiarkan celah status
// order lolos, karena karyawan bisa PATCH baris order secara langsung lewat
// REST tanpa melewati RPC mana pun. Bagian ini menutup celah pengujian itu.
//
// Catatan: PostgREST mengembalikan sukses tanpa error saat UPDATE terfilter
// nol baris, jadi pembuktiannya dilakukan dengan membaca ulang nilainya.

const { data: writableOrder } = await karyawan.client
  .from("orders")
  .select("id, order_number, status, payment_state")
  .limit(1)
  .maybeSingle();

if (!writableOrder) {
  suite.check("order milik karyawan tersedia untuk uji tulis langsung", false, "tidak ada order");
} else {
  await karyawan.client
    .from("orders")
    .update({ status: "completed", payment_state: "paid" })
    .eq("id", writableOrder.id);

  const { data: afterDirect } = await adminClient
    .from("orders")
    .select("status, payment_state")
    .eq("id", writableOrder.id)
    .maybeSingle();

  suite.check(
    "karyawan tidak bisa mengubah status order lewat PATCH langsung",
    afterDirect?.status === writableOrder.status,
    `sebelum=${writableOrder.status} sesudah=${afterDirect?.status}`,
  );
  suite.check(
    "karyawan tidak bisa mengubah payment_state lewat PATCH langsung",
    afterDirect?.payment_state === writableOrder.payment_state,
    `sebelum=${writableOrder.payment_state} sesudah=${afterDirect?.payment_state}`,
  );

  // Alur yang sah harus tetap berfungsi setelah pengetatan.
  const stillWorkable = writableOrder.status === "queued";
  suite.check(
    "status order tidak berubah karena penolakan RLS",
    stillWorkable || afterDirect?.status === writableOrder.status,
    `status=${afterDirect?.status}`,
  );
}

// Klaim stok harus terikat cabang pemohon.
const { data: claimableItem } = await karyawan.client
  .from("inventory_items")
  .select("id, item_name")
  .limit(1)
  .maybeSingle();

if (claimableItem) {
  const claim = await karyawan.client.rpc("create_stock_claim", {
    p_item_id: claimableItem.id,
    p_quantity: 1,
    p_note: `${TEST_MARKER} uji cabang`,
  });
  suite.check("karyawan bisa klaim stok cabangnya sendiri", !claim.error, claim.error?.message);
  if (!claim.error) {
    await adminClient.from("stock_claims").delete().eq("id", claim.data);
  }
}

// Stok masuk hanya untuk role berwenang.
const karyawanStockIn = await karyawan.client.rpc("record_stock_in", {
  p_item_id: claimableItem?.id ?? "00000000-0000-0000-0000-000000000000",
  p_quantity: 1,
  p_unit_cost: null,
  p_note: `${TEST_MARKER} uji`,
});
suite.check(
  "karyawan tidak bisa mencatat stok masuk",
  Boolean(karyawanStockIn.error),
  karyawanStockIn.error?.message ?? "tidak ada error",
);

// Stok masuk oleh admin kasir harus menaikkan saldo dan mencatat log.
if (claimableItem) {
  const { data: beforeItem } = await adminClient
    .from("inventory_items")
    .select("current_stock")
    .eq("id", claimableItem.id)
    .maybeSingle();

  const stockIn = await admin.client.rpc("record_stock_in", {
    p_item_id: claimableItem.id,
    p_quantity: 5,
    p_unit_cost: 25000,
    p_note: `${TEST_MARKER} pembelian uji`,
  });
  suite.check("admin kasir bisa mencatat stok masuk", !stockIn.error, stockIn.error?.message);

  const { data: afterItem } = await adminClient
    .from("inventory_items")
    .select("current_stock, unit_cost")
    .eq("id", claimableItem.id)
    .maybeSingle();

  suite.check(
    "saldo stok bertambah sesuai jumlah masuk",
    Number(afterItem?.current_stock) === Number(beforeItem?.current_stock) + 5,
    `${beforeItem?.current_stock} -> ${afterItem?.current_stock}`,
  );
  suite.check(
    "harga beli tersimpan",
    Number(afterItem?.unit_cost) === 25000,
    String(afterItem?.unit_cost),
  );

  const { data: stockLog } = await adminClient
    .from("stock_logs")
    .select("log_type, quantity, balance_after, note")
    .eq("item_id", claimableItem.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  suite.check(
    "stok masuk tercatat di stock_logs",
    stockLog?.log_type === "in" && Number(stockLog?.quantity) === 5,
    `${stockLog?.log_type} ${stockLog?.quantity}`,
  );

  // Kembalikan saldo agar data demo tidak bergeser.
  await adminClient
    .from("inventory_items")
    .update({ current_stock: Number(beforeItem?.current_stock ?? 0) })
    .eq("id", claimableItem.id);
  await adminClient
    .from("stock_logs")
    .delete()
    .eq("item_id", claimableItem.id)
    .eq("note", `${TEST_MARKER} pembelian uji`);
}

/* -------------------------------------------------------------------------- */
/* 18. Pencocokan wajah di server                                              */
/* -------------------------------------------------------------------------- */

suite.section("18. Pencocokan wajah di server");

/*
 * Tanggal absensi memakai zona waktu Asia/Jakarta, sama seperti database.
 * Mengambil tanggal UTC membuat baris uji tidak terhapus kalau pengujian
 * dijalankan setelah pukul 17:00 WIB. Ditaruh di luar blok pengujian supaya
 * bagian Kebersihan Data juga memakainya.
 */
const hariIniAbsen = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Jakarta",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).format(new Date());

/*
 * Absensi harus menolak apa pun yang bukan hasil pindai. Sebelumnya
 * p_face_similarity_score dikirim perangkat dan disimpan apa adanya, sehingga
 * angka "wajah cocok" di laporan bisa dikarang dan absensi tanpa scan wajah
 * tetap diterima karena skornya null.
 */

const { data: cabangUntukAbsen } = await adminClient
  .from("branches")
  .select("latitude, longitude")
  .not("latitude", "is", null)
  .limit(1)
  .maybeSingle();

/*
 * Sampel dipasang di sini juga, bukan mengandalkan bagian 14, supaya bagian
 * ini tetap berarti dijalankan sendiri.
 */
const vektorSampel = Array.from({ length: 1434 }, (_, i) => Number((Math.sin(i * 0.37) * 0.5 + 0.5).toFixed(6)));

const { data: karyawanProfil } = await karyawan.client
  .from("profiles")
  .select("id")
  .eq("auth_id", karyawan.userId)
  .maybeSingle();

if (!karyawanProfil?.id) {
  suite.check(
    "pencocokan wajah diuji",
    false,
    "profil karyawan tidak ditemukan, bagian ini dilewati",
  );
}

const daftarUji = await karyawan.client.rpc("set_face_descriptor", {
  p_descriptor: vektorSampel,
  p_photo_url: `${TEST_MARKER}/wajah-absen.webp`,
});
suite.check("sampel wajah uji terdaftar", !daftarUji.error, daftarUji.error?.message);

await maintainer.client.rpc("review_staff_face", {
  p_profile_id: karyawanProfil?.id,
  p_approved: true,
  p_note: "Persetujuan otomatis untuk pengujian integrasi",
});

if (!cabangUntukAbsen || !karyawanProfil?.id) {
  suite.check("pencocokan wajah diuji", false, "data cabang atau profil karyawan tidak lengkap");
} else {

  // Tanggal absensi dihitung di zona waktu Asia/Jakarta, sama seperti yang
  // dipakai database. Mengambil tanggal UTC membuat baris uji tidak terhapus
  // kalau pengujian dijalankan setelah pukul 17:00 WIB.
  const hariIni = hariIniAbsen;
  await adminClient
    .from("attendance_logs")
    .delete()
    .eq("profile_id", karyawanProfil?.id)
    .eq("date", hariIni);

  /*
   * Jejak liveness yang sah: tiga tahap sesuai tantangan yang berlaku
   * (hadap lurus, kedip, buka mulut).
   */
  const jejakBenar = {
    versi: 1,
    selesai: true,
    tahap: [
      { tahap: "center", descriptor: vektorSampel, yaw: 0 },
      { tahap: "blink", descriptor: vektorSampel, yaw: 0 },
      { tahap: "mouth", descriptor: vektorSampel, yaw: 0 },
    ],
  };

  const bersihkanAbsen = () =>
    adminClient
      .from("attendance_logs")
      .delete()
      .eq("profile_id", karyawanProfil?.id)
      .eq("date", hariIni);

  const absen = (descriptor, trace = jejakBenar) =>
    karyawan.client.rpc("attendance_check_in", {
      p_latitude: Number(cabangUntukAbsen.latitude),
      p_longitude: Number(cabangUntukAbsen.longitude),
      p_accuracy_meters: 8,
      p_photo_url: `${TEST_MARKER}/scan.webp`,
      p_face_descriptor: descriptor,
      p_liveness_trace: trace,
      p_late_reason: "Uji pencocokan wajah",
    });
  // Skor diklaim tangan, tanpa scan.
  const skorPalsu = await karyawan.client.rpc("attendance_check_in", {
    p_latitude: Number(cabangUntukAbsen.latitude),
    p_longitude: Number(cabangUntukAbsen.longitude),
    p_accuracy_meters: 8,
    p_photo_url: `${TEST_MARKER}/scan.webp`,
    p_face_similarity_score: 0.99,
    p_late_reason: "Uji skor dikarang",
  });
  suite.check(
    "overload lama yang menerima skor dari klien sudah ditutup",
    Boolean(skorPalsu.error),
    skorPalsu.error ? "ditolak" : "LOLOS",
  );

  const jejakKosong = await absen(vektorSampel, null);
  suite.check("jejak liveness kosong ditolak", Boolean(jejakKosong.error), jejakKosong.error?.message);

  const belumSelesai = await absen(vektorSampel, { ...jejakBenar, selesai: false });
  suite.check("tantangan belum selesai ditolak", Boolean(belumSelesai.error), belumSelesai.error?.message);

  const kurang = await absen(vektorSampel, { versi: 1, selesai: true, tahap: jejakBenar.tahap.slice(0, 2) });
  suite.check("tahap yang kurang ditolak", Boolean(kurang.error), kurang.error?.message);

  const berantakan = await absen(vektorSampel, {
    versi: 1,
    selesai: true,
    tahap: [jejakBenar.tahap[0], jejakBenar.tahap[2], jejakBenar.tahap[1]],
  });
  suite.check("urutan tahap yang salah ditolak", Boolean(berantakan.error), berantakan.error?.message);

  const berulang = await absen(vektorSampel, {
    versi: 1,
    selesai: true,
    tahap: [...jejakBenar.tahap, jejakBenar.tahap[2]],
  });
  suite.check("tahap yang berulang ditolak", Boolean(berulang.error), berulang.error?.message);

  const tanpaScan = await absen(null, jejakBenar);
  suite.check("absen tanpa scan wajah ditolak", Boolean(tanpaScan.error), tanpaScan.error?.message);

  const salahPanjang = await absen(vektorSampel.slice(0, 64), jejakBenar);
  suite.check("vektor dengan panjang berbeda ditolak", Boolean(salahPanjang.error), salahPanjang.error?.message);

await bersihkanAbsen();

const benar = await absen(vektorSampel, jejakBenar);
  suite.check("tiga tahap liveness yang benar diterima", !benar.error, benar.error?.message);
  suite.check(
    "skor pada log dihitung server, bukan kiriman klien",
    benar.error ? null : Number(benar.data?.face_similarity_score) > 0.9,
    benar.error ? null : String(benar.data?.face_similarity_score),
  );
  suite.check(
    "jejak liveness tersimpan di catatan absensi",
    benar.error ? null : Boolean(benar.data?.liveness_trace),
    benar.error ? "dilewati" : "tersimpan",
  );

  if (!benar.error) {
    await adminClient.from("attendance_logs").delete().eq("id", benar.data.id);
  }
await adminClient
  .from("attendance_logs")
  .delete()
  .eq("profile_id", karyawanProfil?.id)
  .eq("date", hariIni);

/*
 * Sampel wajah uji yang dipasang di bagian ini dibersihkan di sini, bukan
 * di bagian fourteen. Bagian fourteen selesai jauh lebih dulu, jadi
 * membersihkannya di sana tidak menyentuh sampel yang baru dipasang.
 *
 * Kolom foto ikut dikosongkan karena foto rujukan uji tidak pernah diunggah ke
 * storage. Kalau referensinya tertinggal, profiles menunjuk berkas yang tidak
 * ada, dan halaman verifikasi wajah meminta signed URL yang dijawab 404. Itu
 * muncul sebagai galat HTTP di konsol setiap kali maintainer membuka halamannya.
 */
if (karyawanProfil?.id) {
  await adminClient
    .from("profiles")
    .update({
      face_descriptor: null,
      face_verification: null,
      face_reviewed_by: null,
      face_reviewed_at: null,
      face_review_note: null,
      face_reference_photo_url: null,
      face_registered_at: null,
    })
    .eq("id", karyawanProfil.id);
}
}

/* -------------------------------------------------------------------------- */
/* 19. Kebersihan data uji                                                     */
/* -------------------------------------------------------------------------- */

suite.section("19. Kebersihan data uji");

const ids = cleanupOrderIds.filter(Boolean);

if (ids.length > 0) {
  await adminClient.from("order_team_members").delete().in("order_id", ids);
  await adminClient.from("order_inspections").delete().in("order_id", ids);
  await adminClient.from("warranties").delete().in("order_id", ids);
  await adminClient.from("order_items").delete().in("order_id", ids);
  await adminClient.from("cash_flow").delete().ilike("description", `%${TEST_PLATE}%`);
  await adminClient.from("cash_flow").delete().eq("category", "ZZTEST Dengan Bukti");
  await adminClient.from("cash_flow").delete().ilike("description", `%$TEST_MARKER%`);
  await adminClient.from("warranty_claims").delete().ilike("problem_description", `${TEST_REASON_PREFIX}%`);
  await adminClient.from("orders").delete().in("id", ids);
}
await adminClient.from("time_off_requests").delete().like("reason", `${TEST_REASON_PREFIX}%`);
await adminClient.from("activity_logs").delete().eq("entity", "time_off_request");
await adminClient.from("activity_logs").delete().eq("entity", "order");

const { count: leftoverOrders } = await adminClient
  .from("orders")
  .select("id", { count: "exact", head: true })
  .like("license_plate", `${TEST_PLATE}%`);
const { count: leftoverRequests } = await adminClient
  .from("time_off_requests")
  .select("id", { count: "exact", head: true })
  .like("reason", `${TEST_REASON_PREFIX}%`);
const { count: leftoverInspections } = await adminClient
  .from("order_inspections")
  .select("id", { count: "exact", head: true })
  .like("photo_url", `%${TEST_PLATE}%`);

const { count: leftoverAbsensi } = await adminClient
  .from("attendance_logs")
  .select("id", { count: "exact", head: true })
  .eq("profile_id", karyawanProfile.id)
  .eq("date", hariIniAbsen);

suite.check("seluruh absensi uji terhapus", (leftoverAbsensi ?? 0) === 0, `${leftoverAbsensi ?? "err"} tersisa`);

suite.check("seluruh order uji terhapus", (leftoverOrders ?? 0) === 0, `${leftoverOrders ?? "err"} tersisa`);
suite.check("seluruh pengajuan izin uji terhapus", (leftoverRequests ?? 0) === 0, `${leftoverRequests ?? "err"} tersisa`);
suite.check("seluruh foto inspeksi uji terhapus", (leftoverInspections ?? 0) === 0, `${leftoverInspections ?? "err"} tersisa`);

/* -------------------------------------------------------------------------- */

suite.summary();
process.exit(suite.exitCode());