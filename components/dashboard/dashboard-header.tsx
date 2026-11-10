import Link from "next/link";
import Image from "next/image";
import { initials } from "@/lib/format";
import { NotificationBell } from "@/components/dashboard/notification-bell";
import { BranchSwitcher } from "@/components/branch/branch-switcher";
import type { BranchOption, BranchScope } from "@/lib/branch";
import { Icon } from "@/components/ui/icon";

export function DashboardHeader({
  branchName,
  fullName,
  hasUnread,
  profileId,
  canSwitchBranch,
  branches = [],
  activeBranchId = null,
  branchScope = "branch",
}: {
  branchName: string;
  fullName: string;
  hasUnread: boolean;
  profileId: string;
  canSwitchBranch: boolean;
  branches?: BranchOption[];
  activeBranchId?: string | null;
  branchScope?: BranchScope;
}) {
  return (
    <header className="sticky top-0 z-40 bg-surface/90 backdrop-blur-md shadow-[0_2px_4px_rgba(15,23,42,0.03)] px-gutter pt-safe lg:pt-3 pb-3">
      <div className="flex items-center justify-between gap-space-sm">
        {/* Branding: mobile only — desktop has sidebar branding */}
        <div className="flex items-center gap-space-sm min-w-0 lg:hidden">
          <Image
            src="/rb-logo-new.png"
            alt="RB AUTOLUXE"
            width={32}
            height={32}
            className="w-8 h-8 rounded-lg object-contain shrink-0"
            priority
          />
          <div className="flex flex-col min-w-0">
            <span className="font-headline-2 text-headline-2 text-text-primary tracking-tight truncate leading-tight">
              RB AUTOLUXE
            </span>
            {canSwitchBranch ? (
              <BranchSwitcher
                branches={branches}
                activeBranchId={activeBranchId}
                scope={branchScope}
                variant="header"
              />
            ) : (
              <span className="flex items-center gap-1 px-2 py-0.5 mt-0.5 rounded-full bg-brand-50 w-fit">
                <Icon name="storefront" className="text-[13px] text-brand-600" />
                <span className="font-caption text-caption text-brand-700 truncate max-w-[140px]">
                  {branchName}
                </span>
              </span>
            )}
          </div>
        </div>

        {/* Branch switcher: desktop only (branding lives in sidebar) */}
        {canSwitchBranch && (
          <div className="hidden lg:flex items-center gap-space-sm min-w-0">
            <BranchSwitcher
              branches={branches}
              activeBranchId={activeBranchId}
              scope={branchScope}
              variant="header"
            />
          </div>
        )}

        <div className="flex items-center gap-space-sm shrink-0">
          <NotificationBell />
          <Link
            href="/profil"
            aria-label="Buka profil"
            className="w-11 h-11 rounded-xl bg-brand-50 shadow-[inset_0px_2px_4px_rgba(255,255,255,0.95)] flex items-center justify-center active:scale-[0.98] transition-transform"
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