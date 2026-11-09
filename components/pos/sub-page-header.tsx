"use client";

import { useRouter } from "next/navigation";
import { Icon } from "@/components/ui/icon";

export function SubPageHeader({
  title,
  subtitle,
  branchName,
  backHref = "/dashboard",
  rightSlot,
}: {
  title: string;
  subtitle?: string;
  branchName?: string;
  backHref?: string;
  rightSlot?: React.ReactNode;
}) {
  const router = useRouter();

  function handleBack() {
    // Jika ada history sebelumnya di browser, gunakan back() agar
    // user kembali ke halaman sebelumnya (bukan selalu ke dashboard).
    // Fallback ke backHref jika history kosong (tab baru / deep link langsung).
    if (typeof window !== "undefined" && window.history.length > 1) {
      router.back();
    } else {
      router.push(backHref);
    }
  }

  return (
    <header className="sticky top-0 z-40 bg-surface/90 backdrop-blur-md shadow-[0_1px_8px_rgba(0,0,0,0.04)] pt-safe">
      <div className="h-16 px-gutter flex items-center justify-between gap-space-sm">
        <div className="flex items-center gap-space-sm min-w-0">
          <button
            type="button"
            onClick={handleBack}
            aria-label="Kembali"
            // 11×11 supaya target sentuh mencapai 44px
            className="w-11 h-11 shrink-0 rounded-xl bg-surface-container-low flex items-center justify-center text-text-secondary active:scale-95 transition-transform shadow-[inset_0px_2px_4px_rgba(255,255,255,0.95)]"
          >
            <Icon name="arrow_back" className="text-[22px]" />
          </button>
          <div className="flex flex-col min-w-0">
            <h1 className="font-headline-2 text-headline-2 text-text-primary truncate">{title}</h1>
            {(subtitle || branchName) && (
              <p className="font-caption text-caption text-text-muted truncate">
                {subtitle || branchName}
              </p>
            )}
          </div>
        </div>
        {rightSlot}
      </div>
    </header>
  );
}
