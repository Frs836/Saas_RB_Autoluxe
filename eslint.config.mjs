import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // Foto-foto ini berasal dari bucket Supabase dan Cloudinary, jadi sudah
      // terkompresi di sisi asal dan tidak melalui optimizer Next. Memakai
      // next/image di sini hanya menambah remotePatterns tanpa manfaat nyata.
      // nyata. Aturan ini dimatikan di level proyek supaya tidak perlu
      // komentar disable per baris, yang rawan salah tempat dan pernah
      // bocor ke layar sebagai teks.
      "@next/next/no-img-element": "off",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Vendor runtime (MediaPipe WASM, service worker, dsb): berkas pihak
    // ketiga yang sudah diminifikasi, bukan kode aplikasi.
    "public/**",
  ]),
]);

export default eslintConfig;
