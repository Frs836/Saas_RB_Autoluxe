"use client";

import { useEffect, useState } from "react";
import { DesktopSidebar } from "@/components/dashboard/desktop-sidebar";

const STORAGE_KEY = "rba-sidebar-collapsed";

interface AppShellClientProps {
  role: string;
  fullName: string;
  branchName: string;
  hasUnread: boolean;
  profileId: string;
  children: React.ReactNode;
}

export function AppShellClient({
  role,
  fullName,
  branchName,
  hasUnread,
  profileId,
  children,
}: AppShellClientProps) {
  // collapsed = true → sidebar 72px, false → 240px
  const [collapsed, setCollapsed] = useState(true);

  useEffect(() => {
    // Sync initial state dari localStorage
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored !== null) setCollapsed(stored === "true");

    // Listen untuk toggle dari DesktopSidebar
    function handleToggle(e: Event) {
      const detail = (e as CustomEvent<{ collapsed: boolean }>).detail;
      setCollapsed(detail.collapsed);
    }
    window.addEventListener("rba-sidebar-toggle", handleToggle);
    return () => window.removeEventListener("rba-sidebar-toggle", handleToggle);
  }, []);

  return (
    <>
      {/* Sidebar — hanya muncul di lg ke atas */}
      <div className="hidden lg:block">
        <DesktopSidebar
          role={role}
          fullName={fullName}
          branchName={branchName}
          hasUnread={hasUnread}
          profileId={profileId}
        />
      </div>

      {/* Main content — geser ke kanan sesuai lebar sidebar */}
      <div className={`w-full transition-all duration-300 ${
        collapsed ? "lg:pl-[72px]" : "lg:pl-[240px]"
      }`}>
        {children}
      </div>
    </>
  );
}
