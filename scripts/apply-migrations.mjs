/**
 * Memasang migrasi SQL ke Supabase lewat Management API.
 *
 * Dipakai karena migrasi di repo tidak selalu sama dengan isi database
 * produksi. Selalu baca definisi fungsi yang akan diganti dari database
 * sebelum menulis ulang, lalu jalankan pengujian integrasi setelahnya.
 *
 * Setiap berkas dijalankan di dalam transaksi. Kalau ada pernyataan yang
 * gagal, tidak ada perubahan yang tertinggal separuh jalan.
 *
 *   node scripts/apply-migrations.mjs supabase/migrations/0026_*.sql
 */
import { readFile } from "node:fs/promises";
import { sqlTx } from "./lib/sql.mjs";

const files = process.argv.slice(2);

if (files.length === 0) {
  console.log("Pakai: node scripts/apply-migrations.mjs <berkas.sql> [...]");
  process.exit(1);
}

let gagal = 0;
for (const f of files) {
  const isi = await readFile(f, "utf8");
  try {
    await sqlTx(isi);
    console.log(`TERPASANG  ${f}`);
  } catch (e) {
    gagal++;
    console.log(`GAGAL      ${f}`);
    console.log(`           ${e.message.slice(0, 500)}`);
    break;
  }
}

if (gagal > 0) {
  console.log("\nTransaksi dibatalkan. Perubahan sebelumnya tetap berlaku, yang gagal tidak.");
  process.exit(1);
}

console.log("\nSemua migrasi terpasang. Jalankan npm run test:integration sebelum dianggap selesai.");
