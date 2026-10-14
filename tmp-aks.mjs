import { loadEnv, requireEnv } from "./scripts/lib/config.mjs";

const env = requireEnv(loadEnv(), ["SUPABASE_ACCESS_TOKEN", "SUPABASE_PROJECT_REF"]);
const url = `https://api.supabase.com/v1/projects/${env.SUPABASE_PROJECT_REF}/database/query`;

const sql = async (query) => {
  const r = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query }),
  });
  const teks = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${teks.slice(0, 300)}`);
  return JSON.parse(teks);
};

try {
  const hasil = await sql("select current_database() as db, current_user as usr");
  console.log(`Akses OK. db=${hasil[0].db} user=${hasil[0].usr}`);
} catch (e) {
  console.log(`GAGAL: ${e.message}`);
}