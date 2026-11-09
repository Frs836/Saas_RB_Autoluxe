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
  // Start with collapsed (72px) to match sidebar default; sync after mount
  const [sidebarExpanded, setSidebarExpanded] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    // stored === "true" means collapsed, so expanded === stored !== "true"
    if (stored !== null) {
      setSidebarExpanded(stored !== "true");
    } else {
      setSidebarExpanded(false); // default: collapsed
    }

    function handleToggle(e: Event) {
      const custom = e as CustomEvent<{ collapsed: boolean }>;
      setSidebarExpanded(!custom.detail.collapsed);
    }

    window.addEventListener("rba-sidebar-toggle", handleToggle);
    return () => window.removeEventListener("rba-sidebar-toggle", handleToggle);
  }, []);

  return (
    <>
      {/* Sidebar — desktop only */}
      <div className="hidden lg:block">
        <DesktopSidebar
          role={role}
          fullName={fullName}
          branchName={branchName}
          hasUnread={hasUnread}
          profileId={profileId}
        />
      </div>

      {/* Main content — offset by sidebar width on desktop */}
      <div
        className="lg:transition-all lg:duration-300"
        style={{
          marginLeft:
            typeof window !== "undefined" && window.innerWidth >= 1024
              ? sidebarExpanded
                ? "240px"
                : "72px"
              : undefined,
        }}
      >
        {children}
      </div>
    </>
  );
}
