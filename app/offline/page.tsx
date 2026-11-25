import Link from "next/link";
import { Icon } from "@/components/ui/icon";


export default function OfflinePage() {
  return (
    <main className="flex-1 flex items-center justify-center px-gutter py-10">
      <div className="w-full max-w-[420px] clay-card p-6 rounded-[10px] bg-surface flex flex-col items-center gap-3 text-center border border-border">
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
          className="h-11 px-5 rounded-[8px] primary-gradient clay-glow text-white font-body-bold text-body-bold flex items-center gap-2 hover:opacity-90 transition-opacity shadow-sm"
        >
          <Icon name="refresh" className="text-[18px]" />
          Coba Lagi
        </Link>
      </div>
    </main>
  );
}
