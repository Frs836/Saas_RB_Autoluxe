import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page } from "@playwright/test";

/**
 * Pembantu bersama untuk skrip audit E2E.
 *
 * Akun uji dibaca dari dev-users.json yang sudah masuk .gitignore. Kredensial
 * tidak pernah ditulis langsung di dalam skrip.
 */

type Account = {
  nickname: string;
  email: string;
  password: string;
  role: string;
};

let cached: Account[] | null = null;

export function accounts(): Account[] {
  if (!cached) {
    const raw = readFileSync(join(process.cwd(), "dev-users.json"), "utf8");
    // Berkas ini pernah ditulis dari PowerShell sehingga bisa diawali BOM.
    // JSON.parse menolak BOM, jadi dibuang lebih dulu.
    const parsed = JSON.parse(raw.replace(/^\uFEFF/, "")) as { roles: Account[] };
    cached = parsed.roles;
  }
  return cached;
}

export function account(role: string): Account {
  const found = accounts().find((item) => item.role === role);
  if (!found) throw new Error(`Akun uji untuk peran ${role} tidak ditemukan.`);
  return found;
}

/** Navigasi ke beranda dan menunggu selesai. */
export async function goto(page: Page, path: string) {
  await page.goto(path, { waitUntil: "domcontentloaded" });
}

/** Masuk lewat form login dan menunggu cookie sesi benar-benar terbentuk. */
export async function login(page: Page, role: string) {
  const user = account(role);

  // Permintaan auth pertama kadang lambat dan belum sempat selesai sebelum
  // cookie diperiksa. Dua percobaan cukup untuk membedakan kelambatan dari
  // kegagalan login sungguhan tanpa menutupi gagalan yang konsisten.
  for (let percobaan = 0; percobaan < 2; percobaan += 1) {
    // Cookie sesi dari login sebelumnya harus dibuang lebih dulu. Kalau tidak,
    // middleware akan mengarahkan /login ke /dashboard karena pengguna masih
    // masuk, dan tidak ada lagi formulir untuk diisi.
    const sisa = await page.context().cookies();
    if (sisa.some((item) => item.name.includes("auth-token"))) {
      await page.context().clearCookies();
    }

    await page.goto("/login", { waitUntil: "domcontentloaded" });
    await page.fill('input[type="email"]', user.email);
    await page.fill('input[type="password"]', user.password);
    await page.click('button[type="submit"]');

    // Menunggu dengan networkidle tidak dapat diandalkan karena koneksi
    // realtime Supabase menahan koneksi tetap terbuka. Syarat yang benar-benar
    // menentukan keberhasilan login adalah cookie sesi sudah ditulis.
    const mulai = Date.now();
    while (Date.now() - mulai < 30_000) {
      const cookies = await page.context().cookies();
      if (cookies.some((item) => item.name.includes("auth-token"))) {
        await page.waitForTimeout(500);
        return;
      }
      await page.waitForTimeout(400);
    }
    console.log(`[login] ${role} percobaan ${percobaan + 1} gagal, diulang sekali`);
  }
  throw new Error("Cookie sesi tidak terbentuk setelah dua percobaan login.");
}

/** Mengaktifkan izin kamera dan geolokasi sebelum masuk ke halaman. */
export async function grantMediaAndGeo(page: Page) {
  await page.context().grantPermissions(["camera", "geolocation"], {
    origin: process.env.E2E_BASE_URL ?? "http://localhost:3000",
  });
}

/**
 * Mengatur posisi GPS perangkat.
 *
 * Branch ini memakai titik acuan sekitar Jakarta. Nilai dibuat sangat dekat
 * sehingga berada di dalam radius geofence, karena jarak dihitung dari
 * koordinat perangkat yang dikirim browser.
 */
export async function setGeolocation(page: Page) {
  await page.context().setGeolocation({
    latitude: -6.2,
    longitude: 106.816666,
    accuracy: 12,
  });
}

/** Mengambil semua teks galat dan peringatan yang terlihat di halaman. */
export async function visibleMessages(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const nodes = Array.from(
      document.querySelectorAll(
        "[class*='text-danger-text'],[class*='text-warning-text'],[class*='text-success-text'],[role='alert']",
      ),
    );
    return nodes
      .map((node) => (node.textContent ?? "").trim())
      .filter((text) => text.length > 0);
  });
}

/** Mengecek apakah halaman memuat teks tertentu. */
export async function hasText(page: Page, needle: string): Promise<boolean> {
  const body = await page.textContent("body");
  return (body ?? "").toLowerCase().includes(needle.toLowerCase());
}

/** Membaca URL terakhir setelah navigasi selesai. */
export async function currentPath(page: Page): Promise<string> {
  return new URL(page.url()).pathname;
}

/**
 * Menandai pengujian supaya konteks kegagalan tetap informatif, dengan
 * menambahkan pesan galat yang terlihat di halaman.
 */
export async function softAssert(page: Page, label: string, fn: () => Promise<void>) {
  try {
    await fn();
  } catch (error) {
    const messages = await visibleMessages(page).catch(() => []);
    throw new Error(
      `${label}: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}` +
        (messages.length ? ` | pesan halaman: ${messages.slice(0, 3).join(" ; ")}` : ""),
    );
  }
}

export { expect };