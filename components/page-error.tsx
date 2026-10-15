"use client";

import { useEffect } from "react";
import { Icon } from "@/components/ui/icon";

/**
 * Layar error untuk halaman yang gagal memuat.
 *
 * Tanpa ini, kegagalan database dirender sebagai daftar kosong. Admin kasir
 * membaca "Belum ada item inventaris" lalu berhenti memesan bahan, padahal
 * masalahnya server, bukan stoknya. Empty state dan error state harus
 * terpisah supaya tidak berbohong.
 */
export function PageError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="px-gutter py-6 flex flex-col items-start gap-3 max-w-xl">
      <Icon name="cloud_off" className="text-[28px] text-danger-base" />

      <h2 className="text-lg font-bold text-text">Data tidak bisa dimuat</h2>

      <p className="text-sm text-text-secondary leading-relaxed">
        Halaman ini gagal mengambil data dari server. Coba beberapa saat lagi.
        Bila tetap gagal, hubungi maintainer. Angka yang tampil sebelumnya
        belum tentu yang terbaru, jadi jangan dipakai untuk mengambil
        keputusan.
      </p>

      {error.digest ? (
        <p className="font-mono text-[11px] text-text-muted">Kode: {error.digest}</p>
      ) : null}

      <button
        type="button"
        onClick={reset}
        className="mt-1 inline-flex items-center gap-2 min-h-11 px-5 rounded-xl bg-primary text-white font-body-bold text-body-bold"
      >
        <Icon name="refresh" className="text-[18px]" />
        Coba lagi
      </button>
    </div>
  );
}

export default PageError;