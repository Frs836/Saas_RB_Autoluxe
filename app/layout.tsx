import type { Metadata, Viewport } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import { ServiceWorkerRegistrar } from "@/components/mobile/service-worker-registrar";
import { ToastProvider } from "@/components/toast";
import { NavigationProgressProvider } from "@/components/ui/navigation-progress";
import { AppShellClient } from "@/components/app-shell-client";
import { getSessionProfile } from "@/lib/rbac-guard";
import { createClient } from "@/lib/supabase/server";
import "./globals.css";

const plusJakartaSans = Plus_Jakarta_Sans({
  variable: "--font-plus-jakarta",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "RB AUTOLUXE",
  description: "Sistem Operasional POS Autoluxe",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    title: "RB AUTOLUXE",
    statusBarStyle: "black-translucent",
  },
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/icon.png", type: "image/png", sizes: "32x32" },
      { url: "/rb-logo-new.png", type: "image/png", sizes: "512x512" },
    ],
    apple: [
      { url: "/apple-icon.png", sizes: "180x180", type: "image/png" },
    ],
    shortcut: "/favicon.ico",
  },
};

export const viewport: Viewport = {
  themeColor: "#0f172a",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Ambil session untuk sidebar - tidak akan throw, hanya null jika belum login
  const profile = await getSessionProfile();

  // Cek notifikasi unread hanya jika user sudah login
  let hasUnread = false;
  if (profile) {
    try {
      const supabase = await createClient();
      const { count } = await supabase
        .from("notifications")
        .select("id", { count: "exact", head: true })
        .eq("recipient_id", profile.id)
        .eq("is_read", false);
      hasUnread = (count ?? 0) > 0;
    } catch {
      // Tidak critical - sidebar tetap render tanpa badge
    }
  }

  return (
    <html lang="id" className={plusJakartaSans.variable}>
      <head />
      <body className="min-h-screen flex flex-col antialiased">
        <ToastProvider>
          <NavigationProgressProvider>
            <ServiceWorkerRegistrar />
            {profile ? (
              // User sudah login - render dengan sidebar di desktop
              <AppShellClient
                role={profile.role}
                fullName={profile.fullName}
                branchName={
                  profile.branchScope === "all"
                    ? "Seluruh Cabang"
                    : (profile.branches.find((b) => b.id === profile.branchId)?.name ?? "Cabang Utama")
                }
                hasUnread={hasUnread}
                profileId={profile.id}
              >
                {children}
              </AppShellClient>
            ) : (
              // Belum login (halaman /login, /register, /track) - tanpa sidebar
              <>{children}</>
            )}
          </NavigationProgressProvider>
        </ToastProvider>
      </body>
    </html>
  );
}
