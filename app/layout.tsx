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
         * Font ikon dilayani sendiri dari /public, bukan dari Google Fonts.
         *
         * Versi penuh Material Symbols berukuran 3,9 MB dan stylesheet-nya
         * memblokir render, jadi setiap halaman menunggu berkas sebesar itu
         * hanya untuk menampilkan ikon daftar dan roda gigi. Subset yang
         * dipakai aplikasi berukuran 12 KB, dilayani dari domain yang sama
         * tanpa permintaan DNS dan TLS tambahan.
         *
         * Preload membuat unduhan dimulai paralel dengan CSS, dan
         * font-display: swap membuat teks tetap tampil sebelum font tiba.
         */}
        <link
          rel="preload"
          href="/fonts/material-symbols-subset.woff2"
          as="font"
          type="font/woff2"
          crossOrigin="anonymous"
        />
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