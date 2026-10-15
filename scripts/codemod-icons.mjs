/*
 * Ganti <span className="material-symbols-outlined ...">nama</span> dengan
 * <Icon name="nama" />, lalu buang aturan font Material Symbols.
 *
 * Idempoten: file yang sudah tidak punya material-symbols-outlined dilewati.
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const MARKER = "material-symbols-outlined";

function walk(dir, acc = []) {
  for (const e of readdirSync(dir)) {
    if (e === "node_modules" || e === ".next" || e === ".git") continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, acc);
    else if (/\.tsx$/.test(e)) acc.push(p);
  }
  return acc;
}

const files = [...walk(join(ROOT, "app")), ...walk(join(ROOT, "components"))];

let totalSpan = 0;
let totalFile = 0;
const laporan = [];

for (const f of files) {
  let src = readFileSync(f, "utf8");
  if (!src.includes(MARKER)) continue;

  const sebelum = src;

  // Tangkap tag pembuka yang memuat kelas ikon, sekaligus className-nya.
  const bukaRe =
    /<span\b[^>]*className=(?:"([^"]*\bmaterial-symbols-outlined\b[^"]*)"|\{`([^`]*\bmaterial-symbols-outlined\b[^`]*?)`\})[^>]*>/g;

  let hasil = "";
  let cursor = 0;
  let m;
  let hitung = 0;

  while ((m = bukaRe.exec(src))) {
    const cls = m[1] ?? m[2] ?? "";
    const tagBuka = m[0];
    const isiMulai = bukaRe.lastIndex;
    const isiAkhir = src.indexOf("</span>", isiMulai);
    if (isiAkhir === -1) continue;

    let isi = src.slice(isiMulai, isiAkhir).trim();

    // Sisa kelas selain penanda ikon.
    const clsBersih = cls
      .replace(/\bmaterial-symbols-outlined\b/g, "")
      .replace(/\s+/g, " ")
      .trim();

    // Bentuk nama ikon:
    //   payments                      -> "payments"
    //   {a ? "x" : "y"}               -> {a ? "x" : "y"}
    //   {item.icon}                   -> {item.icon}
    let name;
    const expr = isi.match(/^\{(.+)\}$/s);
    if (expr) {
      name = `{${expr[1].trim()}}`;
    } else if (/^[a-z][a-z0-9_]*$/.test(isi)) {
      name = `"${isi}"`;
    } else {
      continue;
    }

    const attrCls = clsBersih ? ` className="${clsBersih}"` : "";
    hasil += src.slice(cursor, m.index) + `<Icon name=${name}${attrCls} />`;

    cursor = isiAkhir + "</span>".length;
    hitung += 1;
  }

  if (hitung === 0) continue;

  hasil += src.slice(cursor);
  src = hasil;
  totalSpan += hitung;
  totalFile += 1;

  // Tambahkan import Icon kalau belum ada.
  if (!/\bfrom\s+"@\/components\/ui\/icon"/.test(src)) {
    // Sisipkan setelah blok import terakhir yang ada di bagian atas berkas.
    const importRe = /^import\s[\s\S]*?from\s+"[^"]+";/gm;
    let akhir = 0;
    let im;
    while ((im = importRe.exec(src))) akhir = im.index + im[0].length;
    if (akhir === 0) {
      src = `import { Icon } from "@/components/ui/icon";\n\n` + src;
    } else {
      src =
        src.slice(0, akhir) +
        `\nimport { Icon } from "@/components/ui/icon";` +
        src.slice(akhir);
    }
  }

  writeFileSync(f, src, "utf8");
  laporan.push(`  ${hitung.toString().padStart(3)}  ${relative(ROOT, f)}`);
}

console.log(`berkas diubah : ${totalFile}`);
console.log(`ikon diganti  : ${totalSpan}`);
console.log(laporan.join("\n"));
