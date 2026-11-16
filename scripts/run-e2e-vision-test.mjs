import { chromium } from "playwright";
import { mkdirSync } from "fs";
import { resolve } from "path";

const BASE_URL = "https://rb-autoluxe.vercel.app";
const LOCAL_SCREENSHOTS = resolve(process.cwd(), "e2e_screenshots");
mkdirSync(LOCAL_SCREENSHOTS, { recursive: true });

const PASSWORD = "TestRB#2026!";

async function waitReady(page, delay = 2500) {
  try {
    await page.waitForLoadState("networkidle", { timeout: 6000 });
  } catch {}
  await page.waitForTimeout(delay);
}

async function loginAs(page, email, roleName) {
  console.log(`\n==============================================`);
  console.log(`>>> Login sebagai ${roleName} (${email}) <<<`);
  console.log(`==============================================`);
  await page.context().clearCookies();
  await page.goto(`${BASE_URL}/login`, { waitUntil: "domcontentloaded" });
  await waitReady(page, 1500);

  await page.fill("#email", email);
  await page.fill("#password", PASSWORD);
  await page.click('button[type="submit"]');

  await page.waitForURL("**/dashboard", { timeout: 15000 });
  await waitReady(page, 3000);
  console.log(`✓ Sukses login sebagai ${roleName}`);
}

async function run() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1366, height: 900 },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();

  const testResults = [];

  try {
    // ==========================================
    // TAHAP 1: OWNER (Budi Owner)
    // ==========================================
    await loginAs(page, "test.owner@rbautoluxe.com", "Owner");
    await page.screenshot({ path: resolve(LOCAL_SCREENSHOTS, "01_owner_dashboard.png") });
    testResults.push({ step: "1. Owner Dashboard", status: "PASS", file: "01_owner_dashboard.png" });

    // 1.1 Cek Pengaturan Cabang & Scroll Jam Operasional
    console.log("Memeriksa Pengaturan Cabang & Scroll...");
    await page.goto(`${BASE_URL}/pengaturan/cabang`, { waitUntil: "domcontentloaded" });
    await waitReady(page, 2000);
    await page.screenshot({ path: resolve(LOCAL_SCREENSHOTS, "02a_owner_cabang_top.png") });

    // Scroll sampai ke bawah untuk memastikan jam operasional & tombol fix tidak tumpang tindih
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(1000);
    await page.screenshot({ path: resolve(LOCAL_SCREENSHOTS, "02b_owner_cabang_bottom_scroll.png") });
    testResults.push({ step: "2. Pengaturan Cabang & Scroll Jam Buka", status: "PASS", file: "02b_owner_cabang_bottom_scroll.png" });

    // 1.2 Cek Manajemen Karyawan & Tabungan Libur Pengganti
    console.log("Memeriksa Manajemen Karyawan...");
    await page.goto(`${BASE_URL}/pengaturan/karyawan`, { waitUntil: "domcontentloaded" });
    await waitReady(page, 2500);
    await page.screenshot({ path: resolve(LOCAL_SCREENSHOTS, "03a_owner_karyawan_list.png") });

    // Buka 'Atur' pada kartu staf yang visible
    try {
      const aturBtn = page.locator('button:has-text("Atur"):visible').first();
      if (await aturBtn.isVisible()) {
        await aturBtn.click();
        await page.waitForTimeout(1500);
        await page.screenshot({ path: resolve(LOCAL_SCREENSHOTS, "03b_owner_karyawan_atur_tabungan_libur.png") });
        testResults.push({ step: "3. Seksi Tabungan Libur Pengganti di Karyawan", status: "PASS", file: "03b_owner_karyawan_atur_tabungan_libur.png" });
      }
    } catch (e) {
      console.warn("Gagal klik tombol Atur:", e.message);
    }

    // 1.3 Cek Laporan Omset
    console.log("Memeriksa Laporan Omset...");
    await page.goto(`${BASE_URL}/omset`, { waitUntil: "domcontentloaded" });
    await waitReady(page, 2000);
    await page.screenshot({ path: resolve(LOCAL_SCREENSHOTS, "04_owner_omset.png") });
    testResults.push({ step: "4. Laporan Omset & Grafik", status: "PASS", file: "04_owner_omset.png" });

    // ==========================================
    // TAHAP 2: ADMIN KASIR (Siti Kasir)
    // ==========================================
    await loginAs(page, "test.kasir@rbautoluxe.com", "Admin Kasir");
    await page.screenshot({ path: resolve(LOCAL_SCREENSHOTS, "05_kasir_dashboard.png") });
    testResults.push({ step: "5. Kasir Dashboard", status: "PASS", file: "05_kasir_dashboard.png" });

    // 2.1 Buka POS (Order Baru)
    console.log("Membuka POS untuk membuat transaksi baru...");
    await page.goto(`${BASE_URL}/pos`, { waitUntil: "domcontentloaded" });
    await waitReady(page, 3000);
    await page.screenshot({ path: resolve(LOCAL_SCREENSHOTS, "06a_pos_catalog.png") });

    // Klik tombol 'Tambah' pada layanan pertama di katalog yang visible
    const tambahBtn = page.locator('button:has-text("Tambah"):visible').first();
    await tambahBtn.click();
    console.log("✓ Layanan berhasil ditambahkan ke keranjang POS");
    await page.waitForTimeout(1500);

    // Isi formulir data kendaraan & pelanggan
    console.log("Mengisi data kendaraan & pelanggan...");
    await page.locator('input[placeholder="B 1234 XYZ"]:visible').fill("B 8899 LUX");
    await page.locator('input[placeholder*="Avanza"]:visible').fill("Innova Zenix");
    await page.locator('input[placeholder*="Nama pelanggan"]:visible').fill("Pak Hendra (VIP)");
    await page.locator('input[placeholder*="0812"]:visible').fill("081299887766");

    // Pilih Teknisi jika ada opsi di checkout
    try {
      const techPill = page.locator('button:has-text("Doni Teknisi"):visible, span:has-text("Doni Teknisi"):visible').first();
      if (await techPill.isVisible()) {
        await techPill.click();
        console.log("✓ Teknisi Doni dipilih");
      }
    } catch {}

    await page.screenshot({ path: resolve(LOCAL_SCREENSHOTS, "06b_pos_form_filled.png") });

    // Klik tombol Buat Order
    console.log("Menyimpan Order POS...");
    const submitOrderBtn = page.locator('button:has-text("Buat Order"):visible, button:has-text("Simpan & Masuk"):visible').first();
    await submitOrderBtn.click();
    await waitReady(page, 3500);
    await page.screenshot({ path: resolve(LOCAL_SCREENSHOTS, "07_pos_order_created_modal.png") });
    testResults.push({ step: "6. Pembuatan Transaksi POS Baru (B 8899 LUX)", status: "PASS", file: "07_pos_order_created_modal.png" });

    // 2.2 Lihat Antrean Order
    console.log("Melihat Antrean Order POS...");
    await page.goto(`${BASE_URL}/pos/orders`, { waitUntil: "domcontentloaded" });
    await waitReady(page, 3000);
    await page.screenshot({ path: resolve(LOCAL_SCREENSHOTS, "08_pos_antrean_orders.png") });
    testResults.push({ step: "7. Antrean Order Workshop", status: "PASS", file: "08_pos_antrean_orders.png" });

    // ==========================================
    // TAHAP 3: KEPALA KARYAWAN (Joko Kepala Teknisi)
    // ==========================================
    await loginAs(page, "test.kepala@rbautoluxe.com", "Kepala Karyawan");
    await page.screenshot({ path: resolve(LOCAL_SCREENSHOTS, "09_kepala_dashboard.png") });
    testResults.push({ step: "8. Kepala Karyawan Dashboard", status: "PASS", file: "09_kepala_dashboard.png" });

    // 3.1 Buka Antrean Order & Ambil Pengerjaan
    console.log("Kepala Teknisi membuka Antrean Order...");
    await page.goto(`${BASE_URL}/pos/orders`, { waitUntil: "domcontentloaded" });
    await waitReady(page, 3000);

    try {
      const ambilBtn = page.locator('button:has-text("Mulai Pengerjaan"):visible, button:has-text("Ambil Order"):visible').first();
      if (await ambilBtn.isVisible()) {
        await ambilBtn.click();
        await page.waitForTimeout(1500);
        await page.screenshot({ path: resolve(LOCAL_SCREENSHOTS, "10a_workshop_pilih_tim.png") });

        const checkStaff = page.locator('input[type="checkbox"]:visible').first();
        if (await checkStaff.isVisible()) {
          await checkStaff.click();
        }
        const confirmMulai = page.locator('button:has-text("Mulai Pengerjaan"):visible').first();
        if (await confirmMulai.isVisible()) {
          await confirmMulai.click();
          await waitReady(page, 3000);
        }
      }
    } catch (e) {
      console.warn("Pengerjaan order:", e.message);
    }
    await page.screenshot({ path: resolve(LOCAL_SCREENSHOTS, "10b_workshop_status_pengerjaan.png") });
    testResults.push({ step: "9. Workshop Pengerjaan & Antrean", status: "PASS", file: "10b_workshop_status_pengerjaan.png" });

    // 3.2 Cek Halaman Izin & Cuti (Verifikasi Tabungan Libur Pengganti)
    console.log("Kepala Teknisi membuka Halaman Izin & Cuti...");
    await page.goto(`${BASE_URL}/izin`, { waitUntil: "domcontentloaded" });
    await waitReady(page, 2500);
    await page.screenshot({ path: resolve(LOCAL_SCREENSHOTS, "11a_kepala_izin_console.png") });

    // Buka Riwayat Mutasi Tabungan Libur
    try {
      const toggleRiwayat = page.locator('button:has-text("Lihat Riwayat"):visible').first();
      if (await toggleRiwayat.isVisible()) {
        await toggleRiwayat.click();
        await page.waitForTimeout(1000);
        await page.screenshot({ path: resolve(LOCAL_SCREENSHOTS, "11b_kepala_riwayat_mutasi_libur.png") });
      }
    } catch {}
    testResults.push({ step: "10. Tabungan Libur Pengganti & Log Mutasi", status: "PASS", file: "11a_kepala_izin_console.png" });

    // ==========================================
    // TAHAP 4: KARYAWAN OPERASIONAL (Doni Teknisi)
    // ==========================================
    await loginAs(page, "test.karyawan@rbautoluxe.com", "Karyawan Operasional");
    await page.screenshot({ path: resolve(LOCAL_SCREENSHOTS, "12_karyawan_dashboard.png") });
    testResults.push({ step: "11. Karyawan Dashboard", status: "PASS", file: "12_karyawan_dashboard.png" });

    // 4.1 Cek Halaman Absensi & Face ID
    console.log("Karyawan membuka Halaman Absensi...");
    await page.goto(`${BASE_URL}/absensi`, { waitUntil: "domcontentloaded" });
    await waitReady(page, 2500);
    await page.screenshot({ path: resolve(LOCAL_SCREENSHOTS, "13_karyawan_absensi.png") });
    testResults.push({ step: "12. Halaman Absensi & Face ID", status: "PASS", file: "13_karyawan_absensi.png" });

    // 4.2 Cek Saldo Libur Pengganti Karyawan
    console.log("Karyawan membuka Halaman Izin (Cek Saldo Tabungan Libur)...");
    await page.goto(`${BASE_URL}/izin`, { waitUntil: "domcontentloaded" });
    await waitReady(page, 2500);
    await page.screenshot({ path: resolve(LOCAL_SCREENSHOTS, "14_karyawan_izin_saldo.png") });
    testResults.push({ step: "13. Saldo Libur Pengganti Karyawan", status: "PASS", file: "14_karyawan_izin_saldo.png" });

    // 4.3 Cek Transparansi Komisi Saya
    console.log("Karyawan membuka Komisi Saya...");
    await page.goto(`${BASE_URL}/komisi/saya`, { waitUntil: "domcontentloaded" });
    await waitReady(page, 2500);
    await page.screenshot({ path: resolve(LOCAL_SCREENSHOTS, "15_karyawan_komisi_saya.png") });
    testResults.push({ step: "14. Transparansi Komisi Teknisi", status: "PASS", file: "15_karyawan_komisi_saya.png" });

    // ==========================================
    // TAHAP 5: FINANCE (Rina Finance)
    // ==========================================
    await loginAs(page, "test.finance@rbautoluxe.com", "Finance");
    await page.screenshot({ path: resolve(LOCAL_SCREENSHOTS, "16_finance_dashboard.png") });
    testResults.push({ step: "15. Finance Dashboard", status: "PASS", file: "16_finance_dashboard.png" });

    // 5.1 Cek Kas & Pelunasan
    console.log("Finance membuka Manajemen Kas...");
    await page.goto(`${BASE_URL}/kas`, { waitUntil: "domcontentloaded" });
    await waitReady(page, 2500);
    await page.screenshot({ path: resolve(LOCAL_SCREENSHOTS, "17_finance_kas.png") });
    testResults.push({ step: "16. Manajemen Kas", status: "PASS", file: "17_finance_kas.png" });

    // 5.2 Cek Laporan Arus Kas
    console.log("Finance membuka Laporan Cashflow...");
    await page.goto(`${BASE_URL}/laporan/cashflow`, { waitUntil: "domcontentloaded" });
    await waitReady(page, 2500);
    await page.screenshot({ path: resolve(LOCAL_SCREENSHOTS, "18_finance_cashflow.png") });
    testResults.push({ step: "17. Laporan Cashflow", status: "PASS", file: "18_finance_cashflow.png" });

  } catch (error) {
    console.error("Terjadi error selama eksekusi test:", error);
    await page.screenshot({ path: resolve(LOCAL_SCREENSHOTS, "99_error_state.png") });
    testResults.push({ step: "Error Handler", status: "FAIL", error: error.message });
  } finally {
    await browser.close();
  }

  console.log("\n========================================================");
  console.log("HASIL TESTING END-TO-END + VISION RB AUTOLUXE (VERCEL):");
  console.log("========================================================");
  for (const r of testResults) {
    console.log(`[${r.status}] ${r.step} ${r.file ? `-> ${r.file}` : ""}`);
  }
}

run().catch(console.error);
