"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  bottomNavFor,
  showCreateOrderFab,
  type NavItem,
  type Role,
} from "@/lib/rbac";
import { Icon } from "@/components/ui/icon";

type Props = {
  role: Role;
};

export function BottomNav({ role }: Props) {
  const pathname = usePathname();
  const items = bottomNavFor(role);
  const showFab = showCreateOrderFab(role);

  const renderItem = (item: NavItem) => {
    const active = pathname.startsWith(item.href);
    const classes = `flex flex-col items-center justify-center min-w-[56px] min-h-[44px] gap-0.5 transition-colors ${
      active ? "text-brand-500 font-body-bold" : "text-text-muted"
    }`;

    /*
   * Prefetch dimatikan untuk navigasi bawah.
   *
   * Setiap halaman memuat navigasi dengan lima tautan. Dengan prefetch aktif,
   * Next.js langsung menarik tampilan RSC kelimanya sekaligus begitu halaman
   * muncul. Pengukuran menunjukkan server hanya membutuhkan 160 sampai 460 ms
   * untuk mengirim HTML, tetapi dokumen baru selesai 2,4 sampai 3,8 detik
   * kemudian karena berkas JavaScript berebut jaringan dengan sepuluh
   * permintaan prefetch itu.
   *
   * Navigasi bawah adalah menu utama yang selalu terlihat, jadi tautannya
   * selalu sudah ada di layar. Tanpa prefetch, perpindahan halaman sedikit
   * lebih lambat, tetapi halaman pertama benar-benar tampil jauh lebih cepat.
   */
  return (
    <Link key={item.href} href={item.href} prefetch={false} className={classes}>
      <Icon name={item.icon} className="text-[22px]" />
      <span className="font-caption text-caption">{item.label}</span>
    </Link>
  );
  };

  return (
    <nav className="fixed bottom-0 w-full z-nav pb-safe bg-surface rounded-t-[24px] clay-nav">
      <div className="relative flex items-center justify-around h-[var(--nav-h)] px-space-xs">
        {renderItem(items[0])}
        {renderItem(items[1])}
        {showFab ? (
          /*
           * Tombol tambah order duduk di dalam navigasi, tidak keluar dari
           * container. Sebelumnya memakai -top-5 yang menambah 20px tinggi
           * efektif navigasi tanpa ada halaman yang tahu, jadi isi di
           * bawahnya tertutup. Sekarang tinggi navigasi tetap 68px dan
           * ruang kosongnya disediakan oleh token --nav-h-fab.
           */
          <div className="relative flex flex-col items-center justify-center">
            <Link
              href="/pos"
              prefetch={false}
              aria-label="Buat Order Baru"
              className="w-14 h-14 rounded-full primary-gradient flex items-center justify-center text-on-primary clay-fab active:scale-95 transition-transform"
            >
              <Icon name="add" className="text-[28px]" />
            </Link>
          </div>
        ) : (
          <div className="w-14" aria-hidden="true" />
        )}
        {renderItem(items[2])}
        {renderItem(items[3])}
      </div>
    </nav>
  );
}