"use client";

import { useState } from "react";

/**
 * Foto inspeksi pada halaman lacak publik.
 *
 * Path di database bisa menunjuk berkas yang sudah tidak ada, dan itu akan
 * memunculkan ikon rusak tanpa penjelasan. Komponen ini menangani kondisi gagal
 * secara eksplisit supaya pelanggan melihat keterangan, bukan kotak kosong.
 */
export function InspectionPhoto({
  src,
  alt,
}: {
  src: string | null;
  alt: string;
}) {
  const [gagal, setGagal] = useState(false);

  if (!src || gagal) {
    return (
      <div className="w-full h-32 flex flex-col items-center justify-center gap-1 text-text-muted px-2 text-center">
        <span className="material-symbols-outlined text-[24px]">broken_image</span>
        <span className="font-micro-badge text-micro-badge">{alt}</span>
        <span className="font-micro-badge text-micro-badge opacity-80">
          Foto belum dapat dimuat
        </span>
      </div>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      onError={() => setGagal(true)}
      className="w-full h-32 object-cover"
      loading="lazy"
    />
  );
}