import { test, devices } from "@playwright/test";
import { account } from "./helpers";

/**
 * Audit layout mobile sesuai checklist antislop-layoutmobile.
 *
 * Pengukuran dilakukan secara terprogram, bukan dengan mata, supaya angka
 * overflow dan ukuran target bisa dibandingkan antar halaman.
 */

type Laporan = {
  path: string;
  role: string;
  overflowX: number;
  offenders: string[];
  targetKecil: string[];
  tertutupNav: string[];
};

const laporan: Laporan[] = [];

async function ukur(
  page: import("@playwright/test").Page,
  path: string,
  role: string,
): Promise<Laporan> {
  await page.goto(path, { waitUntil: "domcontentloaded", timeout: 90_000 });
  await page.waitForTimeout(2500);

  const hasil = await page.evaluate(() => {
    const lebarViewport = document.documentElement.clientWidth;

    // Elemen yang menjulur melewati viewport, kecuali yang memang boleh
    // bergulir sendiri secara horizontal.
    const offenders: string[] = [];
    document.querySelectorAll<HTMLElement>("body *").forEach((node) => {
      const rect = node.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      if (rect.right <= lebarViewport + 1 && rect.left >= -1) return;

      const gaya = getComputedStyle(node);
      const bolehGeser =
        gaya.overflowX === "auto" ||
        gaya.overflowX === "scroll" ||
        gaya.overflowX === "hidden";
      if (bolehGeser) return;

      const induk = node.parentElement;
      if ( induk && getComputedStyle(induk).overflowX !== "visible") return;

      offenders.push(
        `${node.tagName.toLowerCase()}.${String(node.className).slice(0, 60)} right=${Math.round(rect.right)}`,
      );
    });

    // Target interaktif yang lebih kecil dari 44px.
    const targetKecil: string[] = [];
    document
      .querySelectorAll<HTMLElement>("button, a[href], select, input[type='checkbox']")
      .forEach((node) => {
        const rect = node.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return;
        const label = `${node.tagName.toLowerCase()}: ${(node.textContent ?? node.getAttribute("aria-label") ?? "").trim().slice(0, 28)}`;
        if (rect.height < 44 || rect.width < 44) {
          targetKecil.push(`${label} (${Math.round(rect.width)}x${Math.round(rect.height)})`);
        }
      });

    return {
      overflowX: Math.max(0, document.documentElement.scrollWidth - lebarViewport),
      offenders: offenders.slice(0, 6),
      targetKecil: targetKecil.slice(0, 8),
    };
  });

  // Elemen yang tertutup navigasi bawah tetap.
  const tertutupNav = await page.evaluate(() => {
    const nav = document.querySelector("nav.fixed, div.fixed.bottom-0");
    if (!nav) return [] as string[];
    const navRect = nav.getBoundingClientRect();
    const terpotong: string[] = [];
    document.querySelectorAll<HTMLElement>("button, a[href], input, select").forEach((node) => {
      const rect = node.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      const diDalamNav = nav.contains(node);
      if (diDalamNav) return;
      // Elemen yang berakhir tepat di atas navbar aman; yang masuk ke area
      // navbar dan tidak punya ruang scroll penampung baru berarti tertutup.
      if (rect.bottom > navRect.top + 1 && rect.top < navRect.bottom) {
        terpotong.push((node.textContent ?? "").trim().slice(0, 30));
      }
    });
    return terpotong.slice(0, 5);
  });

  return {
    path,
    role,
    overflowX: hasil.overflowX,
    offenders: hasil.offenders,
    targetKecil: hasil.targetKecil,
    tertutupNav,
  };
}

async function masuk(page: import("@playwright/test").Page, role: string) {
  const user = account(role);

  // Permintaan auth pertama kadang lambat dan belum sempat selesai sebelum
  // cookie diperiksa. Dua percobaan cukup untuk membedakan kelambatan dari
  // kegagalan login sungguhan.
  for (let percobaan = 0; percobaan < 2; percobaan += 1) {
    await page.context().clearCookies();
    await page.goto("/login", { waitUntil: "domcontentloaded" });
    await page.fill('input[type="email"]', user.email);
    await page.fill('input[type="password"]', user.password);
    await page.click('button[type="submit"]');

    const mulai = Date.now();
    while (Date.now() - mulai < 30_000) {
      const cookies = await page.context().cookies();
      if (cookies.some((c) => c.name.includes("auth-token"))) return true;
      await page.waitForTimeout(400);
    }
    console.log(`[${role}] percobaan ${percobaan + 1} gagal, diulang sekali`);
  }
  return false;
}

const HALAMAN = [
  "/dashboard",
  "/absensi",
  "/pos",
  "/pos/orders",
  "/kas",
  "/stok",
  "/stok/opname",
  "/rekap",
  "/shift",
  "/garansi",
  "/izin",
  "/laporan",
  "/whatsapp",
  "/profil",
  "/pengaturan/cabang",
  "/pengaturan/wajah",
];

// Diletakkan di tingkat teratas, bukan di dalam describe, karena memakai
// device preset akan memaksa pekerja baru.
test.use({ ...devices["Pixel 7"] });

test.describe("Audit layout mobile", () => {
  test("ukur seluruh halaman pada karyawan", async ({ page }) => {
    test.setTimeout(900_000);
    if (!(await masuk(page, "karyawan"))) throw new Error("login karyawan gagal");

    for (const path of HALAMAN) {
      const row = await ukur(page, path, "karyawan");
      laporan.push(row);
      console.log(
        `[karyawan] ${path} overflowX=${row.overflowX} targetKecil=${row.targetKecil.length} tertutupNav=${row.tertutupNav.length}`,
      );
      for (const o of row.offenders) console.log(`    meluber: ${o}`);
      for (const t of row.targetKecil.slice(0, 4)) console.log(`    kecil: ${t}`);
      for (const t of row.tertutupNav) console.log(`    tertutup nav: ${t}`);
    }
  });

  test("ukur halaman khusus manajer", async ({ page }) => {
    test.setTimeout(900_000);
    if (!(await masuk(page, "maintainer"))) throw new Error("login maintainer gagal");

    for (const path of ["/kas", "/shift", "/rekap", "/laporan", "/stok/opname", "/pengaturan/wajah"]) {
      const row = await ukur(page, path, "maintainer");
      laporan.push(row);
      console.log(
        `[maintainer] ${path} overflowX=${row.overflowX} targetKecil=${row.targetKecil.length} tertutupNav=${row.tertutupNav.length}`,
      );
      for (const t of row.targetKecil.slice(0, 4)) console.log(`    kecil: ${t}`);
      for (const t of row.tertutupNav) console.log(`    tertutup nav: ${t}`);
    }
  });

  test("ringkasan", async () => {
    console.log("\n===== RINGKASAN AUDIT MOBILE =====");
    const adaOverflow = laporan.filter((r) => r.overflowX > 0);
    const adaKecil = laporan.filter((r) => r.targetKecil.length > 0);
    const adaTertutup = laporan.filter((r) => r.tertutupNav.length > 0);

    console.log(`Halaman diperiksa: ${laporan.length}`);
    console.log(`Halaman dengan overflow horizontal: ${adaOverflow.length}`);
    for (const r of adaOverflow) console.log(`  ${r.role} ${r.path} = ${r.overflowX}px`);
    console.log(`Halaman dengan target < 44px: ${adaKecil.length}`);
    for (const r of adaKecil) console.log(`  ${r.role} ${r.path} (${r.targetKecil.length})`);
    console.log(`Halaman dengan elemen tertutup nav: ${adaTertutup.length}`);
    for (const r of adaTertutup) console.log(`  ${r.role} ${r.path} -> ${r.tertutupNav.join(" / ")}`);
  });
});