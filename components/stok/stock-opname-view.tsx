"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { formatAngka } from "@/lib/pos";
import { Icon } from "@/components/ui/icon";

export type OpnameLine = {
  id: string;
  item_id: string;
  item_name: string;
  unit: string;
  system_qty: number;
  physical_qty: number | null;
  difference: number | null;
  note: string | null;
};

export type OpnameRow = {
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
 * Modul opname fisik bulanan.
 *
 * Alur sengaja dua tahap. Angka fisik yang diketik manusia tidak langsung
 * mengubah saldo sistem. Operator menyimpan hitungan sebagai draf, lalu
 * mengirimnya, dan hanya saat itu saldo ikut dikoreksi dan setiap selisih
 * tercatat di log stok. Salah ketik satu angka tidak menghapus riwayat.
 */
export function StockOpnameView({
  opnames,
  linesByOpname,
  branchId,
  defaultPeriod,
}: {
  opnames: OpnameRow[];
  /** Baris hitungan dikelompokkan per id opname, bukan digabung datar. */
  linesByOpname: Record<string, OpnameLine[]>;
  branchId: string | null;
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
    /*
     * Kolom periode memakai input type="month", jadi nilainya "2026-10"
     * (tahun-bulan tanpa tanggal). open_stock_opname menerima date, bukan
     * text, jadi hari pertama bulan harus ditambahkan sendiri. Tanpa ini
     * Postgres menolak dengan "invalid input syntax for type date".
     */
    const periodeTanggal = /^\d{4}-\d{2}$/.test(period.trim())
      ? `${period.trim()}-01`
      : null;
    if (!periodeTanggal) {
      setBusy(false);
      setError("Pilih periode opname terlebih dahulu.");
      return;
    }

    const { data, error: rpcError } = await supabase.rpc("open_stock_opname", {
      p_branch_id: branchId,
      p_period_month: periodeTanggal,
      p_notes: null,
    });
    setBusy(false);

    if (rpcError) {
      setError(rpcError.message);
      return;
    }

    setSelectedId((data as { id: string }).id);
    setSuccess("Periode opname dibuka.");
    router.refresh();
  }, [branchId, period, router]);

  const saveCounts = useCallback(async () => {
    if (!selected) return;
    setError(null);
    setSuccess(null);
    setBusy(true);

    const payload = selectedLines.map((line) => ({
      item_id: line.item_id,
      physical_qty:
        counts[line.item_id] === undefined || counts[line.item_id] === ""
          ? null
          : Number(counts[line.item_id]),
      note: notes[line.item_id]?.trim() ? notes[line.item_id].trim() : null,
    }));

    const supabase = createClient();
    const { error: rpcError } = await supabase.rpc("save_stock_opname_lines", {
      p_opname_id: selected.id,
      p_lines: payload,
    });
    setBusy(false);

    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    setSuccess("Hitungan fisik disimpan sebagai draf.");
    router.refresh();
  }, [counts, notes, router, selected, selectedLines]);

  const submit = useCallback(async () => {
    if (!selected) return;
    setError(null);
    setSuccess(null);

    // Draf yang belum tersimpan akan hilang kalau dikirim langsung, jadi
    // hitungan fisik disimpan lebih dulu.
    if (selectedLines.some((line) => counts[line.item_id] !== undefined)) {
      const payload = selectedLines.map((line) => ({
        item_id: line.item_id,
        physical_qty:
          counts[line.item_id] === undefined || counts[line.item_id] === ""
            ? line.physical_qty
            : Number(counts[line.item_id]),
        note: notes[line.item_id]?.trim() ? notes[line.item_id].trim() : null,
      }));

      const supabase = createClient();
      const { error: saveError } = await supabase.rpc("save_stock_opname_lines", {
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
    const { error: rpcError } = await supabase.rpc("submit_stock_opname", {
      p_opname_id: selected.id,
      p_apply_adjustment: true,
    });
    setBusy(false);

    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    setSuccess("Opname dikirim. Selisih telah dikoreksi ke saldo sistem.");
    router.refresh();
  }, [counts, notes, router, selected, selectedLines]);

  if (!branchId) {
    return (
      <div className="px-gutter py-6">
        <div className="clay-card p-6 flex flex-col items-center gap-3 text-center">
          <Icon name="domain_disabled" className="text-[40px] text-warning-base" />
          <h2 className="font-headline-2 text-headline-2 text-text-primary">
            Pilih Satu Cabang
          </h2>
          <p className="font-caption text-caption text-text-secondary">
            Opname terikat pada satu cabang. Pilih cabang pada switcher di bagian
            atas untuk membuka periode opname.
          </p>
        </div>
      </div>
    );
  }

  return (
    /*
   * Ruang bawah memakai pb-nav karena halaman ini punya bilah aksi tetap
   * berisi Simpan Draf dan Kirim serta Koreksi. Nilai sebelumnya pb-28 hanya
   * memperhitungkan navigasi bawah, sehingga baris input terakhir tertutup
   * bilah aksi itu dan tidak bisa diketuk.
   */
  <div className="px-gutter py-4 pb-nav flex flex-col gap-4">
      <section className="clay-card p-4 flex items-center justify-between">
        <div>
          <h1 className="font-headline-2 text-headline-2 text-text-primary">
            Opname Fisik Bulanan
          </h1>
          <p className="font-caption text-caption text-text-muted">
            Bandingkan stok gudang dengan saldo sistem.
          </p>
        </div>
        <Icon name="fact_check" className="text-[28px] text-brand-600" />
      </section>

      <section className="clay-card p-4 flex flex-col gap-2">
        <label className="flex flex-col gap-1">
          <span className="font-caption text-caption text-text-muted">
            Periode opname
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
          className="h-11 rounded-xl primary-gradient text-on-primary font-body-bold text-body-bold flex items-center justify-center gap-2 active:scale-95 transition-transform disabled:opacity-60"
        >
          <Icon name="add" className="text-[20px]" />
          {busy ? "Membuka..." : "Buka atau Lanjutkan Opname"}
        </button>
      </section>

      {opnames.length > 0 ? (
        <section className="clay-card p-4 flex flex-col gap-2">
          <span className="font-body-bold text-body-bold text-text-primary">
            Riwayat opname
          </span>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {opnames.map((row) => (
              <button
                key={row.id}
                type="button"
                onClick={() => setSelectedId(row.id)}
                className={`px-3 py-2 rounded-xl font-caption text-caption whitespace-nowrap flex items-center gap-1.5 ${
                  row.id === selectedId
                    ? "bg-brand-50 text-brand-700"
                    : "bg-surface-container-low text-text-secondary"
                }`}
              >
                <Icon name={row.status === "submitted"
                    ? "task_alt"
                    : row.status === "cancelled"
                      ? "cancel"
                      : "pending"} className="text-[15px]" />
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

      {selected ? (
        <section className="clay-card p-4 flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <span className="font-body-bold text-body-bold text-text-primary">
              Hitung fisik {periodLabel(selected.period_month)}
            </span>
            <span className="px-2 py-0.5 rounded-full bg-surface-container text-text-secondary font-micro-badge text-micro-badge">
              {readOnly ? "Sudah dikirim" : "Draf"}
            </span>
          </div>

          {selectedLines.length === 0 ? (
            <p className="font-caption text-caption text-text-muted">
              Belum ada item stok pada cabang ini.
            </p>
          ) : (
            selectedLines.map((line) => {
              const draftValue = counts[line.item_id];
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

              return (
                <div
                  key={line.id}
                  className="rounded-xl bg-surface-container-low p-3 flex flex-col gap-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-body text-body text-text-primary">
                      {line.item_name}
                    </span>
                    <span className="font-micro-badge text-micro-badge text-text-muted">
                      sistem {formatAngka(line.system_qty)} {line.unit}
                    </span>
                  </div>

                  <div className="flex gap-2 items-center">
                    <input
                      value={shown}
                      onChange={(e) =>
                        setCounts((prev) => ({ ...prev, [line.item_id]: e.target.value }))
                      }
                      disabled={readOnly}
                      inputMode="decimal"
                      placeholder="jumlah fisik"
                      className="flex-1 h-11 px-3 rounded-lg bg-surface font-body-mono text-body text-text-primary outline-none focus:ring-2 focus:ring-brand-400 disabled:opacity-60"
                    />
                    {delta !== null && delta !== 0 ? (
                      <span
                        className={`px-2 py-1 rounded-lg font-micro-badge text-micro-badge ${
                          delta < 0
                            ? "bg-danger-surface text-danger-text"
                            : "bg-success-surface text-success-text"
                        }`}
                      >
                        {delta > 0 ? "+" : ""}
                        {delta}
                      </span>
                    ) : null}
                  </div>

                  {!readOnly ? (
                    <input
                      value={notes[line.item_id] ?? line.note ?? ""}
                      onChange={(e) =>
                        setNotes((prev) => ({ ...prev, [line.item_id]: e.target.value }))
                      }
                      placeholder="Catatan (opsional)"
                      className="h-10 px-3 rounded-lg bg-surface font-caption text-caption text-text-primary outline-none focus:ring-2 focus:ring-brand-400"
                    />
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
        <div className="fixed bottom-nav-offset left-0 right-0 z-action-bar px-gutter pb-3 pt-3 bg-surface/95 backdrop-blur-md border-t border-outline-variant flex gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={saveCounts}
            className="flex-1 py-3.5 rounded-2xl bg-surface-container text-text-secondary font-body-bold text-body-bold flex items-center justify-center gap-1.5 active:scale-95 transition-transform disabled:opacity-60"
          >
            <Icon name="save" className="text-[20px]" />
            Simpan Draf
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={submit}
            className="flex-1 py-3.5 rounded-2xl primary-gradient text-on-primary font-body-bold text-body-bold flex items-center justify-center gap-1.5 active:scale-95 transition-transform disabled:opacity-60"
          >
            <Icon name={busy ? "hourglass_top" : "task_alt"} className="text-[20px]" />
            Kirim dan Koreksi
          </button>
        </div>
      ) : null}
    </div>
  );
}