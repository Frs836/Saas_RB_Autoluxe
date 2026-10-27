import { chromium, FullConfig } from "@playwright/test";

/**
 * Global setup untuk E2E test.
 * 
 * Set app.skip_notifications=on di localStorage sebelum test dimulai
 * untuk mencegah spam notifikasi dari time_off_requests test.
 */
export default async function globalSetup(config: FullConfig) {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const baseURL = config.projects[0]?.use?.baseURL ?? "http://localhost:3000";
  
  await page.goto(baseURL, { waitUntil: "domcontentloaded" });
  
  // Set flag skip notifications
  await page.evaluate(() => {
    localStorage.setItem("app.skip_notifications", "on");
  });
  
  console.log("[global-setup] app.skip_notifications=on set di localStorage");
  
  await browser.close();
}