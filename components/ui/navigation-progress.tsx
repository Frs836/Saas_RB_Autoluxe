"use client";

import { useEffect, useState, useTransition } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import Image from "next/image";

/**
 * Provider global untuk menangkap event klik navigasi dan memberikan
 * visual feedback instan (top progress bar + loading overlay jika navigasi memakan waktu).
 */
export function NavigationProgressProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isNavigating, setIsNavigating] = useState(false);
  const [progress, setProgress] = useState(0);

  // Saat pathname atau searchParams berubah, navigasi selesai
  useEffect(() => {
    setIsNavigating(false);
    setProgress(100);
    const t = setTimeout(() => setProgress(0), 200);
    return () => clearTimeout(t);
  }, [pathname, searchParams]);

  // Pasang listener global untuk semua klik link
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      const target = (e.target as HTMLElement).closest("a");
      if (!target) return;

      const href = target.getAttribute("href");
      const targetAttr = target.getAttribute("target");

      // Abaikan link eksternal, anchor hash, atau new tab
      if (
        !href ||
        href.startsWith("#") ||
        href.startsWith("http") ||
        href.startsWith("mailto:") ||
        href.startsWith("tel:") ||
        targetAttr === "_blank" ||
        e.metaKey ||
        e.ctrlKey ||
        e.shiftKey
      ) {
        return;
      }

      // Jika URL tujuan berbeda dengan current URL, aktifkan loading bar
      const currentUrl = window.location.pathname + window.location.search;
      if (href !== currentUrl) {
        setIsNavigating(true);
        setProgress(30);

        // Simulasi progress bertahap agar user melihat gerakan
        const timer1 = setTimeout(() => setProgress(60), 250);
        const timer2 = setTimeout(() => setProgress(85), 700);

        return () => {
          clearTimeout(timer1);
          clearTimeout(timer2);
        };
      }
    }

    document.addEventListener("click", handleClick, { capture: true });
    return () => {
      document.removeEventListener("click", handleClick, { capture: true });
    };
  }, []);

  return (
    <>
      {/* Top Loading Progress Bar */}
      {progress > 0 && (
        <div
          className="fixed top-0 left-0 right-0 z-[99999] h-1 bg-transparent pointer-events-none transition-opacity duration-200"
          style={{ opacity: progress === 100 ? 0 : 1 }}
        >
          <div
            className="h-full bg-gradient-to-r from-brand-500 via-primary to-accent transition-all duration-300 ease-out shadow-[0_0_10px_rgba(37,99,235,0.7)]"
            style={{ width: `${progress}%` }}
          />
        </div>
      )}

      {/* Screen Dimmer / Loading Overlay saat navigasi berlangsung lebih dari 200ms */}
      {isNavigating && (
        <div className="fixed inset-0 z-[9998] flex items-center justify-center bg-black/25 backdrop-blur-[2px] transition-all duration-150 pointer-events-auto">
          <div className="bg-surface/95 border border-border px-5 py-4 rounded-2xl shadow-2xl flex items-center gap-3 clay-card animate-in fade-in zoom-in-95 duration-150">
            <div className="w-5 h-5 rounded-full border-2 border-primary border-t-transparent animate-spin" />
            <span className="font-body-bold text-body-bold text-text-primary text-sm">
              Membuka halaman...
            </span>
          </div>
        </div>
      )}

      {children}
    </>
  );
}
