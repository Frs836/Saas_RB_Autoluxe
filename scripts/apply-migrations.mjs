/**
 * Memasang migrasi SQL ke Supabase lewat Management API.
 *
 * PENTING: Management API tidak menghormati pembungkus begin/commit.
 * Pernyataan yang tertulis sebelum error TETAP TERPASANG, walau berkas
 * associada gagal di tengah jalan. Ini terverifikasi pada migrasi 0029, di
 * mana ALTER TABLE dan CREATE FUNCTION di awal berkas sudah ada di database
 * meski REVOKE berikutnya gagal.
 *
 * Karena itu setiap migrasi di repo harus idempoten penuh: DROP IF EXISTS,
 * CREATE OR REPLACE, atau ADD COLUMN dengan pemeriksaan. Dengan begitu berkas
 * yang gagal di tengah aman dipasang ulang.
 *
 * Sebelum mengganti fungsi apa pun, baca definisi yang sedang terpasang dari
 * database memakai pg_get_functiondef. Isi database tidak selalu sama dengan
 * berkas migrasi di repo.
 *
 *   node scripts/apply-migrations.mjs supabase/migrations/0026_*.sql
 */
import { readFile } from "node:fs/promises";
import { sql } from "./lib/sql.mjs";

const files = process.argv.slice(2);

if (files.length === 0) {
  console.log("Pakai: node scripts/apply-migrations.mjs <berkas.sql> [...]");
  process.exit(1);
}

let gagal = 0;
for (const f of files) {
  const isi = await readFile(f, "utf8");
  try {
    await sql(isi);
    console.log(`TERPASANG  ${f}`);
  } catch (e) {
    gagal++;
    console.log(`GAGAL      ${f}`);
    console.log(`           ${e.message.slice(0, 500)}`);
    console.log(
      "           Perintah sebelum titik gagal SUDAH TERPASANG. Perbaiki berkasnya",
    );
    console.log("           lalu jalankan ulang; berkas harus idempoten.");
    break;
  }
}

if (gagal > 0) {
  process.exit(1);
}

console.log("\nSemua migrasi terpasang. Jalankan npm run test:integration sebelum dianggap selesai.");
