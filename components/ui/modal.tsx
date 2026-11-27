"use client";
import { useEffect } from "react";
import { Icon } from "@/components/ui/icon";

export function Modal({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center p-3 sm:p-4 bg-slate-950/60 overflow-y-auto backdrop-blur-xs"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-lg bg-surface border border-border rounded-[10px] flex flex-col shadow-modal max-h-[88dvh] sm:max-h-[85vh] my-auto overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3.5 sm:px-5 sm:py-4 border-b border-border shrink-0 bg-surface">
          <h2 className="font-headline-2 text-headline-2 text-text-primary truncate pr-2">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Tutup"
            className="w-9 h-9 rounded-[8px] bg-surface-container-low hover:bg-surface-container flex items-center justify-center text-text-secondary transition-colors duration-150 shrink-0"
          >
            <Icon name="close" className="text-[20px]" />
          </button>
        </div>
        <div className="p-4 sm:p-5 overflow-y-auto flex-1 flex flex-col gap-4 overscroll-contain">
          {children}
        </div>
      </div>
    </div>
  );
}
