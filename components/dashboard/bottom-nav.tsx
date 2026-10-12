"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  bottomNavFor,
  showCreateOrderFab,
  type NavItem,
  type Role,
} from "@/lib/rbac";

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

    return (
      <Link key={item.href} href={item.href} className={classes}>
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
        {renderItem(items[0])}
        {renderItem(items[1])}
        {showFab ? (
          <div className="relative -top-5 flex flex-col items-center justify-center">
            <Link
              href="/pos"
              aria-label="Buat Order Baru"
              className="w-14 h-14 rounded-full primary-gradient flex items-center justify-center text-on-primary clay-glow active:scale-95 transition-transform"
            >
              <span className="material-symbols-outlined text-[28px]">add</span>
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