/*
 * Service worker minimal untuk RB AUTOLUXE.
 *
 * Strategi sengaja dijaga konservatif karena aplikasi ini menyimpan data
 * operasional dan kas yang tidak boleh basi atau tampil dari cache yang
 * sudah kedaluwarsa.
 *
 *   - Navigasi: network first, cache hanya dipakai saat jaringan gagal.
 *   - Aset statis: cache first, laluisi cache di latar belakang.
 *   - Everything lain, termasuk seluruh permintaan ke Supabase: selalu
 *     langsung ke jaringan, tidak pernah di-cache.
 *
 * Data operasional seperti saldo kas, stok, dan absensi tidak boleh dilayani
 * dari cache. Menatalikannya secara keliru berisiko menampilkan angka yang
 * sudah berubah kepada pengguna.
 */

const CACHE_NAME = "rba-shell-v1";
const SHELL_ASSETS = ["/offline", "/manifest.json", "/rb-logo-new.png"];

/*
 * Mesin pemindai wajah.
 *
 * Berkasnya besar, sekitar 16 MB, dan tidak berubah antar rilis. Kalau tidak
 * di-cache, setiap kali aplikasi dibuka di jaringan lambat seluruh berkas itu
 * diunduh ulang. Di-cache sekali, setelah itu diambil dari penyimpanan
 * perangkat.
 *
 * Cache terpisah karena isinya besar dan jarang berubah. Tidak ikut di
 * SHELL_ASSETS supaya tidak menahan halaman offline sampai berkas besar selesai
 * terunduh.
 */
const MESIN_WAJAH_CACHE = "rba-face-engine-v1";
const MESIN_WAJAH_ASET = [
  "/mediapipe/wasm/vision_wasm_internal.js",
  "/mediapipe/wasm/vision_wasm_internal.wasm",
  "/mediapipe/models/face_landmarker.task",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(SHELL_ASSETS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter(
              (key) => key !== CACHE_NAME && key !== MESIN_WAJAH_CACHE,
            )
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

/* Mesin wajah diambil dari cache lebih dulu supaya halaman absensi tidak
   menunggu unduhan 16 MB setiap kali dibuka. Cache baru diisi di latar
   belakang saat halaman pertama memakainya, bukan saat service worker
   dipasang, supaya pemasangan tidak tertahan berkas besar. */
self.addEventListener("message", (event) => {
  if (event.data?.type !== "precache-face-engine") return;
  event.waitUntil(
    caches.open(MESIN_WAJAH_CACHE).then((cache) =>
      cache.addAll(MESIN_WAJAH_ASET).catch(() => undefined),
    ),
  );
});

function isSupabase(url) {
  return (
    url.hostname.endsWith("supabase.co") ||
    url.hostname.endsWith("supabase.in") ||
    url.pathname.startsWith("/rest/v1/") ||
    url.pathname.startsWith("/auth/v1/") ||
    url.pathname.startsWith("/storage/v1/")
  );
}

self.addEventListener("fetch", (event) => {
  const { request } = event;

  if (request.method !== "GET") return;

  const url = new URL(request.url);

  if (url.origin !== self.location.origin) return;
  if (isSupabase(url)) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          return response;
        })
        .catch(() =>
          caches.match(request).then((cached) => cached ?? caches.match("/offline")),
        ),
    );
    return;
  }

  if (url.pathname.startsWith("/mediapipe/")) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches
              .open(MESIN_WAJAH_CACHE)
              .then((cache) => cache.put(request, copy));
          }
          return response;
        });
      }),
    );
    return;
  }

  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/")) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          }
          return response;
        });
      }),
    );
  }
});