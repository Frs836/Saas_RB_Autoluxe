import { sql } from "./scripts/lib/sql.mjs";

const r = await sql(`
  select pg_get_functiondef(p.oid) as def
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'guard_order_identity'
`);
const def = r[0]?.def ?? "(tidak ada)";
console.log("=== guard_order_identity yang sekarang terpasang ===");
console.log(def);
console.log("\n=== apakah ada fungsi lain yang membaca flag itu? ===");
const f = await sql(`
  select proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and prosrc ilike '%trusted_order_write%'
`);
console.log(f.map((x) => x.proname).join(", ") || "(tidak ada)");