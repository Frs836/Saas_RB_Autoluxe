"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

/**
 * Lonceng notifikasi.
 *
 * Sebelumnya menekan ikon ini membuka panel yang menutupi header dan sebagian
 * besar layar, hanya memuat lima pesan terbaru, dan tidak menyediakan tempat
 * untuk menjalankan tindakan yang disebut.
 *
 * Sekarang ikon hanya menampilkan lencana jumlah pesan yang belum dibaca, dan
 * menekan ikon membuka halaman notifikasi tersendiri. Halaman itu yang
 * menangani pencarian, saringan, isi pesan, dan tindakan.
 *
 * Lencana sengaja memakai angka, bukan titik, karena orang perlu tahu
 * berapa banyak pesan yang menunggu, bukan hanya bahwa ada pesan.
 */
export function NotificationBell() {
  const router = useRouter();
  const [belum, setBelum] = useState(0);

  const muatJumlah = useCallback(async () => {
    const supabase = createClient();
    const { data, error } = await supabase
      .from("notifications")
      .select("id, is_read")
      .eq("is_read", false);

    // Kegagalan tidak mengubah lencana. Menampilkan angka nol saat query
    // gagal sama dengan memberi tahu tidak ada pesan, padahal sebenarnya
    // ada yang belum terbaca.
    if (error) return;
    setBelum((data ?? []).length);
  }, []);

  useEffect(() => {
    // Panggilan pertama dijadwalkan, bukan dijalankan sinkron di dalam efek.
    // Menjalankannya sinkron membuat React melakukan render ulang berlapis
    // setiap kali komponen ini dimuat.
    const awal = window.setTimeout(() => void muatJumlah(), 0);

    const kanal = createClient().channel("notifikasi-lencana");
    kanal
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "notifications",
        },
        () => void muatJumlah(),
      )
      .subscribe();

    // Diperbarui juga saat tab dikembalikan ke depan, karena notifikasi bisa
    // masuk lewat perangkat lain.
    const saatKembali = () => {
      if (document.visibilityState === "visible") void muatJumlah();
    };
    document.addEventListener("visibilitychange", saatKembali);

    return () => {
      window.clearTimeout(awal);
      kanal.unsubscribe();
      document.removeEventListener("visibilitychange", saatKembali);
    };
  }, [muatJumlah]);

  return (
    <button
      type="button"
      onClick={() => router.push("/notifikasi")}
      aria-label={
        belum > 0
          ? `Notifikasi, ${belum} pesan belum dibaca`
          : "Notifikasi, tidak ada pesan baru"
      }
      className="relative w-11 h-11 rounded-xl bg-surface-container-low flex items-center justify-center text-text-secondary shadow-[inset_0px_2px_4px_rgba(255,255,255,0.95)] active:scale-[0.98] transition-transform"
    >
      <span className="material-symbols-outlined text-[20px]">notifications</span>
      {belum > 0 ? (
        <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-danger-base text-white text-[10px] font-bold grid place-items-center">
          {belum > 99 ? "99+" : belum}
        </span>
      ) : null}
    </button>
  );
}

export default NotificationBell;