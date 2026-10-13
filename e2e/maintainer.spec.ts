import { test } from "@playwright/test";
import {
  currentPath,
  hasText,
  login,
  softAssert,
  visibleMessages,
} from "./helpers";

/**
 * Audit alur maintainer dan owner: branch switcher, verifikasi wajah, stok
 * masuk, opname bulanan, persetujuan QC, dan keputusan pengajuan izin.
 */
test.describe("Maintainer dan Owner", () => {
  test("branch switcher tampil dan dapat diganti", async ({ page }) => {
    await softAssert(page, "login maintainer", async () => {
      await login(page, "maintainer");
    });
    console.log("[switcher] path =", await currentPath(page));

    const switcherButton = page
      .locator('button:has-text("Seluruh Cabang"), button:has-text("RB AUTOLUXE"), button:has-text("Cabang")')
      .first();
    const visible = await switcherButton.isVisible().catch(() => false);
    console.log("[switcher] tombol cabang terlihat:", visible);

    if (visible) {
      await switcherButton.click();
      await page.waitForTimeout(700);
      console.log(
        "[switcher] opsi Setelah dibuka:",
        await page.locator('text=Seluruh Cabang').count(),
      );
      console.log("[switcher] pesan:", JSON.stringify(await visibleMessages(page)));
    }
  });

  test("verifikasi wajah master: daftar dan kontrol", async ({ page }) => {
    await login(page, "maintainer");
    await page.goto("/pengaturan/wajah", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(900);

    console.log("[wajah] judul:", (await page.title()) ?? "");
    console.log("[wajah] pesan:", JSON.stringify(await visibleMessages(page)));

    const setujui = page.locator('button:has-text("Setujui")');
    const tolak = page.locator('button:has-text("Tolak")');
    console.log("[wajah] tombol setujui:", await setujui.count());
    console.log("[wajah] tombol tolak:", await tolak.count());

    if ((await tolak.count()) > 0) {
      // Coba tolak tanpa alasan untuk melihat validasi.
      await tolak.first().click();
      await page.waitForTimeout(700);
      console.log(
        "[wajah] pesan tolak tanpa alasan:",
        JSON.stringify(await visibleMessages(page)),
      );
    }
  });

  test("stok masuk: formulir supplier", async ({ page }) => {
    await login(page, "maintainer");
    await page.goto("/stok", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(900);

    console.log(
      "[stok] tombol stok masuk tersedia:",
      await page.locator('text=Catat stok masuk').count(),
    );

    const open = page.locator('button:has-text("Catat stok masuk")').first();
    if ((await open.count()) > 0) {
      await open.click();
      await page.waitForTimeout(600);
      console.log(
        "[stok] pemilih barang muncul:",
        await page.locator('select:has-text("Pilih barang")').count(),
      );
      console.log(
        "[stok] kolom harga beli tersedia:",
        await page.locator('text=Harga beli').count(),
      );
    }
    console.log("[stok] pesan:", JSON.stringify(await visibleMessages(page)));
  });

  test("opname bulanan: buka periode", async ({ page }) => {
    await login(page, "maintainer");
    await page.goto("/stok/opname", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(900);

    console.log("[opname] judul:", (await page.title()) ?? "");
    console.log(
      "[opname] pemilih bulan tersedia:",
      await page.locator('input[type="month"]').count(),
    );
    console.log(
      "[opname] tombol buka opname:",
      await page.locator('button:has-text("Buka atau Lanjutkan")').count(),
    );
    console.log("[opname] pesan:", JSON.stringify(await visibleMessages(page)));
  });

  test("reanotasi izin: keputusan pengajuan", async ({ page }) => {
    await login(page, "maintainer");
    await page.goto("/izin", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(900);

    console.log("[izin-mgr] tombol setujui:", await page.locator('button:has-text("Setujui")').count());
    console.log("[izin-mgr] tombol tolak:", await page.locator('button:has-text("Tolak")').count());
    console.log("[izin-mgr] pesan:", JSON.stringify(await visibleMessages(page)));
  });

  test("laporan: cakupan cabang dan ekspor", async ({ page }) => {
    await login(page, "owner");
    await page.goto("/laporan", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1100);

    console.log("[laporan] judul:", (await page.title()) ?? "");
    console.log(
      "[laporan] tombol ekspor:",
      await page.locator('button:has-text("Ekspor"), button:has-text("Unduh"), button:has-text("Excel")').count(),
    );
    console.log("[laporan] pesan:", JSON.stringify(await visibleMessages(page)));
  });

  test("rekap absensi: kolom alasan terlambat", async ({ page }) => {
    await login(page, "maintainer");
    await page.goto("/rekap", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1100);

    console.log("[rekap] judul:", (await page.title()) ?? "");
    console.log(
      "[rekap] label geofence lintas cabang:",
      await hasText(page, "Geofence mengikuti cabang tiap staf"),
    );
    console.log(
      "[rekap] tombol laporan CSV:",
      await page.locator('button:has-text("Laporan")').count(),
    );
    console.log("[rekap] pesan:", JSON.stringify(await visibleMessages(page)));
  });
});