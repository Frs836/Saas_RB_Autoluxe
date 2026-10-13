import { test } from "@playwright/test";

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const TOKEN = "93ea6604439c4d899a0a1b0af6952aa31b363f7eae774875";

test("foto Cloudinary tampil di halaman lacak", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto(`${BASE}/track/${TOKEN}`, {
    waitUntil: "domcontentloaded",
    timeout: 60_000,
  });
  await page.waitForTimeout(4500);

  const gambar = await page.evaluate(() =>
    Array.from(document.querySelectorAll("img")).map((i) => ({
      src: i.getAttribute("src")?.slice(0, 70),
      w: i.naturalWidth,
      h: i.naturalHeight,
    })),
  );
  console.log("gambar:", JSON.stringify(gambar));

  const teks = await page.evaluate(() => {
    const m = document.querySelector("main") ?? document.body;
    const c = m.cloneNode(true) as HTMLElement;
    c.querySelectorAll("script,style").forEach((n) => n.remove());
    return (c.textContent ?? "").replace(/\s+/g, " ");
  });

  console.log("ada pesan gagal:", /Foto belum dapat dimuat|broken_image/.test(teks));
  console.log("ada bagian foto:", /Dokumentasi Foto/.test(teks));
  console.log("ada catatan inspeksi:", /Lapisan|Kursi Etern|Bodi|Motor/.test(teks));
});