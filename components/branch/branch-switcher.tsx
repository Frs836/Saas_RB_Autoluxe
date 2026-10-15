"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { setActiveBranch } from "@/app/actions/branch";
import { ALL_BRANCHES, type BranchOption, type BranchScope } from "@/lib/branch";

type Props = {
  branches: BranchOption[];
  activeBranchId: string | null;
  scope: BranchScope;
  variant: "header" | "wide";
};

export function BranchSwitcher({ branches, activeBranchId, scope, variant }: Props) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<string | null>(null);

  const returnTo = pathname || "/dashboard";

  const currentLabel =
    scope === "all"
      ? "Seluruh Cabang"
      : (branches.find((b) => b.id === activeBranchId)?.name ?? "Cabang Utama");

  const options = branches.filter((branch) => branch.isActive);

  async function pick(value: string) {
    if (pending) return;
    setPending(value);
    setOpen(false);
    await setActiveBranch(value, returnTo);
  }

  const trigger = (
    <button
      type="button"
      onClick={() => setOpen((prev) => !prev)}
      aria-expanded={open}
      aria-haspopup="listbox"
      className={
        variant === "wide"
          ? "w-full flex items-center justify-between gap-2 h-12 px-3 rounded-xl bg-surface-container-low shadow-[inset_0px_2px_4px_rgba(15,23,42,0.06)]"
          : /*
             * Varian header memakai min-h-11 dan padding yang lebih longgar.
             * Sebelumnya tinggi sebenarnya hanya 28px karena padding vertikal
             * tipis, padahal ini tombol yang dipakai untuk berpindah cabang
             * dan harus memenuhi luas sentuh minimum 44px.
             */
            "flex items-center gap-1.5 px-2.5 min-h-11 py-1.5 mt-0.5 rounded-full bg-brand-50 max-w-[190px]"
      }
    >
      <span className="flex items-center gap-1 min-w-0">
        <span
          className={`material-symbols-outlined text-brand-600 ${variant === "wide" ? "text-[18px]" : "text-[13px]"}`}
        >
          {scope === "all" ? "public" : "storefront"}
        </span>
        <span
          className={
            variant === "wide"
              ? "font-body text-body text-text-primary truncate"
              : "font-caption text-caption text-brand-700 truncate"
          }
        >
          {currentLabel}
        </span>
      </span>
      <span
        className={`material-symbols-outlined text-text-muted shrink-0 ${variant === "wide" ? "text-[18px]" : "text-[13px]"}`}
      >
        expand_more
      </span>
    </button>
  );

  return (
    <div className={variant === "wide" ? "relative w-full" : "relative"}>
      {trigger}

      {open ? (
        <>
          <button
            type="button"
            aria-label="Tutup pilihan cabang"
            className="fixed inset-0 z-30 cursor-default"
            onClick={() => setOpen(false)}
          />
          <div
            role="listbox"
            className="absolute z-40 mt-2 min-w-[220px] max-w-[85vw] right-0 rounded-2xl bg-surface p-1.5 clay-card flex flex-col gap-0.5"
          >
            <button
              type="button"
              role="option"
              aria-selected={scope === "all"}
              onClick={() => pick(ALL_BRANCHES)}
              className={`flex items-center gap-2 px-3 py-2.5 rounded-xl text-left font-caption text-caption ${
                scope === "all"
                  ? "bg-brand-50 text-brand-700"
                  : "text-text-secondary hover:bg-surface-container-low"
              }`}
            >
              <span className="material-symbols-outlined text-[16px]">public</span>
              <span className="flex-1">Seluruh Cabang</span>
              {scope === "all" ? (
                <span className="material-symbols-outlined text-[16px]">check</span>
              ) : null}
            </button>

            <div className="h-px bg-outline-variant my-0.5" />

            {options.length === 0 ? (
              <p className="px-3 py-2.5 font-caption text-caption text-text-muted">
                Belum ada cabang aktif.
              </p>
            ) : null}

            {options.map((branch) => {
              const active = scope === "branch" && branch.id === activeBranchId;
              return (
                <button
                  key={branch.id}
                  type="button"
                  role="option"
                  aria-selected={active}
                  onClick={() => pick(branch.id)}
                  className={`flex items-center gap-2 px-3 py-2.5 rounded-xl text-left font-caption text-caption ${
                    active
                      ? "bg-brand-50 text-brand-700"
                      : "text-text-secondary hover:bg-surface-container-low"
                  }`}
                >
                  <span className="material-symbols-outlined text-[16px]">storefront</span>
                  <span className="flex-1 truncate">{branch.name}</span>
                  {active ? (
                    <span className="material-symbols-outlined text-[16px]">check</span>
                  ) : null}
                </button>
              );
            })}

            <div className="h-px bg-outline-variant my-0.5" />

            <a
              href="/pengaturan/cabang"
              className="flex items-center gap-2 px-3 py-2.5 rounded-xl text-left font-caption text-caption text-text-secondary hover:bg-surface-container-low"
            >
              <span className="material-symbols-outlined text-[16px]">tune</span>
              Pengaturan Cabang
            </a>
          </div>
        </>
      ) : null}
    </div>
  );
}