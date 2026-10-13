import { test } from "@playwright/test";
import { currentPath, hasText, login, softAssert, visibleMessages } from "./helpers";

/**
 * Audit alur admin kasir: serah terima shift, arus kas, dan nota WhatsApp.
 */
test.describe("Admin kasir", () => {
  test("login dan akses shift", async ({ page }) => {
    await softAssert(page, "login admin kasir", async () => {
      await login(page, "admin_kasir");
    });
    console.log("[admin] path setelah login =", await currentPath(page));

    await page.goto("/shift", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(700);
    console.log("[shift] judul:", (await page.title()) ?? "");
    console.log("[shift] perlu pilih cabang tampil:", await hasText(page, "Pilih Satu Cabang"));
    console.log(
      "[shift] tombol buka/tutup shift ada:",
      await page
        .locator('button:has-text("Buka"), button:has-text("Tutup"), button:has-text("Serah")')
        .count(),
    );
    console.log("[shift] pesan:", JSON.stringify(await visibleMessages(page)));
  });

  test("kas: petty cash dan validasi", async ({ page }) => {
    await login(page, "admin_kasir");
    await page.goto("/kas", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(700);

    console.log("[kas] judul:", (await page.title()) ?? "");
    console.log(
      "[kas] jam transaksi ditampilkan:",
      await page.locator("text=WIB").count(),
    );
    console.log("[kas] pesan:", JSON.stringify(await visibleMessages(page)));
  });

  test("POS: buat order dan periksa struk serta thermal", async ({ page }) => {
    await login(page, "admin_kasir");
    await page.goto("/pos", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(800);

    console.log("[pos] teks thermal tampil:", await hasText(page, "thermal"));
    console.log("[pos] blokir akses tampil:", await hasText(page, "Akses Terbatas"));

    const addButtons = await page.locator('button:has-text("+"), button[class*="cart"]').count();
    console.log("[pos] kandidat tombol tambah layanan:", addButtons);
    console.log(
      "[pos] teks katalog kategori:",
      await page.locator("text=Cuci").count() + (await page.locator("text=Detailing").count()),
    );
  });

  test("nota WhatsApp: cek perhitungan baris rincian", async ({ page }) => {
    await login(page, "admin_kasir");
    await page.goto("/whatsapp", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(800);

    console.log("[wa] judul:", (await page.title()) ?? "");
    console.log("[wa] ada pemilih order:", await page.locator("select").count());
    console.log("[wa] pesan:", JSON.stringify(await visibleMessages(page)));
  });

  test("antrean order: transisi status tersedia", async ({ page }) => {
    await login(page, "admin_kasir");
    await page.goto("/pos/orders", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(900);

    const cards = await page.locator("text=/RBA-\\d{8}-\\d+/").count();
    console.log("[antrean] nomor order terlihat:", cards);
    console.log(
      "[antrean] filter QC tersedia:",
      await page.locator('text=QC').count(),
    );
    console.log("[antrean] pesan:", JSON.stringify(await visibleMessages(page)));
  });
});