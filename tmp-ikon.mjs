import { chromium } from "@playwright/test";

const BASE = process.env.BASE_URL || "https://rb-autoluxe.vercel.app";
const browser = await chromium.launch();
const page = await browser.newPage();

await page.goto(BASE + "/login", { waitUntil: "networkidle", timeout: 60000 });
await page.waitForTimeout(1500);

const hasil = await page.evaluate(async () => {
  // Ukur lebar teks ikon. Kalau ligatur bekerja, satu kata seperti home
  // dirender sebagai satu glif yang sempit. Kalau tidak,四个字 yang lebar.
  const ukur = (font) => {
    const s = document.createElement("span");
    s.textContent = "home";
    s.style.cssText =
      `position:absolute;visibility:hidden;white-space:nowrap;font-size:100px;font-family:${font};`;
    document.body.appendChild(s);
    const w = s.getBoundingClientRect().width;
    s.remove();
    return Math.round(w);
  };

  await document.fonts.ready;
  const adaSubset = document.fonts.check("24px 'Material Symbols Outlined'");

  return {
    denganSubset: ukur("'Material Symbols Outlined', sans-serif"),
    denganFallback: ukur("sans-serif"),
    fontTerdafar: [...document.fonts].map((f) => f.family + " " + f.status).slice(0, 6),
    cekSubset: adaSubset,
  };
});

console.log("lebar teks 'home' dengan font ikon : " + hasil.denganSubset + "px");
console.log("lebar teks 'home' dengan sans-serif: " + hasil.denganFallback + "px");
console.log("font terdaftar: " + JSON.stringify(hasil.fontTerdafar));
console.log("font subset terpasang: " + hasil.cekSubset);

const rasio = hasil.denganSubset / hasil.denganFallback;
console.log("\nrasio: " + rasio.toFixed(2));
console.log(
  rasio < 0.6
    ? "  LIGATUR BEKERJA, ikon dirender sebagai glif"
    : "  LIGATUR TIDAK BEKERJA, teks ikon tampil apa adanya",
);

// Ambil juga sample teks ikon yang tampil di halaman
const contoh = await page.evaluate(() => {
  const el = document.querySelectorAll(".material-symbols-outlined");
  return [...el].slice(0, 8).map((e) => e.textContent.trim());
});
console.log("\ncontoh isi elemen ikon di halaman:");
contoh.forEach((t) => console.log("  " + JSON.stringify(t)));

await browser.close();