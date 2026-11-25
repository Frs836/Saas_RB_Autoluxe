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
    <header className="sticky top-0 z-40 bg-white/80 backdrop-blur-md border-b border-border-subtle/80 shadow-[0_2px_10px_rgba(15,23,42,0.04)] pt-safe lg:pt-2">
      <div className="h-14 px-gutter lg:px-6 flex items-center justify-between gap-space-sm">
        <div className="flex items-center gap-space-sm min-w-0">
          <button
            type="button"
            onClick={handleBack}
            aria-label="Kembali"
            className="w-11 h-11 shrink-0 rounded-[8px] bg-surface-variant hover:bg-border-subtle flex items-center justify-center text-text-primary transition-colors duration-150"
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
