import { readFile } from "node:fs/promises";
import { sqlTx } from "./scripts/lib/sql.mjs";

const files = process.argv.slice(2);
if (files.length === 0) {
  console.log("Pakai: node tmp-apply.mjs <file.sql> [...]");
  process.exit(1);
}

for (const f of files) {
  const isi = await readFile(f, "utf8");
  try {
    await sqlTx(isi);
    console.log(`TERPASANG  ${f}`);
  } catch (e) {
    console.log(`GAGAL      ${f}`);
    console.log(`           ${e.message.slice(0, 400)}`);
    process.exitCode = 1;
    break;
  }
}