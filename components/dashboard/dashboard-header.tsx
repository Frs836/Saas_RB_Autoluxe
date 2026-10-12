import Link from "next/link";
import { initials } from "@/lib/format";
import { NotificationBell } from "@/components/dashboard/notification-bell";

export function DashboardHeader({
  branchName,
  fullName,
  hasUnread,
  profileId,
}: {
  branchName: string;
  fullName: string;
  hasUnread: boolean;
  profileId: string;
}) {
  return (
    <header className="sticky top-0 z-40 bg-surface/90 backdrop-blur-md shadow-[0_2px_4px_rgba(15,23,42,0.03)] px-gutter py-3">
      <div className="flex items-center justify-between gap-space-sm">
        <div className="flex items-center gap-space-sm min-w-0">
          <div className="w-8 h-8 rounded-lg bg-surface-container-low flex items-center justify-center shrink-0 p-1 shadow-[inset_0px_2px_4px_rgba(255,255,255,0.95)]">
            <svg className="w-full h-full text-brand-600" fill="none" viewBox="0 0 40 40">
              <path
                d="M6 28L14 12H26L21 21H31L19 32L21 25H11L6 28Z"
                fill="currentColor"
              />
            </svg>
          </div>
          <div className="flex flex-col min-w-0">
            <span className="font-headline-2 text-headline-2 text-text-primary tracking-tight truncate leading-tight">
              RB AUTOLUXE
            </span>
            <span className="flex items-center gap-1 px-2 py-0.5 mt-0.5 rounded-full bg-brand-50 w-fit">
              <span className="material-symbols-outlined text-[13px] text-brand-600">
                storefront
              </span>
              <span className="font-caption text-caption text-brand-700 truncate max-w-[140px]">
                {branchName}
              </span>
            </span>
          </div>
        </div>

        <div className="flex items-center gap-space-sm shrink-0">
          <NotificationBell profileId={profileId} hasUnread={hasUnread} />
          <Link
            href="/profil"
            aria-label="Buka profil"
            className="w-9 h-9 rounded-xl bg-brand-50 shadow-[inset_0px_2px_4px_rgba(255,255,255,0.95)] flex items-center justify-center active:scale-[0.98] transition-transform"
          >
            <span className="font-body-bold text-body-bold text-brand-600">
              {initials(fullName)}
            </span>
          </Link>
        </div>
      </div>
    </header>
  );
}
