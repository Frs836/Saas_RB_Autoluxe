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
      className="fixed inset-0 z-50 flex items-center justify-center px-4 bg-black/50 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-lg bg-surface rounded-[28px] p-5 flex flex-col gap-4 shadow-[0_8px_40px_rgba(0,0,0,0.2)] max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between shrink-0">
          <h2 className="font-headline-2 text-headline-2 text-text-primary">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Tutup"
            className="w-9 h-9 rounded-xl bg-surface-container-low flex items-center justify-center text-text-secondary active:scale-95"
          >
            <Icon name="close" className="text-[20px]" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
