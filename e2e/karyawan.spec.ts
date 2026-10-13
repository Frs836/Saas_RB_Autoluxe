import { test } from "@playwright/test";
import {
  currentPath,
  grantMediaAndGeo,
  hasText,
  login,
  setGeolocation,
  softAssert,
  visibleMessages,
} from "./helpers";

/**
 * Audit alur karyawan.
 *
 * Karyawan adalah satu-satunya peran yang punya sebagian besar batasan
 * keamanan di aplikasi ini, sehingga diuji paling teliti.
 */
test.describe("Karyawan", () => {
  test("login dan arahkan ke beranda", async ({ page }) => {
    await softAssert(page, "login karyawan", async () => {
      await login(page, "karyawan");
    });

    const path = await currentPath(page);
    console.log(`[karyawan] path setelah login = ${path}`);
    console.log(
      `[karyawan] pesan di halaman = ${JSON.stringify(await visibleMessages(page))}`,
    );
  });

  test("absensi: verifikasi wajah menjadi gerbang sebelum geofence", async ({ page }) => {
    await grantMediaAndGeo(page);
    await setGeolocation(page);
    await login(page, "karyawan");
    await page.goto("/absensi", { waitUntil: "domcontentloaded" });

    const registerVisible = await hasText(page, "Daftarkan Face ID");
    const pendingVisible = await hasText(page, "menunggu verifikasi");
    const rejectedVisible = await hasText(page, "ditolak maintainer");

    console.log("[absensi] tombol daftarkan Face ID terlihat:", registerVisible);
    console.log("[absensi] status menunggu verifikasi tampil:", pendingVisible);
    console.log("[absensi] status ditolak tampil:", rejectedVisible);
    console.log("[absensi] pesan:", JSON.stringify(await visibleMessages(page)));

    const canCheckIn = await page
      .locator('button:has-text("Check In"), button:has-text("Absen")')
      .first()
      .isVisible()
      .catch(() => false);
    console.log("[absensi] tombol check-in terlihat:", canCheckIn);
  });

  test("pengajuan izin: isi alasan lalu periksa status tombol kirim", async ({ page }) => {
    await login(page, "karyawan");
    await page.goto("/izin", { waitUntil: "domcontentloaded" });

    console.log("[izin] judul halaman:", (await page.title()) ?? "");

    const reasonBox = page
      .locator('textarea, input[placeholder*="alasan" i]')
      .first();
    const hasReason = await reasonBox.isVisible().catch(() => false);
    console.log("[izin] kolom alasan tersedia:", hasReason);

    if (hasReason) {
      await reasonBox.fill("Kondisi keluarga yang memerlukan perhatian segera.");
      await page.waitForTimeout(500);
      console.log(
        "[izin] pesan validasi setelah mengisi alasan:",
        JSON.stringify(await visibleMessages(page)),
      );

      const submit = page
        .locator('button:has-text("Kirim"), button:has-text("Ajukan")')
        .last();
      const disabled = await submit.isDisabled().catch(() => null);
      console.log("[izin] tombol kirim nonaktif?", disabled);
      console.log(
        "[izin] enabled berarti siap dikirim, nonaktif berarti masih ada syarat unmet",
      );
    }
  });

  test("kas titipan: karyawan melihat kendalanya di POS", async ({ page }) => {
    await login(page, "karyawan");
    await page.goto("/pos", { waitUntil: "domcontentloaded" });

    console.log("[pos] teks kas titipan tampil:", await hasText(page, "titipan"));
    console.log(
      "[pos] blokir akses pembuatan tampil:",
      await hasText(page, "Akses Terbatas"),
    );
    console.log(
      "[pos] kontrol thermal tampil, seharusnya false untuk karyawan:",
      await hasText(page, "thermal"),
    );
  });

  test("halaman terlarang tetap terlarang", async ({ page }) => {
    await login(page, "karyawan");

    const forbidden = ["/kas", "/laporan", "/pengaturan/cabang", "/stok/opname"];
    for (const path of forbidden) {
      await page.goto(path, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(700);
      const landed = await currentPath(page);
      const blocked = landed !== path;
      console.log(
        `[guard] ${path} -> ${landed}${blocked ? " (diarahkan, benar)" : " (BOLEH MASUK, salah)"}`,
      );
    }
  });

  test("berpindah halaman berulang: apakah pesan galat muncul", async ({ page }) => {
    await login(page, "karyawan");
    const sequence = ["/dashboard", "/absensi", "/pos/orders", "/dashboard", "/absensi"];
    for (const path of sequence) {
      await page.goto(path, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(500);
      console.log(`[navigasi] ${path} pesan = ${JSON.stringify(await visibleMessages(page))}`);
    }
  });
});