import { createClient } from "@supabase/supabase-js";
import { loadEnv } from "./lib/config.mjs";

const env = loadEnv();
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

const TEST_PASSWORD = "TestRB#2026!";

const TEST_USERS = [
  {
    email: "test.owner@rbautoluxe.com",
    role: "owner",
    fullName: "Budi Owner (Test)",
    workSchedule: "office",
    phone: "081200000001",
  },
  {
    email: "test.manager@rbautoluxe.com",
    role: "manager",
    fullName: "Agus Manager (Test)",
    workSchedule: "office",
    phone: "081200000002",
  },
  {
    email: "test.kasir@rbautoluxe.com",
    role: "admin_kasir",
    fullName: "Siti Kasir (Test)",
    workSchedule: "office",
    phone: "081200000003",
  },
  {
    email: "test.kepala@rbautoluxe.com",
    role: "kepala_karyawan",
    fullName: "Joko Kepala Teknisi (Test)",
    workSchedule: "field",
    phone: "081200000004",
  },
  {
    email: "test.karyawan@rbautoluxe.com",
    role: "karyawan",
    fullName: "Doni Teknisi Detailing (Test)",
    workSchedule: "field",
    phone: "081200000005",
  },
  {
    email: "test.finance@rbautoluxe.com",
    role: "finance",
    fullName: "Rina Finance (Test)",
    workSchedule: "office",
    phone: "081200000006",
  },
];

async function setup() {
  console.log("1. Mengambil data cabang...");
  const { data: branches, error: bErr } = await supabase
    .from("branches")
    .select("id, branch_name, is_active")
    .order("created_at", { ascending: true });

  if (bErr || !branches || branches.length === 0) {
    throw new Error(`Gagal mengambil cabang: ${bErr?.message}`);
  }
  const targetBranch = branches.find((b) => b.is_active) || branches[0];
  console.log(`Menggunakan cabang: ${targetBranch.branch_name} (${targetBranch.id})`);

  console.log("\n2. Mengambil daftar akun Auth yang sudah ada...");
  const { data: { users: existingAuthUsers }, error: listErr } = await supabase.auth.admin.listUsers();
  if (listErr) throw listErr;

  const authByEmail = new Map(existingAuthUsers.map((u) => [u.email?.toLowerCase(), u]));

  for (const u of TEST_USERS) {
    let authUser = authByEmail.get(u.email.toLowerCase());
    if (!authUser) {
      console.log(`- Membuat user auth baru: ${u.email}...`);
      const { data: newAuth, error: createErr } = await supabase.auth.admin.createUser({
        email: u.email,
        password: TEST_PASSWORD,
        email_confirm: true,
        user_metadata: { full_name: u.fullName },
      });
      if (createErr) {
        console.error(`  Gagal buat auth ${u.email}:`, createErr.message);
        continue;
      }
      authUser = newAuth.user;
    } else {
      console.log(`- User auth ada: ${u.email}, update password...`);
      await supabase.auth.admin.updateUserById(authUser.id, {
        password: TEST_PASSWORD,
        email_confirm: true,
      });
    }

    // Pastikan profile sinkron
    const { data: existingProf } = await supabase
      .from("profiles")
      .select("id")
      .eq("auth_id", authUser.id)
      .maybeSingle();

    if (existingProf) {
      console.log(`  Update profile ${u.email} -> role: ${u.role}`);
      await supabase
        .from("profiles")
        .update({
          full_name: u.fullName,
          role: u.role,
          branch_id: targetBranch.id,
          work_schedule: u.workSchedule,
          phone: u.phone,
          is_active: true,
          default_off_day: 0, // Minggu
          off_in_lieu_balance: 2, // kasih saldo 2 hari untuk tes
        })
        .eq("id", existingProf.id);
    } else {
      console.log(`  Insert profile baru ${u.email} -> role: ${u.role}`);
      await supabase.from("profiles").insert({
        auth_id: authUser.id,
        full_name: u.fullName,
        role: u.role,
        branch_id: targetBranch.id,
        work_schedule: u.workSchedule,
        phone: u.phone,
        is_active: true,
        default_off_day: 0,
        off_in_lieu_balance: 2,
      });
    }
  }

  console.log("\nSetup akun uji selesai!");
}

setup().catch(console.error);
