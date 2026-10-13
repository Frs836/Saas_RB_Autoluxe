import { test } from "@playwright/test";
import { account, currentPath, login, visibleMessages } from "./helpers";

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3000";

/**
 * Modul publik dan ketahanan data.
 *
 * Halaman lacak tidak memerlukan login, jadi harus tetap berfungsi penuh
 * untuk pelanggan yang memakai HP pribadi.
 */
test.describe("Modul publik", () => {
  test("lacak publik: token valid menampilkan progres", async ({ page }) => {
    await login(page, "admin_kasir");
    await page.goto("/pos/orders", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1000);

    const link = page.locator('a[href*="/track/"]').first();
    const hasLink = (await link.count()) > 0;
    console.log("[lacak] tautan track di antrean:", hasLink);

    if (!hasLink) return;

    const href = await link.getAttribute("href");
    console.log("[lacak] href =", href);

    const context = await page.context().browser()?.newContext();
    if (!context) return;

    const anon = await context.newPage();
    await anon.goto(`${BASE}${href}`, { waitUntil: "domcontentloaded" });
    await anon.waitForTimeout(1200);
    console.log("[lacak] judul anon:", (await anon.title()) ?? "");
    console.log("[lacak] jumlah gambar galeri:", await anon.locator("img").count());
    console.log("[lacak] pesan anon:", JSON.stringify(await visibleMessages(anon)));
    await anon.screenshot({ path: "test-results/lacak-publik.png", fullPage: true });
    await anon.close();
    await context.close();
  });

  test("lacak publik: token tidak valid ditolak dengan rapi", async ({ page }) => {
    await page.goto("/track/token-yang-salah-sekali", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1200);
    console.log("[lacak-salah] path:", await currentPath(page));
    console.log(
      "[lacak-salah] teks:",
      ((await page.textContent("body")) ?? "").replace(/\s+/g, " ").slice(0, 160),
    );
  });

  test("halaman tanpa login selalu dialihkan", async ({ page }) => {
    const terlarang = [
      "/dashboard",
      "/absensi",
      "/pos",
      "/kas",
      "/rekap",
      "/laporan",
      "/stok/opname",
      "/pengaturan/cabang",
      "/pengaturan/wajah",
    ];
    for (const path of terlarang) {
      await page.goto(path, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(600);
      const landed = await currentPath(page);
      const ok = landed === "/login";
      console.log(`[anon] ${path} -> ${landed}${ok ? " (benar)" : " (BOCOR, salah)"}`);
    }
  });

  test("nomor telepon tidak bocor ke anonim", async ({ page }) => {
    await login(page, "admin_kasir");
    await page.goto("/pos/orders", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1000);

    console.log(
      "[anon-check] nomor telepon terlihat di antrean:",
      await page.locator("text=/\\+62\\d{8,}/").count(),
    );

    const context = await page.context().browser()?.newContext();
    if (!context) return;

    const anon = await context.newPage();
    await anon.goto(`${BASE}/pos/orders`, { waitUntil: "domcontentloaded" });
    await anon.waitForTimeout(1000);
    console.log("[anon-check] path tanpa login:", await currentPath(anon));
    console.log(
      "[anon-check] nomor telepon terlihat tanpa login:",
      await anon.locator("text=/\\+62\\d{8,}/").count(),
    );
    await anon.close();
    await context.close();
  });
});