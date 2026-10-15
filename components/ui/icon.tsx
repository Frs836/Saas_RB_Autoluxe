import { ICON_PATHS } from "./icon-paths";

type Props = {
  name: string;
  className?: string;
  /**
   * Ditandai ke pembaca layar supaya nama ikon tidak diumumkan sebagai teks.
   * Ikon di sini selalu dekoratif karena selalu berdampingan dengan label.
   */
  title?: string;
};

const sudahDilaporkan = new Set<string>();

/**
 * Ikon Material Symbols sebagai SVG inline.
 *
 * Versi sebelumnya memakai font ligature: <span>visibility</span> dan
 * font mengubahnya jadi glyph. Kalau font gagal dimuat atau subset-nya
 * belum memuat nama itu, yang tampil bukan ikon melainkan teks aslinya,
 * sehingga tulisan seperti "DASHBOARD" atau "INSIGHTS" bocor ke layar.
 *
 * SVG inline tidak punya jalur gagal seperti itu. Tidak ada permintaan
 * jaringan, tidak ada subset yang harus diperbarui, dan nama yang tidak
 * dikenal menghasilkan ikon kosong, bukan teks.
 */
export function Icon({ name, className = "", title }: Props) {
  const glyph = ICON_PATHS[name as keyof typeof ICON_PATHS];

  if (!glyph) {
    // Dilaporkan sekali per nama supaya mudah dicari, bukan setiap render.
    if (typeof console !== "undefined" && !sudahDilaporkan.has(name)) {
      sudahDilaporkan.add(name);
      console.error(
        `[icon] nama "${name}" tidak ada di components/ui/icon-paths.ts. ` +
          `Jalankan: node scripts/build-icon-registry.mjs`,
      );
    }
    return null;
  }

  return (
    <svg
      viewBox={glyph.vb}
      /*
       * Basis 1em supaya kelas ukuran yang sudah dipakai di seluruh
       * aplikasi, seperti text-[22px], tetap bekerja. Pada font, ukuran
       * datang dari font-size; pada SVG, 1em mengikuti font-size elemen
       * yang sama sehingga kelas itu tidak perlu diubah di mana pun.
       */
      className={`inline-block h-[1em] w-[1em] shrink-0 align-middle ${className}`}
      fill="currentColor"
      aria-hidden={title ? undefined : true}
      role={title ? "img" : undefined}
      focusable="false"
    >
      {title ? <title>{title}</title> : null}
      <path d={glyph.d} />
    </svg>
  );
}
