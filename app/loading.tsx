import Image from "next/image";

export default function Loading() {
  return (
    <div className="fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-surface/85 backdrop-blur-md px-4 transition-all duration-300">
      <div className="flex flex-col items-center gap-5">
        {/* Logo Container dengan Glow Shimmer */}
        <div className="relative flex items-center justify-center">
          <div className="absolute w-28 h-28 rounded-full bg-primary/20 blur-xl animate-pulse" />
          <div className="relative w-20 h-20 rounded-2xl bg-surface border border-border shadow-xl flex items-center justify-center p-3 overflow-hidden">
            <Image
              src="/rb-logo-new.png"
              alt="RB Autoluxe Logo"
              width={64}
              height={64}
              priority
              className="object-contain animate-bounce"
            />
          </div>
        </div>

        {/* Text & Spinner Status */}
        <div className="flex flex-col items-center gap-2 text-center">
          <h2 className="font-headline-3 text-headline-3 text-text-primary tracking-wide">
            RB AUTOLUXE
          </h2>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 rounded-full border-2 border-primary border-t-transparent animate-spin" />
            <p className="font-caption text-caption text-text-muted animate-pulse">
              Memuat data...
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
