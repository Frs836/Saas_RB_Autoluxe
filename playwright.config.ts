import { defineConfig, devices } from "@playwright/test";

/**
 * Konfigurasi audit E2E.
 *
 * Chromium dijalankan dengan perangkat kamera dan geolokasi palsu supaya
 * alur yang butuh kamera dan GPS bisa diuji tanpa perangkat fisik. Tanpa
 * kedua flag itu, pengujian Face ID, foto inspeksi, dan geofence absensi akan
 * selalu gagal di lingkungan CI dan hasilnya menyesatkan.
 */
export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: [["list"], ["json", { outputFile: "e2e-report.json" }]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
    actionTimeout: 20_000,
    navigationTimeout: 45_000,
    launchOptions: {
      args: [
        "--use-fake-ui-for-media-stream",
        "--use-fake-device-for-media-stream",
        "--autoplay-policy=no-user-gesture-required",
      ],
    },
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});