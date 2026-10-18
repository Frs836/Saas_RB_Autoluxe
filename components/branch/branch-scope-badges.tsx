"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setActiveBranch } from "@/app/actions/branch";
import { ALL_BRANCHES, type BranchOption } from "@/lib/branch";
import { Icon } from "@/components/ui/icon";

/**
 * Badge cakupan cabang: "Semua" lalu satu badge per cabang.
 *
 * Laporan, stok, dan rekap semuanya dihitung per cabang, tapi dari jauh hanya
 * terlihat satu angka gabungan. Badge ini membuat cakupan yang sedang dibaca
 * selalu terlihat, jadi tidak ada lagi angka yang tidak jelas berasal dari
 * cabang mana.
 *
 * Role tanpa izin branch.switch tidak menerima daftar cabang sama sekali dari
 * server, jadi komponen ini tidak pernah muncul untuk mereka dan angka yang
 * tampil otomatis hanya berisi cabang tempat mereka bertugas.
 */
export function BranchScopeBadges({
  branches,
  activeBranchId,
  showAll = true,
  labelSemua = "Semua Cabang",
}: {
  branches: BranchOption[];
  activeBranchId: string | null;
  showAll?: boolean;
  labelSemua?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  // Label aktif menunggu cookie baru diterima server supaya tidak sempat
  // menampilkan cabang yang ternyata tidak jadi tersimpan.
  const [optimis, setOptimis] = useState<string | null>(null);
  const [galat, setGalat] = useState<string | null>(null);

  const idAktif = optimis ?? activeBranchId ?? ALL_BRANCHES;

  async function pilih(value: string) {
    if (pending || value === idAktif) return;
    setGalat(null);
    setOptimis(value);
    const hasil = await setActiveBranch(value);
    if (!hasil.ok) {
      setOptimis(null);
      setGalat(hasil.reason);
      return;
    }
    startTransition(() => router.refresh());
  }

  const opsi = branches.filter((b) => b.isActive);
  if (opsi.length === 0) return null;

  return (
    <div className="px-gutter pt-3 flex flex-col gap-2">
      <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
        {showAll ? (
          <button
            type="button"
            onClick={() => pilih(ALL_BRANCHES)}
            disabled={pending}
            className={`shrink-0 min-h-10 px-3.5 rounded-full font-body-bold text-body-bold flex items-center gap-1.5 active:scale-95 transition-transform disabled:opacity-60 ${
              idAktif === ALL_BRANCHES
                ? "bg-brand-600 text-white"
                : "bg-surface text-text-secondary"
            }`}
          >
            <Icon name="public" className="text-[16px]" />
            {labelSemua}
          </button>
        ) : null}

        {opsi.map((b) => (
          <button
            key={b.id}
            type="button"
            onClick={() => pilih(b.id)}
            disabled={pending}
            className={`shrink-0 min-h-10 px-3.5 rounded-full font-body-bold text-body-bold flex items-center gap-1.5 active:scale-95 transition-transform disabled:opacity-60 ${
              idAktif === b.id
                ? "bg-brand-600 text-white"
                : "bg-surface text-text-secondary"
            }`}
          >
            <Icon name="storefront" className="text-[16px]" />
            {b.name}
          </button>
        ))}
      </div>

      {galat ? (
        <p className="font-micro-badge text-micro-badge text-danger-text">
          {galat}
        </p>
      ) : null}
    </div>
  );
}