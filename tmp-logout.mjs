import { chromium } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const BASE = process.env.BASE_URL || "http://localhost:3100";
const AKUN = JSON.parse(
  readFileSync(join(process.cwd(), "dev-users.json"), "utf8").replace(/^\uFEFF/, ""),
).roles;
const cari = AKUN.find((a) => a.role === "karyawan");

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();

const jejak = [];
page.on("response", (r) => {
  if (r.request().resourceType() === "document" || r.url().includes("signout")) {
    jejak.push(`${r.request().method()} ${r.status()} ${r.url().replace(BASE, "")}`);
  }
});

await page.goto(BASE + "/login", { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForSelector('input[type="email"]', { timeout: 30000 });
await page.fill('input[type="email"]', cari.email);
await page.fill('input[type="password"]', cari.password);
await page.waitForTimeout(2500);
await page.click('button[type="submit"]');
for (let i = 0; i < 50; i += 1) {
  const c = await ctx.cookies();
  if (c.some((x) => x.name.includes("auth-token"))) break;
  await page.waitForTimeout(400);
}
console.log("login ok, url = " + new URL(page.url()).pathname);

// Cari tombol keluar
const tombol = await page.locator('form[action="/auth/signout"] button').first();
console.log("tombol keluar ditemukan: " + (await tombol.count() > 0));
if (await tombol.count() > 0) {
  const teks = await tombol.textContent();
  console.log("teks tombol: " + JSON.stringify(teks));
}

jejak.length = 0;
await page.locator('form[action="/auth/signout"] button').first().click().catch((e) => console.log("klik gagal: " + e.message.slice(0, 80)));
await page.waitForTimeout(4000);

console.log("\nrespons selama keluar:");
jejak.forEach((j) => console.log("  " + j));
console.log("\nurl setelah keluar: " + page.url().replace(BASE, ""));
const bodyTeks = (await page.textContent("body").catch(() => "")).replace(/\s+/g, " ").slice(0, 160);
console.log("isi halaman: " + bodyTeks);

const masihLogin = (await ctx.cookies()).some((c) => c.name.includes("auth-token"));
console.log("cookie sesi masih ada: " + masihLogin);

await browser.close();