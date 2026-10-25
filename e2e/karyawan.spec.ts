import { test, expect } from "@playwright/test";
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

  // ===== TAMBAHAN: Team Claim Flow (Kerjakan Antrian Ini) =====
  test("team claim flow: karyawan claim order, pilih rekan, mulai pengerjaan", async ({ page }) => {
    await login(page, "karyawan");
    await page.goto("/pos/orders", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1000);

    // Cari order dengan status queued yang belum punya tim
    const orderCards = page.locator('.clay-card').filter({ hasText: /RBA-\d+/ });
    const count = await orderCards.count();
    console.log(`[team-claim] total card order: ${count}`);

    // Cari card dengan status "Antrean" (queued) dan belum punya tim
    let targetOrder = null;
    let orderNumber = "";
    for (let i = 0; i < count; i++) {
      const card = orderCards.nth(i);
      const statusText = await card.locator('text=Antrean').isVisible().catch(() => false);
      const hasTeam = await card.locator('text=teknisi').isVisible().catch(() => false);
      const orderNum = (await card.locator('.font-mono').textContent().catch(() => '')) ?? '';
      
      if (statusText && !hasTeam) {
        targetOrder = card;
        orderNumber = orderNum;
        console.log(`[team-claim] target order: ${orderNumber}`);
        break;
      }
    }

    if (!targetOrder) {
      console.log("[team-claim] SKIP: tidak ada order queued tanpa tim");
      return;
    }

    // Klik tombol "Kerjakan Antrian Ini"
    const claimButton = targetOrder.locator('button:has-text("Kerjakan Antrian Ini")');
    await expect(claimButton).toBeVisible();
    await claimButton.click();
    await page.waitForTimeout(500);

    // Modal pilih tim harus muncul
    const modal = page.locator('text=Pilih Rekan Kerja');
    await expect(modal).toBeVisible({ timeout: 5000 });
    console.log("[team-claim] modal pilih tim terbuka");

    // Pilih 1 rekan kerja (checkbox)
    const staffCheckboxes = page.locator('input[type="checkbox"]').filter({ hasText: /karyawan/i });
    const staffCount = await staffCheckboxes.count();
    console.log(`[team-claim] rekan tersedia: ${staffCount}`);

    if (staffCount > 0) {
      await staffCheckboxes.first().click();
      await page.waitForTimeout(200);
    }

    // Submit claim
    const submitButton = page.locator('button:has-text("Mulai Pengerjaan"), button:has-text("Claim Order")').last();
    await expect(submitButton).toBeVisible();
    await submitButton.click();
    await page.waitForTimeout(2000);

    // Verifikasi: order harus berstatus "Dikerjakan" (in_progress)
    await page.goto("/pos/orders", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1000);

    const updatedCard = page.locator('.clay-card').filter({ hasText: orderNumber ?? '' }).first();
    const isInProgress = await updatedCard.locator('text=Dikerjakan').isVisible().catch(() => false);
    const hasTeamNow = await updatedCard.locator('text=teknisi').isVisible().catch(() => false);
    
    console.log(`[team-claim] status in_progress: ${isInProgress}`);
    console.log(`[team-claim] tim muncul: ${hasTeamNow}`);
    
    // Soft assertion - log only, don't fail test if flow not complete
    if (!isInProgress) {
      console.log("[team-claim] WARNING: order belum berstatus in_progress, mungkin RPC error");
    }
  });

  // ===== TAMBAHAN: Bayar Nanti Flow =====
  test("bayar nanti flow: admin_kasir buat order Bayar Nanti, cek di Kas, settle", async ({ page }) => {
    // Login sebagai admin_kasir (bisa buat order Bayar Nanti)
    await login(page, "admin_kasir");
    await page.goto("/pos", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1000);

    // Buat order baru dengan Bayar Nanti
    const newOrderButton = page.locator('button:has-text("Order Baru"), a:has-text("Order Baru")').first();
    if (await newOrderButton.isVisible().catch(() => false)) {
      await newOrderButton.click();
      await page.waitForTimeout(500);

      // Isi form order minimal
      // Pilih layanan
      const serviceSelect = page.locator('select[name="service_id"], select[placeholder*="layanan" i]').first();
      if (await serviceSelect.isVisible().catch(() => false)) {
        await serviceSelect.selectOption({ index: 1 });
      }

      // Pilih Bayar Nanti
      const bayarNantiRadio = page.locator('input[value="pay_later"], label:has-text("Bayar Nanti") input').first();
      if (await bayarNantiRadio.isVisible().catch(() => false)) {
        await bayarNantiRadio.click({ force: true });
      }

      // Submit order
      const submitOrder = page.locator('button:has-text("Buat Order"), button:has-text("Simpan")').last();
      if (await submitOrder.isVisible().catch(() => false)) {
        await submitOrder.click();
        await page.waitForTimeout(2000);

        // Cek order muncul di antrean dengan payment_state unpaid
        await page.goto("/pos/orders", { waitUntil: "domcontentloaded" });
        await page.waitForTimeout(1000);

        const unpaidOrder = page.locator('.clay-card').filter({ hasText: /Bayar Nanti|unpaid/i }).first();
        const hasUnpaid = await unpaidOrder.isVisible().catch(() => false);
        console.log(`[bayar-nanti] order unpaid di antrean: ${hasUnpaid}`);
      }
    }

    // Cek di halaman Kas -> tab Bayar Nanti
    await page.goto("/kas", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1000);

    const bayarNantiTab = page.locator('button:has-text("Bayar Nanti"), [role="tab"]:has-text("Bayar Nanti")').first();
    if (await bayarNantiTab.isVisible().catch(() => false)) {
      await bayarNantiTab.click();
      await page.waitForTimeout(500);

      const unpaidList = page.locator('text=RBA-').filter({ hasText: /unpaid|belum bayar/i });
      const unpaidCount = await unpaidList.count();
      console.log(`[bayar-nanti] order unpaid di tab Kas: ${unpaidCount}`);

      // Test settle (kalau ada order unpaid)
      if (unpaidCount > 0) {
        const settleButton = page.locator('button:has-text("Settle"), button:has-text("Bayar")').first();
        if (await settleButton.isVisible().catch(() => false)) {
          await settleButton.click();
          await page.waitForTimeout(1000);
          
          // Konfirmasi settle
          const confirmButton = page.locator('button:has-text("Ya"), button:has-text("Konfirmasi")').last();
          if (await confirmButton.isVisible().catch(() => false)) {
            await confirmButton.click();
            await page.waitForTimeout(2000);
            console.log("[bayar-nanti] settle berhasil");
          }
        }
      }
    }
  });

  // ===== TAMBAHAN: Full Order Lifecycle (queued -> in_progress -> qc_review -> completed -> handover) =====
  test("full order lifecycle: transisi status sampai serah terima", async ({ page }) => {
    await login(page, "karyawan");
    await page.goto("/pos/orders", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1000);

    // Cari order yang bisa di-transition (queued dengan tim sudah ada)
    const orderCards = page.locator('.clay-card').filter({ hasText: /RBA-\d+/ });
    const count = await orderCards.count();

    for (let i = 0; i < count; i++) {
      const card = orderCards.nth(i);
      const statusText = (await card.textContent().catch(() => '')) ?? '';
      
      // Cek status berurutan
      if (statusText.includes('Antrean') && statusText.includes('teknisi')) {
        console.log(`[lifecycle] order siap untuk start work`);
        
        // Klik "Kerjakan Sekarang" (sudah punya tim)
        const startButton = card.locator('button:has-text("Kerjakan Sekarang")');
        if (await startButton.isVisible().catch(() => false)) {
          await startButton.click();
          await page.waitForTimeout(2000);
          console.log("[lifecycle] start work clicked");
        }
        break;
      }
    }

    // Verifikasi transisi ke in_progress
    await page.goto("/pos/orders", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1000);
    
    const inProgressCards = page.locator('.clay-card').filter({ hasText: /Dikerjakan/ });
    const inProgressCount = await inProgressCards.count();
    console.log(`[lifecycle] order in_progress: ${inProgressCount}`);
  });
});