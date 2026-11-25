"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { formatAngka } from "@/lib/pos";
import { Icon } from "@/components/ui/icon";
import { exportBundleOpnameToExcel, type BundleOpnameExportItem } from "@/lib/export-opname";

export type BundleOpnameLine = {
  id: string;
  bundle_id: string;
  bundle_name: string;
  unit: string;
  output_qty: number;
  hpp_per_unit?: number | null;
  total_batch_cost?: number | null;
  formula_preview?: string | null;
  system_qty: number;
  physical_qty: number | null;
  difference: number | null;
  note: string | null;
};

export type BundleOpnameRow = {
  id: string;
  period_month: string;
  status: "draft" | "submitted" | "cancelled";
  notes: string | null;
  submitted_at: string | null;
  created_at: string;
  line_count: number;
  counted_count: number;
};

function periodLabel(period: string): string {
  const [year, month] = period.split("-");
  const names = [
    "Januari", "Februari", "Maret", "April", "Mei", "Juni",
    "Juli", "Agustus", "September", "Oktober", "November", "Desember",
  ];
  const index = Number(month) - 1;
  return `${names[index] ?? month} ${year}`;
}

/**
 * Modul opname fisik bulanan stok racikan.
 *
 * Alur 2-tahap identik dengan opname stok utama:
 * Operator menginput angka fisik riil di rak bengkel, menyimpan draf,
 * lalu mengirim untuk rekonsiliasi otomatis ke saldo sistem racikan.
 */
export function BundleOpnameView({
  opnames,
  linesByOpname,
  branchId,
  branchName = "Cabang Utama",
  defaultPeriod,
}: {
  opnames: BundleOpnameRow[];
  linesByOpname: Record<string, BundleOpnameLine[]>;
  branchId: string | null;
  branchName?: string;
  defaultPeriod: string;
}) {
  const router = useRouter();
  const [period, setPeriod] = useState(defaultPeriod);
  const [selectedId, setSelectedId] = useState<string>(opnames[0]?.id ?? "");
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const selected = opnames.find((row) => row.id === selectedId) ?? null;
  const selectedLines = selected ? (linesByOpname[selected.id] ?? []) : [];
  const readOnly = selected ? selected.status !== "draft" : true;

  const openOpname = useCallback(async () => {
    if (!branchId) return;
    setError(null);
    setSuccess(null);
    setBusy(true);

    const supabase = createClient();
    const periodeTanggal = /^\d{4}-\d{2}$/.test(period.trim())
      ? `${period.trim()}-01`
      : null;
    if (!periodeTanggal) {
      setBusy(false);
      setError("Pilih periode opname terlebih dahulu.");
      return;
    }

    const { data, error: rpcError } = await (supabase as any).rpc("open_bundle_stock_opname", {
      p_branch_id: branchId,
      p_period_month: periodeTanggal,
      p_notes: null,
    });
    setBusy(false);

    if (rpcError) {
      setError(rpcError.message);
      return;
    }

    const newId = (data as { id: string })?.id ?? (data as string);
    setSelectedId(newId);
    setSuccess("Periode opname racikan dibuka.");
    router.refresh();
  }, [branchId, period, router]);

  const saveCounts = useCallback(async () => {
    if (!selected) return;
    setError(null);
    setSuccess(null);
    setBusy(true);

    const payload = selectedLines.map((line) => ({
      bundle_id: line.bundle_id,
      physical_qty:
        counts[line.bundle_id] === undefined || counts[line.bundle_id] === ""
          ? null
          : Number(counts[line.bundle_id]),
      note: notes[line.bundle_id]?.trim() ? notes[line.bundle_id].trim() : null,
    }));

    const supabase = createClient();
    const { error: rpcError } = await (supabase as any).rpc("save_bundle_opname_lines", {
      p_opname_id: selected.id,
      p_lines: payload,
    });
    setBusy(false);

    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    setSuccess("Hitungan fisik racikan disimpan sebagai draf.");
    router.refresh();
  }, [counts, notes, router, selected, selectedLines]);

  const submit = useCallback(async () => {
    if (!selected) return;
    setError(null);
    setSuccess(null);

    // Pastikan perubahan terbaru tersimpan sebelum kirim
    if (selectedLines.some((line) => counts[line.bundle_id] !== undefined)) {
      const payload = selectedLines.map((line) => ({
        bundle_id: line.bundle_id,
        physical_qty:
          counts[line.bundle_id] === undefined || counts[line.bundle_id] === ""
            ? line.physical_qty
            : Number(counts[line.bundle_id]),
        note: notes[line.bundle_id]?.trim() ? notes[line.bundle_id].trim() : null,
      }));

      const supabase = createClient();
      const { error: saveError } = await (supabase as any).rpc("save_bundle_opname_lines", {
        p_opname_id: selected.id,
        p_lines: payload,
      });
      if (saveError) {
        setBusy(false);
        setError(saveError.message);
        return;
      }
    }

    setBusy(true);
    const supabase = createClient();
    const { error: rpcError } = await (supabase as any).rpc("submit_bundle_stock_opname", {
      p_opname_id: selected.id,
      p_apply_adjustment: true,
    });
    setBusy(false);

    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    setSuccess("Opname racikan dikirim. Saldo stok racikan telah dikoreksi.");
    router.refresh();
  }, [counts, notes, router, selected, selectedLines]);

  const handleExportExcel = useCallback(() => {
    if (!selected) return;

    const exportItems: BundleOpnameExportItem[] = selectedLines.map((line) => {
      const draftVal = counts[line.bundle_id];
      const physical =
        draftVal !== undefined && draftVal !== ""
          ? Number(draftVal)
          : line.physical_qty;
      const note = notes[line.bundle_id] !== undefined ? notes[line.bundle_id] : line.note;
      const diff =
        physical !== null ? physical - line.system_qty : line.difference;

      return {
        bundle_name: line.bundle_name,
        unit: line.unit,
        output_qty: line.output_qty,
        formula_preview: line.formula_preview,
        system_qty: line.system_qty,
        physical_qty: physical,
        difference: diff,
        hpp_per_unit: line.hpp_per_unit,
        total_batch_cost: line.total_batch_cost,
        note: note,
      };
    });

    exportBundleOpnameToExcel({
      branchName: branchName || "Cabang",
      periodMonth: selected.period_month,
      status: selected.status,
      items: exportItems,
    });
  }, [selected, selectedLines, counts, notes, branchName]);

  if (!branchId) {
    return (
      <div className="px-gutter py-6">
        <div className="clay-card p-6 flex flex-col items-center gap-3 text-center">
          <Icon name="domain_disabled" className="text-[40px] text-warning-base" />
          <h2 className="font-headline-2 text-headline-2 text-text-primary">
            Pilih Satu Cabang
          </h2>
          <p className="font-caption text-caption text-text-secondary">
            Opname racikan terikat pada satu cabang. Pilih cabang pada switcher di bagian
            atas untuk membuka periode opname racikan.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="px-gutter py-4 pb-48 lg:pb-36 flex flex-col gap-4 lg:grid lg:grid-cols-3 lg:gap-6 lg:items-start lg:px-6 lg:py-6">
      {/* Left column: Kontrol Periode & Riwayat */}
      <div className="lg:col-span-1 flex flex-col gap-4">
        <section className="clay-card p-4 flex items-center justify-between">
          <div>
            <h1 className="font-headline-2 text-headline-2 text-text-primary">
              Opname Stok Racikan
            </h1>
            <p className="font-caption text-caption text-text-muted">
              Bandingkan stok fisik di rak dengan saldo sistem.
            </p>
          </div>
          <Icon name="science" className="text-[28px] text-brand-600" />
        </section>

        <section className="clay-card p-4 flex flex-col gap-2">
          <label className="flex flex-col gap-1">
            <span className="font-caption text-caption text-text-muted">
              Periode opname racikan
            </span>
            <input
              type="month"
              value={period}
              onChange={(e) => setPeriod(e.target.value)}
              className="h-12 px-3 rounded-xl bg-surface-container-low font-body-mono text-body text-text-primary outline-none focus:ring-2 focus:ring-brand-400"
            />
          </label>
          <button
            type="button"
            disabled={busy}
            onClick={openOpname}
            className="h-11 rounded-[8px] primary-gradient clay-glow text-on-primary font-body-bold text-body-bold flex items-center justify-center gap-2 hover:opacity-95 transition-opacity disabled:opacity-60 shadow-sm"
          >
            <Icon name="add" className="text-[20px]" />
            {busy ? "Membuka..." : "Buka atau Lanjutkan Opname"}
          </button>
        </section>

        {opnames.length > 0 ? (
          <section className="clay-card p-4 flex flex-col gap-2">
            <span className="font-body-bold text-body-bold text-text-primary">
              Riwayat opname racikan
            </span>
            <div className="flex gap-2 overflow-x-auto pb-1">
              {opnames.map((row) => (
                <button
                  key={row.id}
                  type="button"
                  onClick={() => setSelectedId(row.id)}
                  className={`px-3 py-2 rounded-xl font-caption text-caption whitespace-nowrap flex items-center gap-1.5 transition-all ${
                    row.id === selectedId
                      ? "bg-brand-50 text-brand-700 font-semibold ring-1 ring-brand-300"
                      : "bg-surface-container-low text-text-secondary hover:bg-surface-container"
                  }`}
                >
                  <Icon
                    name={
                      row.status === "submitted"
                        ? "task_alt"
                        : row.status === "cancelled"
                          ? "cancel"
                          : "pending"
                    }
                    className="text-[15px]"
                  />
                  {periodLabel(row.period_month)}
                  <span className="opacity-70">
                    ({row.counted_count}/{row.line_count})
                  </span>
                </button>
              ))}
            </div>
          </section>
        ) : null}

        {error ? (
          <p className="rounded-xl bg-danger-surface text-danger-text p-3 font-caption text-caption">
            {error}
          </p>
        ) : null}
        {success ? (
          <p className="rounded-xl bg-success-surface text-success-text p-3 font-caption text-caption">
            {success}
          </p>
        ) : null}
      </div>

      {/* Right column: Detail tabel racikan */}
      <div className="lg:col-span-2 flex flex-col gap-4">
        {selected ? (
          <section className="clay-card p-4 flex flex-col gap-3">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <span className="font-body-bold text-body-bold text-text-primary">
                Hitung fisik racikan {periodLabel(selected.period_month)}
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleExportExcel}
                  className="h-8 px-2.5 rounded-[8px] bg-brand-50 hover:bg-brand-100 text-brand-700 font-caption text-caption font-semibold flex items-center gap-1.5 transition-colors border border-brand-200/60 shadow-sm"
                  title="Download Laporan Stok Opname Racikan (.xlsx)"
                >
                  <Icon name="download" className="text-[16px]" />
                  Export Excel
                </button>
                <span className="px-2.5 py-0.5 rounded-[6px] bg-surface-container border border-border-subtle text-text-secondary font-micro-badge text-micro-badge">
                  {readOnly ? "Sudah dikirim" : "Draf"}
                </span>
              </div>
            </div>

            {selectedLines.length === 0 ? (
              <p className="font-caption text-caption text-text-muted">
                Belum ada resep racikan aktif pada cabang ini. Silakan buat racikan terlebih dahulu di Kelola Racikan.
              </p>
            ) : (
              selectedLines.map((line) => {
                const draftValue = counts[line.bundle_id];
                const shown =
                  draftValue !== undefined
                    ? draftValue
                    : line.physical_qty === null
                      ? ""
                      : String(line.physical_qty);
                const physical = shown === "" ? null : Number(shown);
                const delta =
                  physical === null || !Number.isFinite(physical)
                    ? null
                    : Math.round((physical - line.system_qty) * 100) / 100;

                const cost = Number(line.hpp_per_unit || 0);
                const costDiff = delta !== null && cost > 0 ? Math.round(delta * cost) : null;

                return (
                  <div
                    key={line.id}
                    className="rounded-[10px] border border-border-subtle bg-surface-container-low/70 p-3.5 flex flex-col gap-2.5 shadow-sm"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex flex-col min-w-0">
                        <div className="flex items-center gap-1.5">
                          <Icon name="science" className="text-[16px] text-brand-600 shrink-0" />
                          <span className="font-body-bold text-body-bold text-text-primary truncate">
                            {line.bundle_name}
                          </span>
                        </div>
                        {line.formula_preview ? (
                          <span className="text-[11px] text-text-muted mt-0.5">
                            Formula: {line.formula_preview}
                          </span>
                        ) : null}
                        {cost > 0 ? (
                          <span className="text-[11px] text-text-muted">
                            HPP per {line.unit}: Rp {formatAngka(cost)}
                          </span>
                        ) : null}
                      </div>

                      <div className="flex flex-col items-end shrink-0">
                        <span className="font-caption text-caption text-text-muted">Stok Sistem</span>
                        <span className="font-body-bold text-body-bold text-text-primary">
                          {formatAngka(line.system_qty)} {line.unit}
                        </span>
                      </div>
                    </div>

                    <div className="flex gap-2 items-center">
                      <div className="flex-1 relative">
                        <input
                          value={shown}
                          onChange={(e) =>
                            setCounts((prev) => ({ ...prev, [line.bundle_id]: e.target.value }))
                          }
                          disabled={readOnly}
                          inputMode="decimal"
                          placeholder={`Fisik riil di rak (${line.unit})`}
                          className="w-full h-11 px-3 rounded-xl bg-surface font-body-mono text-body text-text-primary outline-none focus:ring-2 focus:ring-brand-400 disabled:opacity-60 border border-border-subtle"
                        />
                      </div>
                      {delta !== null ? (
                        <div className="flex flex-col items-end shrink-0">
                          <span
                            className={`px-2.5 py-1 rounded-xl font-caption text-caption font-semibold flex items-center gap-1 ${
                              delta === 0
                                ? "bg-success-surface text-success-text"
                                : delta < 0
                                  ? "bg-danger-surface text-danger-text"
                                  : "bg-warning-surface text-warning-text"
                            }`}
                          >
                            <Icon
                              name={delta === 0 ? "check" : delta < 0 ? "trending_down" : "trending_up"}
                              className="text-[14px]"
                            />
                            {delta > 0 ? "+" : ""}
                            {formatAngka(delta)} {line.unit}
                          </span>
                          {costDiff !== null && costDiff !== 0 ? (
                            <span
                              className={`text-[10px] font-bold mt-0.5 ${
                                costDiff < 0 ? "text-danger-text" : "text-warning-text"
                              }`}
                            >
                              {costDiff > 0 ? "+" : ""}Rp {Math.abs(costDiff).toLocaleString("id-ID")}
                            </span>
                          ) : null}
                        </div>
                      ) : null}
                    </div>

                    {!readOnly ? (
                      <input
                        value={notes[line.bundle_id] ?? line.note ?? ""}
                        onChange={(e) =>
                          setNotes((prev) => ({ ...prev, [line.bundle_id]: e.target.value }))
                        }
                        placeholder="Alasan selisih (contoh: tumpah, botol pecah, penguapan, salah tuang...)"
                        className="h-10 px-3 rounded-xl bg-surface font-caption text-caption text-text-primary outline-none focus:ring-2 focus:ring-brand-400 border border-border-subtle/80 placeholder:text-text-muted"
                      />
                    ) : line.note ? (
                      <div className="p-2 rounded-xl bg-surface/80 text-[11px] text-text-secondary italic border border-border-subtle/50">
                        Catatan: {line.note}
                      </div>
                    ) : null}
                  </div>
                );
              })
            )}

            {readOnly ? (
              <div className="flex flex-col gap-1">
                <span className="font-caption text-caption text-text-secondary">
                  dikirim {new Date(selected.submitted_at ?? selected.created_at).toLocaleString("id-ID")}
                </span>
                {selected.notes ? (
                  <span className="font-caption text-caption text-text-muted">
                    {selected.notes}
                  </span>
                ) : null}
              </div>
            ) : null}
          </section>
        ) : null}

        {selected && !readOnly ? (
          <div className="fixed bottom-nav-offset left-0 right-0 z-action-bar px-gutter pb-3 pt-3 bg-surface/95 backdrop-blur-md border-t border-outline-variant flex gap-2 lg:left-[72px] lg:px-6">
            <button
              type="button"
              disabled={busy}
              onClick={saveCounts}
              className="flex-1 py-3.5 lg:py-2.5 rounded-[8px] bg-surface-container text-text-secondary font-body-bold text-body-bold flex items-center justify-center gap-1.5 disabled:opacity-60"
            >
              <Icon name="save" className="text-[20px]" />
              Simpan Draf
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={submit}
              className="flex-1 py-3.5 lg:py-2.5 rounded-[8px] primary-gradient clay-glow text-on-primary font-body-bold text-body-bold flex items-center justify-center gap-1.5 disabled:opacity-60"
            >
              <Icon name={busy ? "hourglass_top" : "task_alt"} className="text-[20px]" />
              Kirim dan Koreksi
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
