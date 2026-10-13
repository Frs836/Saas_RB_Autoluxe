import { test, devices } from "@playwright/test";
import { account } from "./helpers";

/**
 * Menguji apakah elemen terakhir benar-benar bisa diketuk, bukan hanya
 * secara visual. elementFromPoint mengembalikan elemen teratas pada titik
 * tersebut, jadi kalau yang menutupi adalah navigasi atau bilah tetap,
 * elemen_asli ada di bawahnya dan tidak bisa disentuh.
 */

test.use({ ...devices["Pixel 7"] });

async function masuk(page: import("@playwright/test").Page, role: string) {
  const user = account(role);
  await page.context().clearCookies();
  await page.goto("/login", { waitUntil: "domcontentloaded" });
  await page.fill('input[type="email"]', user.email);
  await page.fill('input[type="password"]', user.password);
  await page.click('button[type="submit"]');
  const mulai = Date.now();
  while (Date.now() - mulai < 45_000) {
    const cookies = await page.context().cookies();
    if (cookies.some((c) => c.name.includes("auth-token"))) return true;
    await page.waitForTimeout(400);
  }
  return false;
}

const CEK: Array<{ path: string; role: string; pilih: string }> = [
  { path: "/pos", role: "admin_kasir", pilih: "katalog layanan terakhir" },
  { path: "/pos/orders", role: "karyawan", pilih: "kartu order terakhir" },
  { path: "/stok", role: "admin_kasir", pilih: "item terakhir" },
  { path: "/stok/opname", role: "maintainer", pilih: "baris opname terakhir" },
  { path: "/izin", role: "karyawan", pilih: "tab terakhir" },
];

test.describe("Konten tertutup bilah tetap", () => {
  test("elemen terakhir di setiap halaman harus bisa diketuk", async ({ page }) => {
    test.setTimeout(900_000);

    for (const item of CEK) {
      if (!(await masuk(page, item.role))) {
        console.log(`[${item.path}] login ${item.role} gagal`);
        continue;
      }
      await page.goto(item.path, { waitUntil: "domcontentloaded", timeout: 90_000 });
      await page.waitForTimeout(3000);

      // Gulir sampai benar-benar bawah.
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(1200);

      const hasil = await page.evaluate((deskripsi) => {
        const nodes = Array.from(
          document.querySelectorAll<HTMLElement>("button, a[href], select, input"),
        ).filter((node) => {
          const rect = node.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        });

        if (nodes.length === 0) return { deskripsi, total: 0, tertutup: [] };

        // Elemen yang paling bawah di viewport dan tetap terlihat.
        const kandidat = nodes
          .map((node) => ({ node, rect: node.getBoundingClientRect() }))
          .filter(({ rect }) => rect.bottom > 100 && rect.top < window.innerHeight)
          .sort((a, b) => b.rect.bottom - a.rect.bottom);

        const tertutup: string[] = [];
        for (const { node, rect } of kandidat.slice(0, 12)) {
          const cx = rect.left + rect.width / 2;
          const cy = rect.top + rect.height / 2;
          if (cy < 0 || cy > window.innerHeight) continue;
          const atas = document.elementFromPoint(cx, cy);
          if (atas && !node.contains(atas) && !atas.contains(node)) {
            const penutup = atas.closest("nav, .fixed, [class*='fixed']");
            tertutup.push(
              `"${(node.textContent ?? "").trim().slice(0, 26)}" ditutup oleh <${atas.tagName.toLowerCase()} class="${String(atas.className).slice(0, 42)}">${penutup ? " (bilah tetap)" : ""}`,
            );
          }
        }
        return { deskripsi, total: nodes.length, tertutup };
      }, item.pilih);

      console.log(`\n[${item.path} ${item.role}] ${hasil.deskripsi} dari ${hasil.total} kontrol`);
      for (const t of hasil.tertutup) console.log(`  TERUTUP: ${t}`);
      if (hasil.tertutup.length === 0) console.log("  semua kontrol dapat diketuk");
    }
  });
});