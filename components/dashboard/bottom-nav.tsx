"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type NavItem = {
  label: string;
  icon: string;
  href: string;
};

const NAV_ITEMS: NavItem[] = [
  { label: "Beranda", icon: "dashboard", href: "/dashboard" },
  { label: "Absensi", icon: "how_to_reg", href: "/absensi" },
  { label: "Order", icon: "assignment", href: "/pos/orders" },
  { label: "Profil", icon: "account_circle", href: "/profil" },
];

export function BottomNav() {
  const pathname = usePathname();

  const renderItem = (item: NavItem) => {
    const active = pathname.startsWith(item.href);
    const classes = `flex flex-col items-center justify-center min-w-[56px] min-h-[44px] gap-0.5 transition-colors ${
      active ? "text-brand-500 font-body-bold" : "text-text-muted"
    }`;

    return (
      <Link key={item.label} href={item.href} className={classes}>
        <span className="material-symbols-outlined text-[22px]">
          {item.icon}
        </span>
        <span className="font-caption text-caption">{item.label}</span>
      </Link>
    );
  };

  return (
    <nav className="fixed bottom-0 w-full z-50 pb-safe bg-surface rounded-t-[24px] clay-nav">
      <div className="relative flex items-center justify-around h-[68px] px-space-xs">
        {renderItem(NAV_ITEMS[0])}
        {renderItem(NAV_ITEMS[1])}
        <div className="relative -top-5 flex flex-col items-center justify-center">
          <Link
            href="/pos"
            aria-label="Buat Order Baru"
            className="w-14 h-14 rounded-full primary-gradient flex items-center justify-center text-on-primary clay-glow active:scale-95 transition-transform"
          >
            <span className="material-symbols-outlined text-[28px]">add</span>
          </Link>
        </div>
        {renderItem(NAV_ITEMS[2])}
        {renderItem(NAV_ITEMS[3])}
      </div>
    </nav>
  );
}
