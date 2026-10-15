import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { join } from "node:path";

/**
 * Membangun subset font Material Symbols yang hanya memuat ikon yang benar-benar
 * dipakai aplikasi.
 *
 * Font aslinya berukuran 3,9 MB dan dimuat dari Google, sekaligus memblokir
 * render. Setiap halaman menunggu 3,9 MB itu hanya untuk menampilkan ikon
 * daftar dan roda gigi. Google Fonts menyediakan parameter icon_names yang
 * memangkas font hanya ke glif yang diminta, dan sumbu variabel bisa dikunci
 * ke nilai yang memang dipakai aplikasi.
 */

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const files = execSync('git ls-files "*.tsx" "*.ts"', { encoding: "utf8" })
  .trim()
  .split("\n")
  .filter((f) => f.startsWith("app/") || f.startsWith("components/"));

// Ikon yang hanya muncul sebagai nilai cadangan, bukan sebagai nama ikon.
const tambahan = ["loading", "progress_activity", "photo_camera"];

const set = new Set();
for (const f of files) {
  const c = readFileSync(f, "utf8");
  // Bentuk biasa: ikon ditulis sebagai teks di dalam span.
  for (const m of c.matchAll(
    /material-symbols-outlined[^>]*>\s*([a-z_0-9]+)\s*</g,
  )) {
    set.add(m[1]);
  }
  // Bentuk kedua: ikon datang dari ekspresi, misalnya
  // {sibuk ? "hourglass_top" : "add_business"}.
  //
  // Bentuk ini tidak tertangkap pola di atas, dan itulah cara ikon
  // add_business hilang dari subset sehingga tampil sebagai tulisan. Semua
  // nama yang Gene di dalam kurung kurawal pada baris yang sama dengan
  // material-symbols-outlined ikut diambil.
  for (const m of c.matchAll(
    /material-symbols-outlined[\s\S]{0,120}?\}\s*([a-z_0-9]{3,30})/g,
  )) {
    set.add(m[1]);
  }
  // Bentuk ketiga: nama ikon dari properti objek, misalnya daftar tab
  // { key: "harian", label: "Harian", icon: "today" }.
  for (const m of c.matchAll(/\bicon:\s*"([a-z_0-9]{3,30})"/g)) {
    set.add(m[1]);
  }
}

// Daftar ikon dipakai sebagai nilai cadangan di luar kode sumber.
for (const t of tambahan) set.add(t);

const ikon = [...set].sort();
console.log("ikon dipakai: " + ikon.length);

// Sumbu dikunci ke nilai yang dipakai app: FILL 0, wght 500, GRAD 0, opsz 24.
const sumbu = "FILL,GRAD,opsz,wght@0,0,24,500";
const url =
  "https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:" +
  sumbu +
  "&icon_names=" +
  ikon.join(",");

const css = await (await fetch(url, { headers: { "User-Agent": UA } })).text();
console.log("panjang CSS: " + css.length);

const m = css.match(/url\((https:\/\/[^)]+)\)/);
if (!m) {
  console.log("CSS tidak memuat url font:\n" + css.slice(0, 400));
  process.exit(1);
}

const fontUrl = m[1];
const fontResp = await fetch(fontUrl, { headers: { "User-Agent": UA } });
const buf = Buffer.from(await fontResp.arrayBuffer());

console.log("font asli (subset): " + (buf.length / 1024).toFixed(1) + " KB");
console.log("format: " + fontUrl.split(".").pop());

const dir = "public/fonts";
if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
const out = join(dir, "material-symbols-subset.woff2");
writeFileSync(out, buf);

console.log("ditulis: " + out);
console.log("\nperbandingan:");
console.log("  sebelum : 3907 KB, render-blocking, dari domain lain");
console.log("  sesudah : " + (buf.length / 1024).toFixed(1) + " KB, sama.origin, tidak memblokir");

// Simpan daftar ikon sebagai berkas supaya bisa dipakai saat menambah ikon baru.
writeFileSync(join(dir, "dipakai.txt"), ikon.join("\n") + "\n", "utf8");
console.log("daftar ikon disimpan di " + dir + "/dipakai.txt");
