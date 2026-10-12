/**
 * Pemuat konfigurasi untuk skrip integrasi.
 *
 * Skrip ini berjalan di luar Next.js sehingga tidak bisa memakai
 * `process.env` Next. Semua kredensial dibaca dari berkas lokal yang SUDAH
 * masuk .gitignore, jadi tidak pernah ikut ter-commit.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const stripBom = (value) => value.replace(/^\uFEFF/, "");

export function loadEnv(file = ".env.local") {
  const path = resolve(process.cwd(), file);

  let raw;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    throw new Error(
      `Tidak bisa membaca ${file}. Salin .env.example menjadi .env.local lalu isi nilainya.`,
    );
  }

  const entries = stripBom(raw)
    .split("\n")
    .filter((line) => line.trim() && !line.trim().startsWith("#") && line.includes("="))
    .map((line) => {
      const index = line.indexOf("=");
      return [
        line.slice(0, index).trim(),
        line.slice(index + 1).trim().replace(/^["']|["']$/g, ""),
      ];
    });

  return Object.fromEntries(entries);
}

/**
 * Akun uji dibaca dari dev-users.json (juga ter-gitignore).
 * Struktur berkas: { "roles": [{ "role", "email", "password" }] }
 */
export function loadTestAccounts(file = "dev-users.json") {
  const path = resolve(process.cwd(), file);

  let raw;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    throw new Error(
      `Tidak bisa membaca ${file}. Isi daftar akun uji dengan email dan password.`,
    );
  }

  const parsed = JSON.parse(stripBom(raw));
  const accounts = Array.isArray(parsed) ? parsed : (parsed.roles ?? []);

  if (accounts.length === 0) {
    throw new Error(`${file} tidak memuat akun uji.`);
  }

  return accounts;
}

export function requireEnv(env, keys) {
  const missing = keys.filter((key) => !env[key]);
  if (missing.length > 0) {
    throw new Error(
      `Variabel berikut tidak ditemukan: ${missing.join(", ")}. Periksa ${".env.local"}.`,
    );
  }
  return env;
}