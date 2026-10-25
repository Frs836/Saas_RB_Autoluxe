/**
 * Entry point middleware Next.js.
 *
 * Next.js hanya menjalankan middleware dari file yang bernama persis
 * "middleware.ts" di root project (atau src/). File proxy.ts berisi
 * seluruh logika (rate limiting, session refresh, header forwarding);
 * file ini hanya menjadi jembatan supaya Next.js menemukannya.
 */
export { proxy as middleware, config } from "./proxy";
