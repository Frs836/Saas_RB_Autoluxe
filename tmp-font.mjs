import { chromium } from "@playwright/test";

const BASE = process.env.BASE_URL || "https://rb-autoluxe.vercel.app";
const browser = await chromium.launch();
const ctx = await browser.newContext();
const page = await ctx.newPage();

page.on("response", async (r) => {
  if (r.url().includes("material-symbols") || r.url().includes("font")) {
    console.log(`HTTP ${r.status()}  ${r.url().replace(BASE, "")}`);
    console.log("   content-type : " + (r.headers()["content-type"] ?? "-"));
    console.log("   content-length: " + (r.headers()["content-length"] ?? "-"));
    console.log("   cache-control : " + (r.headers()["cache-control"] ?? "-"));
    console.log("   access-control: " + (r.headers()["access-control-allow-origin"] ?? "-"));
  }
});
page.on("requestfailed", (r) => {
  if (r.url().includes("font")) {
    console.log("GAGAL: " + r.url().replace(BASE, "") + " " + (r.failure()?.errorText ?? ""));
  }
});
page.on("console", (m) => {
  if (m.type() === "error" || /font|woff/i.test(m.text())) {
    console.log("KONSOL[" + m.type() + "]: " + m.text().slice(0, 200));
  }
});

await page.goto(BASE + "/login", { waitUntil: "networkidle", timeout: 60000 });
await page.waitForTimeout(2500);

const detail = await page.evaluate(async () => {
  await document.fonts.ready;
  const hasil = [];
  document.fonts.forEach((f) => {
    hasil.push(f.family + " | " + f.status + " | " + f.weight + " | " + f.style);
  });
  return hasil;
});
console.log("\nstatus font di dokumen:");
detail.forEach((d) => console.log("  " + d));

// Coba muat font itu secara langsung
const muat = await page.evaluate(async () => {
  try {
    const f = new FontFace("Material Symbols Outlined",
      "url(/fonts/material-symbols-subset.woff2)", { weight: "500" });
    await f.load();
    return "berhasil dimuat, family=" + f.family;
  } catch (e) {
    return "GAGAL: " + (e && e.message ? e.message : String(e));
  }
});
console.log("\npemuatan langsung: " + muat);

await browser.close();