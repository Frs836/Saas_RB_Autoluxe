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
    const classes = `flex flex-col items-center justify-center min-w-[56px] min-h-[44px] px-1 rounded-[8px] gap-0.5 transition-colors duration-150 ${
      active
        ? "text-primary font-body-bold"
        : "text-text-muted hover:text-text-primary"
    }`;

    return (
      <Link key={item.href} href={item.href} prefetch={false} className={classes}>
        <Icon name={item.icon} className="text-[22px]" />
        <span className="font-caption text-caption leading-none">{item.label}</span>
      </Link>
    );
  };

  return (
    <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-nav pb-safe clay-nav border-t">
      <div className="flex items-center justify-around h-[var(--nav-h)] px-2">
        {renderItem(items[0])}
        {renderItem(items[1])}
        {showFab ? (
          <Link
            href="/pos"
            prefetch={false}
            aria-label="Buat Order Baru"
            className="w-11 h-11 rounded-[8px] primary-gradient clay-glow hover:opacity-95 active:opacity-90 flex items-center justify-center text-white transition-opacity duration-150"
          >
            <Icon name="add" className="text-[24px]" />
          </Link>
        ) : (
          <div className="w-11" aria-hidden="true" />
        )}
        {renderItem(items[2])}
        {renderItem(items[3])}
      </div>
    </nav>
  );
}