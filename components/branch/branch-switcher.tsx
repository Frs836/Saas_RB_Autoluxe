"use client";

import { useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { setActiveBranch } from "@/app/actions/branch";
import { ALL_BRANCHES, type BranchOption, type BranchScope } from "@/lib/branch";
import { Icon } from "@/components/ui/icon";
import { Modal } from "@/components/ui/modal";

type Props = {
  branches: BranchOption[];
  activeBranchId: string | null;
  scope: BranchScope;
  variant: "header" | "wide";
  onError?: (message: string) => void;
};

export function BranchSwitcher({ branches, activeBranchId, scope, variant, onError }: Props) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<string | null>(null);

  const returnTo = pathname || "/dashboard";

  /*
   * Label cabang ikut berubah seketika saat dipilih, sebelum server selesai
   * menulis cookie. Sebelumnya label baru ikut berubah setelah seluruh
   * halaman dimuat ulang, sehingga menekan menu lain tampak seperti tidak
   * ada yang terjadi.
   */
  const [s, setS] = useState<string | null>(null);
  const scopeAktif = s ?? scope;
  const idAktif = s ?? activeBranchId;

  const currentLabel =
    scopeAktif === "all"
      ? "Seluruh Cabang"
      : (branches.find((b) => b.id === idAktif)?.name ?? "Cabang Utama");

  const options = branches.filter((branch) => branch.isActive);

  async function pick(value: string) {
    if (pending) return;
    setPending(value);
    setOpen(false);
    setS(value);

    try {
      const hasil = await setActiveBranch(value, returnTo);
      if (!hasil.ok) {
        setS(null);
        onError?.(hasil.reason);
        return;
      }
      router.refresh();
    } catch {
      // Apa pun galatnya, kembalikan ke nilai lama. Tanpa ini, state
      // optimistik membuat header menampilkan cabang yang tidak jadi
      // tersimpan.
      setS(null);
      onError?.("Gagal menyimpan pilihan cabang. Coba lagi.");
    } finally {
      setPending(null);
    }
  }

  const trigger = (
    <button
      type="button"
      onClick={() => setOpen((prev) => !prev)}
      aria-expanded={open}
      aria-haspopup="listbox"
      className={
        variant === "wide"
          ? "w-full flex items-center justify-between gap-2 h-11 px-3.5 rounded-[8px] border border-border bg-surface hover:bg-surface-container transition-colors"
          : "flex items-center gap-1.5 px-2.5 min-h-11 py-1.5 mt-0.5 rounded-[8px] border border-brand-200 bg-brand-50 hover:bg-brand-100 transition-colors max-w-[190px]"
      }
    >
      <span className="flex items-center gap-1 min-w-0">
        <Icon
          name={scope === "all" ? "public" : "storefront"}
          className={`text-brand-600 ${variant === "wide" ? "text-[18px]" : "text-[13px]"}`}
        />
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
      <Icon
        name="expand_more"
        className={`text-text-muted shrink-0 ${variant === "wide" ? "text-[18px]" : "text-[13px]"}`}
      />
    </button>
  );

  return (
    <div className={variant === "wide" ? "relative w-full" : "relative"}>
      {trigger}

      {open ? (
        <Modal open={open} onClose={() => setOpen(false)} title="Pilih Cabang">
          <div role="listbox" className="flex flex-col gap-0.5">
            <button
              type="button"
              role="option"
              aria-selected={scope === "all"}
              onClick={() => pick(ALL_BRANCHES)}
              className={`flex items-center gap-2 px-3 py-2.5 rounded-[8px] text-left font-caption text-caption transition-colors ${
                scope === "all"
                  ? "bg-brand-50 text-brand-700 font-bold"
                  : "text-text-secondary hover:bg-surface-container"
              }`}
            >
              <Icon name="public" className="text-[16px]" />
              <span className="flex-1">Seluruh Cabang</span>
              {scope === "all" ? (
                <Icon name="check" className="text-[16px]" />
              ) : null}
            </button>

            <div className="h-px bg-border my-0.5" />

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
                  className={`flex items-center gap-2 px-3 py-2.5 min-h-10 rounded-[8px] text-left font-caption text-caption transition-colors ${
                    active
                      ? "bg-brand-50 text-brand-700 font-bold"
                      : "text-text-secondary hover:bg-surface-container"
                  }`}
                >
                  <Icon name="storefront" className="text-[16px]" />
                  <span className="flex-1 truncate">{branch.name}</span>
                  {active ? (
                    <Icon name="check" className="text-[16px]" />
                  ) : null}
                </button>
              );
            })}

            <div className="h-px bg-border my-0.5" />

            <a
              href="/pengaturan/cabang"
              className="flex items-center gap-2 px-3 py-2.5 min-h-10 rounded-[8px] text-left font-caption text-caption text-text-secondary hover:bg-surface-container transition-colors"
            >
              <Icon name="tune" className="text-[16px]" />
              Pengaturan Cabang
            </a>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
