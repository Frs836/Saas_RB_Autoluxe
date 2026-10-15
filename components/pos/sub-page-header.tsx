import Link from "next/link";
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
  return (
    <header className="sticky top-0 z-40 bg-surface/90 backdrop-blur-md shadow-[0_1px_8px_rgba(0,0,0,0.04)] pt-safe">
      <div className="h-16 px-gutter flex items-center justify-between gap-space-sm">
        <div className="flex items-center gap-space-sm min-w-0">
          <Link
            href={backHref}
            aria-label="Kembali"
            // 11x11 bukan 10x10 supaya target sentuh mencapai 44px. Tombol kembali
            // dipakai di semua subhalaman, jadi ukuran ini berlaku di setiap layar.
            className="w-11 h-11 shrink-0 rounded-xl bg-surface-container-low flex items-center justify-center text-text-secondary active:scale-95 transition-transform shadow-[inset_0px_2px_4px_rgba(255,255,255,0.95)]"
          >
            <Icon name="arrow_back" className="text-[22px]" />
          </Link>
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
