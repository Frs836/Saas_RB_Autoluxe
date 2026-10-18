import Link from "next/link";
import { Icon } from "@/components/ui/icon";

export const instant = false;

export default function OfflinePage() {
  return (
    <main className="flex-1 flex items-center justify-center px-gutter py-10">
      <div className="w-full max-w-[420px] clay-card p-6 rounded-3xl bg-surface flex flex-col items-center gap-3 text-center">
        <Icon name="cloud_off" className="text-[40px] text-warning-base" />
        <h1 className="font-headline-1 text-headline-1 text-text-primary">
          Jaringan Tidak Tersedia
        </h1>
        <p className="font-caption text-caption text-text-secondary leading-relaxed">
          Halaman ini belum tersimpan di perangkat. Data kas, stok, dan absensi
          selalu diambil langsung dari server agar angka yang tampil tidak
          basi.
        </p>
        <Link
          href="/dashboard"
          className="h-11 px-5 rounded-xl primary-gradient text-white font-body-bold text-body-bold flex items-center gap-2"
        >
          <Icon name="refresh" className="text-[18px]" />
          Coba Lagi
        </Link>
      </div>
    </main>
  );
}