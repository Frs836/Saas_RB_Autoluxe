"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { profileMenuFor, roleLabel } from "@/lib/rbac";
import { initials } from "@/lib/format";
import { Icon } from "@/components/ui/icon";

const STORAGE_KEY = "rba-sidebar-collapsed";

export interface DesktopSidebarProps {
  role: string;
  fullName: string;
  branchName: string;
  hasUnread: boolean;
  profileId: string;
}

export function DesktopSidebar({
  role,
  fullName,
  branchName,
  hasUnread,
  profileId,
}: DesktopSidebarProps) {
  const pathname = usePathname();

  // Default to collapsed; hydrate from localStorage after mount
  const [collapsed, setCollapsed] = useState(true);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    // stored === "true" means collapsed
    if (stored !== null) {
      setCollapsed(stored === "true");
    } else {
      setCollapsed(true);
    }
    setMounted(true);
  }, []);

  function toggle() {
    const next = !collapsed;
    setCollapsed(next);
    localStorage.setItem(STORAGE_KEY, String(next));
    // Dispatch event so AppShellClient can sync margin
    window.dispatchEvent(new CustomEvent("rba-sidebar-toggle", { detail: { collapsed: next } }));
  }

  // Build nav items: deduplicate by href, first occurrence wins, max 12
  const allItems = profileMenuFor(role);
  const seen = new Set<string>();
  const navItems: typeof allItems = [];
  for (const item of allItems) {
    if (!seen.has(item.href)) {
      seen.add(item.href);
      navItems.push(item);
    }
    if (navItems.length >= 12) break;
  }

  const sidebarWidth = collapsed ? "w-[72px]" : "w-[240px]";

  return (
    <aside
      className={`fixed left-0 top-0 h-full z-40 flex flex-col bg-surface border-r border-border-subtle clay-nav transition-all duration-300 ${sidebarWidth}`}
    >
      {/* Logo area */}
      <div
        className={`flex items-center h-16 px-4 shrink-0 ${collapsed ? "justify-center" : "justify-between"}`}
      >
        <div className="flex items-center gap-3 min-w-0">
          <Image
            src="/rb-logo-new.png"
            alt="RB AUTOLUXE"
            width={32}
            height={32}
            className="w-8 h-8 rounded-lg object-contain shrink-0"
            priority
          />
          {!collapsed && (
            <span className="font-headline-2 text-headline-2 text-text-primary tracking-tight truncate leading-tight whitespace-nowrap">
              RB AUTOLUXE
            </span>
          )}
        </div>
      </div>

      {/* Profile mini — only visible when expanded */}
      {!collapsed && mounted && (
        <div className="mx-3 mb-3 px-3 py-2 rounded-xl bg-surface-container-low shrink-0">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full primary-gradient flex items-center justify-center shrink-0">
              <span className="font-body-bold text-[11px] text-white leading-none">
                {initials(fullName)}
              </span>
            </div>
            <div className="flex flex-col min-w-0">
              <span className="font-body-bold text-body-bold text-text-primary truncate leading-tight text-[13px]">
                {fullName}
              </span>
              <span className="font-caption text-caption text-text-muted truncate text-[11px]">
                {roleLabel(role)}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Nav items */}
      <nav className="flex-1 overflow-y-auto overflow-x-hidden px-2 py-1 flex flex-col gap-1">
        {navItems.map((item) => {
          const active = pathname === item.href || pathname.startsWith(item.href + "/");
          return (
            <Link
              key={item.href}
              href={item.href}
              prefetch={false}
              title={collapsed ? item.label : undefined}
              className={`flex items-center gap-3 rounded-xl transition-colors
                ${collapsed ? "justify-center w-11 h-11 mx-auto" : "px-3 py-2.5"}
                ${
                  active
                    ? "primary-gradient text-white"
                    : "text-text-muted hover:bg-brand-50 hover:text-text-primary"
                }`}
            >
              <Icon
                name={item.icon}
                className={`text-[22px] shrink-0 ${active ? "text-white" : ""}`}
              />
              {!collapsed && (
                <span className="font-body-regular text-body-regular truncate text-[13px]">
                  {item.label}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      {/* Bottom fixed items */}
      <div className="px-2 py-2 flex flex-col gap-1 shrink-0 border-t border-border-subtle">
        {/* Notifications */}
        <Link
          href="/notifikasi"
          prefetch={false}
          title={collapsed ? "Notifikasi" : undefined}
          className={`relative flex items-center gap-3 rounded-xl transition-colors text-text-muted hover:bg-brand-50 hover:text-text-primary
            ${collapsed ? "justify-center w-11 h-11 mx-auto" : "px-3 py-2.5"}
            ${pathname === "/notifikasi" ? "primary-gradient text-white" : ""}`}
        >
          <span className="relative shrink-0">
            <Icon
              name="notifications"
              className={`text-[22px] ${pathname === "/notifikasi" ? "text-white" : ""}`}
            />
            {hasUnread && (
              <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-danger-base" />
            )}
          </span>
          {!collapsed && (
            <span className="font-body-regular text-body-regular text-[13px]">
              Notifikasi
            </span>
          )}
        </Link>

        {/* Profile */}
        <Link
          href="/profil"
          prefetch={false}
          title={collapsed ? "Profil" : undefined}
          className={`flex items-center gap-3 rounded-xl transition-colors text-text-muted hover:bg-brand-50 hover:text-text-primary
            ${collapsed ? "justify-center w-11 h-11 mx-auto" : "px-3 py-2.5"}
            ${pathname === "/profil" ? "primary-gradient text-white" : ""}`}
        >
          <Icon
            name="account_circle"
            className={`text-[22px] shrink-0 ${pathname === "/profil" ? "text-white" : ""}`}
          />
          {!collapsed && (
            <span className="font-body-regular text-body-regular text-[13px]">
              Profil
            </span>
          )}
        </Link>

        {/* Logout */}
        <form action="/auth/signout" method="post">
          <button
            type="submit"
            title={collapsed ? "Keluar" : undefined}
            className={`w-full flex items-center gap-3 rounded-xl transition-colors text-text-muted hover:bg-danger-surface hover:text-danger-text
              ${collapsed ? "justify-center w-11 h-11 mx-auto" : "px-3 py-2.5"}`}
          >
            <Icon name="logout" className="text-[22px] shrink-0" />
            {!collapsed && (
              <span className="font-body-regular text-body-regular text-[13px]">
                Keluar
              </span>
            )}
          </button>
        </form>
      </div>

      {/* Toggle collapse button */}
      <button
        type="button"
        onClick={toggle}
        aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        className="absolute -right-3 top-16 w-6 h-6 rounded-full bg-surface border border-border-subtle clay-nav flex items-center justify-center text-text-muted hover:text-text-primary hover:bg-brand-50 transition-colors z-50"
      >
        <Icon
          name={collapsed ? "chevron_right" : "chevron_left"}
          className="text-[16px]"
        />
      </button>
    </aside>
  );
}
