"use client";

import { useEffect } from "react";

/**
 * Mendaftarkan service worker agar aplikasi bisa diinstall sebagai PWA.
 *
 * Pendaftaran hanya dilakukan pada build produksi. Pada mode pengembangan
 * service worker akan menahan modul terbaru dan membuat perubahan tampak
 * tidak berlaku, sehingga sengaja dilewati.
 */
export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;

    const register = () => {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        // Kegagalan pendaftaran tidak boleh mengganggu alur aplikasi.
      });
    };

    if (document.readyState === "complete") {
      register();
      return;
    }

    window.addEventListener("load", register);
    return () => window.removeEventListener("load", register);
  }, []);

  return null;
}