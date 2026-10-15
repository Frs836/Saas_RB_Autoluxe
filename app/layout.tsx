import type { Metadata, Viewport } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import { ServiceWorkerRegistrar } from "@/components/mobile/service-worker-registrar";
import { ToastProvider } from "@/components/toast";
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
    icon: "/rb-logo-new.png",
    apple: "/rb-logo-new.png",
  },
};

export const viewport: Viewport = {
  themeColor: "#0f172a",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="id" className={plusJakartaSans.variable}>
      <head>
        {/*
         * Tidak ada preload font ikon lagi.
         *
         * Ikon dulunya memakai ligature font Material Symbols. Versi penuh
         * 3,9 MB, lalu dipangkas jadi subset. Subset itu harus diperbarui
         * setiap kali ada nama ikon baru, dan kalau ada yang terlewat, yang
         * tampil bukan ikon melainkan teks nama ikon itu mentah, misalnya
         * "DASHBOARD" atau "INSIGHTS".
         *
         * Ikon sekarang inline SVG dari components/ui/icon-paths.ts, jadi
         * tidak ada unduhan font sama sekali dan tidak ada yang bisa gagal
         * dimuat.
         */}
      </head>
      <body className="min-h-screen flex flex-col antialiased">
        <ToastProvider>
          <ServiceWorkerRegistrar />
          {children}
        </ToastProvider>
      </body>
    </html>
  );
}