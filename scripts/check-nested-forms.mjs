import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";

/**
 * Memeriksa form bersarang di seluruh berkas tsx.
 *
 * Form di dalam form tidak valid di HTML. Browser menutup form luar sendiri
 * saat membaca HTML, sehingga pohon DOM yang dibaca browser berbeda dari
 * yang diharap React dan muncul galat hidrasi. Pemeriksa ini menghitung
 * kedalaman, bukan cuma jumlah tag, supaya dua form bersebelahan tidak
 * ikut dianggap bersarang.
 */

const files = execSync('git ls-files "*.tsx"', { encoding: "utf8" })
  .trim()
  .split("\n")
  .filter((f) => f.startsWith("app/") || f.startsWith("components/"));

let masalah = 0;
let totalForm = 0;

for (const f of files) {
  const mentah = readFileSync(f, "utf8");
  // Komentar JSX dan blok komentar dilepas supaya contoh di dalam catatan
  // tidak dihitung sebagai kode nyata.
  const kode = mentah
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, " ");

  let kedalaman = 0;
  let maks = 0;
  const jejakBaris = [];
  let baris = 1;

  const pola = /<form[\s>][^>]*>|<\/form>/g;
  let m;
  while ((m = pola.exec(kode)) !== null) {
    baris += (kode.slice(0, m.index).match(/\n/g) || []).length;
    if (m[0].startsWith("</")) {
      kedalaman -= 1;
      if (kedalaman < 0) {
        jejakBaris.push(`baris ~${baris}: form ditutup tanpa dibuka`);
        kedalaman = 0;
      }
    } else {
      kedalaman += 1;
      totalForm += 1;
      if (kedalaman > 1) {
        jejakBaris.push(`baris ~${baris}: form di dalam form (kedalaman ${kedalaman})`);
      }
      maks = Math.max(maks, kedalaman);
    }
  }

  if (kedalaman > 0) jejakBaris.push(`form tidak ditutup (sisa ${kedalaman})`);

  if (jejakBaris.length > 0) {
    masalah += 1;
    console.log("\n" + f);
    for (const j of jejakBaris) console.log("   " + j);
  }
}

console.log(
  "\n" +
    (masalah === 0
      ? `Tidak ada form bersarang. ${totalForm} form diperiksa.`
      : `${masalah} berkas bermasalah.`)
);
process.exit(masalah === 0 ? 0 : 1);
