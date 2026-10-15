"use client";

import { useEffect, useState } from "react";
import { wibNow } from "@/lib/attendance";

/**
 * Jam berjalan dalam zona WIB.
 *
 * Nilai jam dihitung di server lalu dikirim sebagai jamAwal supaya render
 * pertama sama persis dengan HTML hasil render server. Kalau jam dihitung
 * langsung saat render, server memakai jam server dan browser memakai jam
 * perangkat, dan selisih beberapa detik sudah cukup untuk membuat React
 * melaporkan galat hidrasi.
 *
 * useSyncExternalStore yang dipakai di halaman notifikasi tidak dipakai di
 * sini karena jamnya perlu memperbarui diri setiap detik, bukan hanya
 *memperhatikan perubahan satu kali.
 */
export function LiveClock({
  jamAwal,
  className,
}: {
  jamAwal: string;
  className?: string;
}) {
  const [waktu, setWaktu] = useState(jamAwal);

  useEffect(() => {
    const perbarui = () => {
      const now = wibNow();
      setWaktu(`${now.timeLabel}`);
    };
    // Hitung ulang segera supaya layar tidak tertinggal satu detik dari
    // nilai yang dikirim server.
    perbarui();
    const id = window.setInterval(perbarui, 1000);
    return () => window.clearInterval(id);
  }, []);

  return (
    <span className={className}>
      {waktu}
      <span aria-hidden="true" className="opacity-50">
        {" "}
      </span>
    </span>
  );
}

/** Tanggal panjang berbahasa Indonesia, misal "Kamis, 15 Okt 2026". */
export function LiveDate({ tanggalAwal }: { tanggalAwal: string }) {
  return <span className="tabular-nums">{tanggalAwal}</span>;
}