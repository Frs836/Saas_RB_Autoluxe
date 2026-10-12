/**
 * Assertion helper untuk pengujian integrasi.
 *
 * Sengaja tanpa dependensi supaya bisa dijalankan tanpa memasang framework
 * apa pun. Keluar dengan kode selain 0 bila ada satu saja yang gagal, sehingga
 * bisa disisipkan ke pipeline CI.
 */

const GREEN = "\u001B[32m";
const RED = "\u001B[31m";
const DIM = "\u001B[2m";
const BOLD = "\u001B[1m";
const RESET = "\u001B[0m";

const useColor = process.stdout.isTTY && process.env.NO_COLOR === undefined;

const paint = (color, text) => (useColor ? `${color}${text}${RESET}` : text);

export function createSuite(title) {
  const results = [];
  let section = "";

  const failedCount = () => results.filter((r) => !r.ok).length;

  const api = {
    section(name) {
      section = name;
      if (useColor) process.stdout.write(`\n${DIM}── ${name} ──${RESET}\n`);
      else process.stdout.write(`\n-- ${name} --\n`);
    },

    /**.catatan: `ok` menentukan lulus/gagal; `detail` hanya untuk diagnostik. */
    check(name, ok, detail = "") {
      results.push({ section, name, ok: Boolean(ok), detail });
      const mark = ok ? paint(GREEN, "PASS") : paint(RED, "FAIL");
      const suffix = detail ? paint(DIM, `  -> ${detail}`) : "";
      process.stdout.write(`${mark}  ${name}${suffix}\n`);
      return ok;
    },

    /**
     * Sebuah UPDATE PostgREST bisa "berhasil" tanpa mengubah apa pun bila
     * policy RLS menyaring barisnya. Bandingkan jumlah baris yang benar-benar
     * kembali agar penyaringan diam-diam tidak lolos sebagai PASS.
     */
    async expectNoRowsChanged(name, promise) {
      try {
        const { data, error } = await promise;
        if (error) {
          api.check(name, true, `ditolak: ${error.message}`);
        } else {
          api.check(name, (data ?? []).length === 0, `${data?.length ?? 0} baris berubah`);
        }
      } catch (error) {
        api.check(name, false, error.message);
      }
      return true;
    },

    /** Sebaliknya: operasi yang seharusnya mengubah tepat satu baris. */
    async expectOneRowChanged(name, promise) {
      try {
        const { data, error } = await promise;
        if (error) {
          api.check(name, false, error.message);
        } else {
          api.check(name, (data ?? []).length === 1, `${data?.length ?? 0} baris berubah`);
        }
      } catch (error) {
        api.check(name, false, error.message);
      }
      return true;
    },

    summary() {
      const failed = results.filter((r) => !r.ok);
      const passed = results.length - failed.length;

      process.stdout.write(
        `\n${paint(BOLD, "Ringkasan")} ${passed}/${results.length} PASS\n`,
      );

      if (failed.length > 0) {
        process.stdout.write(`${paint(RED, "Gagal:")}\n`);
        for (const item of failed) {
          process.stdout.write(`  - [${item.section}] ${item.name}\n`);
          if (item.detail) process.stdout.write(`    ${item.detail}\n`);
        }
      }

      return { total: results.length, passed, failed };
    },

    exitCode() {
      return failedCount() === 0 ? 0 : 1;
    },
  };

  process.stdout.write(`${paint(BOLD, `\n${title}`)}\n`);
  return api;
}