import Image from "next/image";
import { Icon } from "@/components/ui/icon";

export function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="relative flex-1 flex flex-col items-center justify-center overflow-hidden px-gutter py-space-lg">
      <div className="absolute -top-24 -left-20 w-80 h-80 rounded-full bg-brand-200/40 blur-3xl pointer-events-none" />
      <div className="absolute -bottom-24 -right-20 w-96 h-96 rounded-full bg-brand-100/60 blur-3xl pointer-events-none" />

      <div className="w-full max-w-[420px] relative z-10 flex flex-col gap-6">
        <div className="flex items-center justify-between w-full px-2">
          <div className="flex items-center gap-1.5 py-1 px-3 rounded-full bg-surface/80 backdrop-blur shadow-sm">
            <span className="w-2 h-2 rounded-full bg-success-base animate-pulse" />
            <span className="font-caption text-caption text-text-secondary">
              Cabang: Auto-Detect
            </span>
          </div>
          <div className="flex items-center gap-1.5 py-1 px-3 rounded-full bg-surface/90 backdrop-blur shadow-sm">
            <span className="w-2 h-2 rounded-full bg-success-base" />
            <span className="font-micro-badge text-micro-badge uppercase tracking-wider text-success-text font-bold">
              System Online • v2.0
            </span>
          </div>
        </div>

        <div className="flex flex-col items-center text-center">
          <div className="relative flex items-center justify-center p-3 mb-3 bg-surface rounded-2xl shadow-sm">
            <Image
              src="/rb-logo-new.png"
              alt="RB AUTOLUXE Logo"
              width={44}
              height={44}
              className="h-11 w-11 object-contain"
              priority
            />
          </div>
          <h1 className="font-headline-1 text-headline-1 text-text-primary tracking-tight">
            RB AUTOLUXE
          </h1>
          <p className="font-caption text-caption text-text-secondary mt-1">
            Sistem Operasional &amp; POS Multi-Cabang
          </p>
        </div>

        {children}

        <div className="flex flex-col items-center text-center gap-2 px-4 pb-2">
          <div className="flex items-center gap-1.5 text-text-secondary font-caption text-caption">
            <Icon name="security" className="text-[16px] text-brand-600" />
            <span>Hak Akses Terproteksi Supabase RLS</span>
          </div>
          <p className="font-micro-badge text-micro-badge text-text-muted uppercase tracking-wider">
            © 2026 RB AUTOLUXE. Operational System v2.0 - Multi-Branch Edition
          </p>
        </div>
      </div>
    </main>
  );
}
