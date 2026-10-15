import { loadEnv, requireEnv } from "./config.mjs";

const env = requireEnv(loadEnv(), ["SUPABASE_ACCESS_TOKEN", "SUPABASE_PROJECT_REF"]);
const url = `https://api.supabase.com/v1/projects/${env.SUPABASE_PROJECT_REF}/database/query`;

/**
 * Menjalankan SQL lewat Management API.
 *
 * CATATAN PENTING: fungsi ini TIDAK dibungkus transaksi. Management API
 * mengabaikan begin/commit, sehingga pernyataan sebelum error tetap terpasang.
 * Terverifikasi pada migrasi 0029: ALTER TABLE dan CREATE FUNCTION di awal
 * berkas sudah ada di database meski REVOKE berikutnya gagal.
 *
 * Karena itu setiap migrasi wajib idempoten penuh: DROP IF EXISTS,
 * CREATE OR REPLACE, atau ADD COLUMN dengan pemeriksaan. Berkas yang gagal di
 * tengah aman dipasang ulang.
 */
export async function sql(query) {
  const r = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query }),
  });
  const teks = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${teks.slice(0, 400)}`);
  return JSON.parse(teks);
}

// process.argv[1] tidak ada kalau modul ini diimpor dari node -e, jadi
// jalur_absolute harus aman dari undefined.
const jalurSkrip = process.argv[1] ?? "";

if (import.meta.url === `file:///${jalurSkrip.replace(/\\/g, "/")}`) {
  const cek = [
    ["cash_flow amount <= 0", "select count(*)::int as n from cash_flow where amount <= 0"],
    ["nama layanan duplikat", "select count(*)::int as n from (select name from services group by name having count(*) > 1) d"],
    ["qty item <= 0 atau > 999", "select count(*)::int as n from order_items where quantity <= 0 or quantity > 999"],
    ["radius geofence di luar 5-5000", "select count(*)::int as n from branches where geofence_radius_meters < 5 or geofence_radius_meters > 5000"],
    ["order tanpa branch", "select count(*)::int as n from orders where branch_id is null"],
    ["absensi ganda per orang per hari", "select count(*)::int as n from (select profile_id, date from attendance_logs group by profile_id, date having count(*) > 1) d"],
    ["constraint yang sudah ada", "select conname from pg_constraint where conname in ('order_items_quantity_positive','cash_flow_amount_positive','services_name_unique','branches_geofence_radius_range')"],
  ];

  for (const [label, q] of cek) {
    try {
      const r = await sql(q);
      if (Array.isArray(r) && typeof r[0] === "object" && "conname" in r[0]) {
        console.log(`${label.padEnd(34)} sudah ada: ${r.map((x) => x.conname).join(", ") || "tidak ada"}`);
      } else {
        console.log(`${label.padEnd(34)} bermasalah: ${r[0]?.n ?? "?"}`);
      }
    } catch (e) {
      console.log(`${label.padEnd(34)} ERROR: ${e.message.slice(0, 110)}`);
    }
  }
}