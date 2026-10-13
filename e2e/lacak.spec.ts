import { test } from "@playwright/test";

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3000";

/** Teks yang benar-benar dilihat pengguna, bukan payload skrip. */
const visibleText = async (page: import("@playwright/test").Page) =>
  page.evaluate(() => {
    const root = document.querySelector("main") ?? document.body;
    const clone = root.cloneNode(true) as HTMLElement;
    clone.querySelectorAll("script, style, noscript").forEach((n) => n.remove());
    return (clone.textContent ?? "").replace(/\s+/g, " ").trim();
  });

test.describe("Galeri dan pesan galat lacak", () => {
  test("order yang punya inspeksi menampilkan galeri", async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto(`${BASE}/track/216ba76729c04a728945e9f9949e3e0f529cd9f6e71341de`, {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });
    await page.waitForTimeout(4000);

    console.log("teks terlihat:", (await visibleText(page)).slice(0, 700));
    console.log("jumlah img:", await page.locator("img").count());

    const rusak = await page.evaluate(() =>
      Array.from(document.querySelectorAll("img")).map((img) => ({
        src: img.getAttribute("src")?.slice(0, 90),
        lebar: img.naturalWidth,
        tinggi: img.naturalHeight,
      })),
    );
    console.log("detail gambar:", JSON.stringify(rusak, null, 1));
    await page.screenshot({ path: "test-results/track-galeri.png", fullPage: true });
  });

  test("token salah: apa yang dilihat pengguna", async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto(`${BASE}/track/token-palsu-xyz`, {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });
    await page.waitForTimeout(4000);

    const teks = await visibleText(page);
    console.log("path:", new URL(page.url()).pathname);
    console.log("panjang teks terlihat:", teks.length);
    console.log("teks:", JSON.stringify(teks.slice(0, 500)));
    console.log("ada tombol kembali:", await page.locator("a,button").count());
    await page.screenshot({ path: "test-results/track-tokensalah-teks.png", fullPage: true });
  });
});