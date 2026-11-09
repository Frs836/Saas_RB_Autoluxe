"use client";

import { useEffect } from "react";

/**
 * Mendaftarkan service worker dan memastikan selalu update ke versi terbaru.
 *
 * updateViaCache: 'none' → browser selalu fetch sw.js dari network, tidak dari
 * HTTP cache. Ini penting agar perubahan SW langsung aktif setelah deploy
 * tanpa menunggu cache expired (default 24 jam).
 */
export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;

    const register = async () => {
      try {
        const reg = await navigator.serviceWorker.register("/sw.js", {
          updateViaCache: "none",  // selalu cek update dari network
        });

        // Cek update segera setelah register
        reg.update().catch(() => {});

        // Jika ada SW baru waiting, aktifkan langsung
        reg.addEventListener("updatefound", () => {
          const newWorker = reg.installing;
          if (!newWorker) return;
          newWorker.addEventListener("statechange", () => {
            if (newWorker.state === "installed" && navigator.serviceWorker.controller) {
              // SW baru sudah terinstall — kirim pesan untuk skip waiting
              newWorker.postMessage({ type: "SKIP_WAITING" });
            }
          });
        });
      } catch {
        // Kegagalan pendaftaran tidak boleh mengganggu alur aplikasi.
      }
    };

    if (document.readyState === "complete") {
      void register();
      return;
    }

    window.addEventListener("load", () => void register());
  }, []);

  return null;
}
