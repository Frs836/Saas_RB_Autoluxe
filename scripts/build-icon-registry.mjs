/*
 * Ambil path SVG asli Material Symbols dari Google Fonts, lalu tulis
 * registry TypeScript. Ikon jadi inline SVG, bukan ligature font, jadi
 * tidak ada lagi keadaan di mana teks "DASHBOARD" tampil mentah karena
 * font gagal dimuat atau subset-nya kurang.
 */
import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const OUT = join(ROOT, "components", "ui", "icon-paths.ts");

function walk(dir, acc = []) {
  for (const e of readdirSync(dir)) {
    if (e === "node_modules" || e === ".next" || e === ".git") continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, acc);
    else if (/\.tsx?$/.test(e)) acc.push(p);
  }
  return acc;
}

const files = [...walk(join(ROOT, "app")), ...walk(join(ROOT, "components")), ...walk(join(ROOT, "lib"))];

const nama = new Set();
const TAKEN = /^[a-z][a-z0-9_]{1,40}$/;

for (const f of files) {
  const src = readFileSync(f, "utf8");

  // <span className="material-symbols-outlined ...">ISI</span>
  const spanRe = /<span\b[^>]*className=(?:"[^"]*\bmaterial-symbols-outlined\b[^"]*"|\{`[^`]*\bmaterial-symbols-outlined\b[^`]*`\})[^>]*>/g;
  let m;
  while ((m = spanRe.exec(src))) {
    const mulai = spanRe.lastIndex;
    const akhir = src.indexOf("</span>", mulai);
    if (akhir === -1) continue;
    let isi = src.slice(mulai, akhir);

    // Buang ekspresi yang bukan nama ikon: ambil hanya string literal.
    const literal = isi.matchAll(/["'`]([a-z][a-z0-9_]*)["'`]/g);
    for (const l of literal) if (TAKEN.test(l[1])) nama.add(l[1]);

    // Nama ikon juga bisa ditulis polos tanpa tanda kutip.
    const polos = isi.match(/(?:^|>)\s*([a-z][a-z0-9_]*)\s*</);
    if (polos && TAKEN.test(polos[1])) nama.add(polos[1]);
  }

  // icon: "nama" di data menu
  for (const p of src.matchAll(/\bicon:\s*["'`]([a-z][a-z0-9_]*)["'`]/g)) nama.add(p[1]);
}

const daftar = [...nama].sort();
console.log("kandidat dari source:", daftar.length);

/*
 * Filter kandidat lewat daftar nama ikon resmi Google. Tanpa ini, string
 * status seperti "closed" atau "hadir" ikut terambil karena muncul di
 * dalam blok ikon, lalu gagal diunduh dan terdaftar sebagai ikon hilang.
 */
const meta = await (await fetch("https://fonts.google.com/metadata/icons")).text();
const resmi = new Set(JSON.parse(meta.replace(/^\)\]\}'\s*/, "")).icons.map((i) => i.name));

const dipakaiFile = join(ROOT, "public", "fonts", "dipakai.txt");
let dipakai = [];
try {
  dipakai = readFileSync(dipakaiFile, "utf8").split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
} catch {}

const sah = [...new Set([...daftar, ...dipakai])].filter((n) => resmi.has(n)).sort();
const bukanIkon = [...new Set([...daftar, ...dipakai])].filter((n) => !resmi.has(n)).sort();
console.log("nama resmi tersedia :", resmi.size);
console.log("dipakai setelah filter:", sah.length);
if (bukanIkon.length) console.log("DIBUANG (bukan ikon):", bukanIkon.join(", "));

const daftarFinal = sah;
console.log("ikon akan diambil:", daftarFinal.length);

const path = {};
const gagal = [];

async function ambil(n) {
  const u = `https://fonts.gstatic.com/s/i/short-term/release/materialsymbolsoutlined/${n}/default/48px.svg`;
  const res = await fetch(u);
  if (!res.ok) throw new Error("HTTP " + res.status);
  const svg = await res.text();
  const d = svg.match(/ d="([^"]+)"/);
  const vb = svg.match(/viewBox="([^"]+)"/);
  if (!d || !vb) throw new Error("tidak ada path");
  return { d: d[1], vb: vb[1] };
}

const BATCH = 8;
for (let i = 0; i < daftarFinal.length; i += BATCH) {
  const potong = daftarFinal.slice(i, i + BATCH);
  const hasil = await Promise.all(
    potong.map(async (n) => {
      try {
        return [n, await ambil(n)];
      } catch {
        return [n, null];
      }
    })
  );
  for (const [n, v] of hasil) {
    if (v) path[n] = v;
    else gagal.push(n);
  }
  process.stdout.write(`\r  unduh ${Object.keys(path).length}/${daftarFinal.length}`);
}

console.log("\nberhasil :", Object.keys(path).length);
if (gagal.length) console.log("GAGAL    :", gagal.join(", "));

const isi = `/*
 * Path SVG Material Symbols Outlined, diambil langsung dari Google Fonts.
 *
 * Dihasilkan oleh scripts/build-icon-registry.mjs. Jangan diedit manual,
 * jalankan ulang script itu untuk memperbarui.
 *
 * Ikon sebelumnya memakai ligature font. Kalau font gagal dimuat, teks
 * nama ikon tampil mentah dan merusak tampilan. Inline SVG tidak punya
 * kemungkinan itu.
 */
export type IconGlyph = {
  d: string;
  vb: string;
};

export const ICON_PATHS = ${JSON.stringify(path, null, 2)} as const satisfies Record<string, IconGlyph>;

export type IconName = keyof typeof ICON_PATHS;
`;

mkdirSync(join(ROOT, "components", "ui"), { recursive: true });
writeFileSync(OUT, isi, "utf8");
console.log("tulis:", relative(ROOT, OUT));
