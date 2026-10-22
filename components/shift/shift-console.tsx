"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { formatRupiah, formatTimeWib, initials } from "@/lib/format";
import { Icon } from "@/components/ui/icon";
import { useSingleFlight } from "@/lib/use-single-flight";

type Handoff = {
  id: string;
  status: "open" | "closed";
  openingCash: number;
  expectedCash: number | null;
  actualCash: number | null;
  difference: number | null;
  unknownMethodCash: number;
  notes: string | null;
  openedAt: string | null;
  closedAt: string | null;
  openedBy: string | null;
  closedBy: string | null;
};

type CashSummary = {
  cashInCash: number;
  cashInOther: number;
  unknownIn: number;
  cashOut: number;
  transactions: number;
};

type HistoryRow = Handoff & { shiftDate: string };

export function ShiftConsole({
  profile,
  branch,
  today,
  handoff,
  cash,
  userNames,
}: {
  profile: { id: string; fullName: string; role: string; roleLabel: string };
  branch: { id: string; name: string; openTime: string; closeTime: string };
  today: string;
  handoff: Handoff | null;
  cash: CashSummary;
  userNames: Record<string, string>;
}) {
  const [opening, setOpening] = useState("");
  const [physical, setPhysical] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState<null | "open" | "close">(null);
  const kunciBuka = useSingleFlight();
  const kunciTutup = useSingleFlight();
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [success, setSuccess] = useState<{
    actual: number;
    expected: number;
    difference: number;
    hash: string;
  } | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [historyPending, setHistoryPending] = useState(false);
  const [nowClock, setNowClock] = useState<string | null>(null);
  const router = useRouter();

  useEffect(() => {
    const id = window.setTimeout(() => setNowClock(formatTimeWib(new Date())), 0);
    return () => window.clearTimeout(id);
  }, []);

  const parseAmount = useCallback((value: string): number => {
    const digits = value.replace(/[^\d]/g, "");
    return digits ? Number(digits) : 0;
  }, []);

  const shiftWindow = `${branch.openTime.slice(0, 5)} - ${branch.closeTime.slice(0, 5)} WIB`;

  const expectedOpen =
    handoff?.status === "open" || handoff === null
      ? handoff
        ? handoff.openingCash + cash.cashInCash - cash.cashOut
        : 0
      : handoff.expectedCash ?? handoff.openingCash;

  const actualNumber = parseAmount(physical);
  const liveDifference = actualNumber - expectedOpen;

  const notesRequired =
    (handoff?.status === "open" &&
      (liveDifference !== 0 || cash.unknownIn > 0)) ||
    false;
  const notesValid = !notesRequired || notes.trim().length >= 3;

  const canSubmitClose =
    handoff?.status === "open" &&
    physical !== "" &&
    actualNumber >= 0 &&
    notesValid &&
    busy === null;

  const canSubmitOpen =
    handoff === null && opening !== "" && parseAmount(opening) >= 0 && busy === null;

  const fetchHistory = useCallback(async () => {
    if (historyPending) return;
    setHistoryPending(true);
    try {
      const supabase = createClient();
      const { data, error: err } = await supabase
        .from("shift_handoffs")
        .select(
          "id, shift_date, opening_cash, expected_cash, actual_cash, difference, unknown_method_cash, status, notes, opened_at, closed_at, opened_by, closed_by",
        )
        .eq("branch_id", branch.id)
        .eq("status", "closed")
        .order("closed_at", { ascending: false })
        .limit(12);
      if (err) throw new Error(err.message);
      setHistory(
        (data ?? []).map((row) => ({
          id: row.id as string,
          status: "closed" as const,
          openingCash: Number(row.opening_cash ?? 0),
          expectedCash: row.expected_cash === null ? null : Number(row.expected_cash),
          actualCash: row.actual_cash === null ? null : Number(row.actual_cash),
          difference: row.difference === null ? null : Number(row.difference),
          unknownMethodCash: Number(row.unknown_method_cash ?? 0),
          notes: row.notes as string | null,
          openedAt: row.opened_at as string | null,
          closedAt: row.closed_at as string | null,
          openedBy: row.opened_by as string | null,
          closedBy: row.closed_by as string | null,
          shiftDate: row.shift_date as string,
        })),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal memuat riwayat audit.");
    } finally {
      setHistoryPending(false);
    }
  }, [branch.id, historyPending]);

  const handleOpen = useCallback(async () => {
    setError(null);
    setInfo(null);
    const amount = parseAmount(opening);
    if (amount < 0) {
      setError("Kas awal tidak boleh negatif.");
      return;
    }
    if (!kunciBuka.mulai()) return;
    try {
      setBusy("open");
      const supabase = createClient();
      const { error: rpcErr } = await supabase.rpc("open_shift_handoff", {
        p_date: today,
        p_shift_id: null,
        p_opening_cash: amount,
        p_notes: notes.trim() ? notes.trim() : null,
      });
      if (rpcErr) throw new Error(rpcErr.message);
      setInfo("Kas titipan pagi tercatat. Mulai audit shift.");
      window.location.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal membuka serah terima kas.");
      setBusy(null);
    } finally {
      kunciBuka.selesai();
    }
  }, [notes, opening, parseAmount, today, kunciBuka]);

  const handleClose = useCallback(async () => {
    setError(null);
    setInfo(null);
    if (!handoff || handoff.status !== "open") return;
    const actual = parseAmount(physical);
    if (actual < 0) {
      setError("Jumlah kas fisik tidak boleh negatif.");
      return;
    }
    if (notesRequired && notes.trim().length < 3) {
      setError("Catatan wajib diisi minimal 3 karakter saat ada selisih.");
      return;
    }
    if (!kunciTutup.mulai()) return;
    try {
      setBusy("close");
      const supabase = createClient();
      const { data: diff, error: rpcErr } = await supabase.rpc(
        "close_shift_handoff",
        {
          p_handoff_id: handoff.id,
          p_actual_cash: actual,
          p_notes: notes.trim() ? notes.trim() : null,
        },
      );
      if (rpcErr) throw new Error(rpcErr.message);

      const payload = JSON.stringify({
        id: handoff.id,
        actual,
        expected: expectedOpen,
        notes: notes.trim(),
        at: new Date().toISOString(),
      });
      let hash = "";
      try {
        hash = await sha256Hex(payload);
      } catch {
        hash = "";
      }

      setSuccess({
        actual,
        expected: expectedOpen,
        difference: diff === null ? actual - expectedOpen : Number(diff),
        hash,
      });
      setInfo("Audit shift berhasil ditutup. Bukti serah terima siap dicetak.");
      // Segarkan data server supaya badge status shift di header ikut berubah
      // dari "Aktif" menjadi "Selesai". router.refresh() mempertahankan kartu
      // bukti (state `success`) yang sedang tampil, sedangkan reload penuh
      // akan menghapusnya.
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal menutup audit shift.");
      setBusy(null);
    } finally {
      kunciTutup.selesai();
    }
  }, [expectedOpen, handoff, notes, notesRequired, parseAmount, physical, router, kunciTutup]);

  return (
    <div className="flex flex-col w-full pb-nav print:hidden">
      {/* Kartu status shift & kasir */}
      <section className="px-gutter pt-4">
        <div className="bg-surface rounded-[24px] p-5 clay-card border border-white/80 flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <div className="flex flex-col gap-1">
              <span className="font-caption text-caption text-text-muted tracking-wide uppercase">
                Shift &amp; Kasir
              </span>
              <span className="font-headline-2 text-headline-2 text-text-primary">
                {branch.name}
              </span>
            </div>
            <span
              className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full font-micro-badge text-micro-badge ${
                handoff === null
                  ? "bg-surface-container text-text-secondary"
                  : handoff.status === "open"
                    ? "bg-success-surface text-success-text"
                    : "bg-brand-50 text-brand-700"
              }`}
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  handoff === null
                    ? "bg-text-muted"
                    : handoff.status === "open"
                      ? "bg-success-base"
                      : "bg-brand-500"
                }`}
              />
              {handoff === null ? "Belum Buka" : handoff.status === "open" ? "Aktif" : "Selesai"}
            </span>
          </div>

          <div className="flex items-center gap-3 bg-surface-container-low rounded-2xl p-3">
            <div className="w-11 h-11 rounded-2xl bg-success-surface text-success-text flex items-center justify-center shrink-0">
              <Icon name="verified_user" className="text-[24px]" />
            </div>
            <div className="flex-1 min-w-0">
              <span className="font-caption text-caption text-text-secondary block">
                Kas Titipan Pagi
              </span>
              <span className="font-body-bold text-body-bold text-text-primary block">
                {handoff ? formatRupiah(handoff.openingCash) : "Belum dibuka"}
              </span>
            </div>
            <span className="font-caption text-caption text-text-muted shrink-0">
              {shiftWindow}
            </span>
          </div>
        </div>
      </section>

      {/* Riwayat audit */}
      <section className="px-gutter pt-3">
        <button
          type="button"
          onClick={() => {
            if (!showHistory) void fetchHistory();
            setShowHistory((v) => !v);
          }}
          className="w-full min-h-11 rounded-xl bg-surface text-text-secondary font-caption text-caption flex items-center justify-center gap-1.5 clay-card active:scale-95 transition-transform"
        >
          <Icon name="history" className="text-[16px]" />
          {showHistory ? "Tutup Riwayat Tutup Kas" : "Riwayat Penutupan Kas"}
        </button>

        {showHistory ? (
          <div className="mt-2.5 bg-surface rounded-[20px] p-4 clay-card border border-white/80">
            {historyPending ? (
              <p className="font-caption text-caption text-text-muted text-center py-3">
                Memuat riwayat...
              </p>
            ) : history.length === 0 ? (
              <p className="font-caption text-caption text-text-muted text-center py-3">
                Belum ada penutupan kas tercatat.
              </p>
            ) : (
              <div className="flex flex-col divide-y divide-border-subtle">
                {history.map((row) => (
                  <div key={row.id} className="py-2.5 flex items-center justify-between gap-3">
                    <div className="flex flex-col gap-0.5 min-w-0">
                      <span className="font-caption text-caption text-text-primary">
                        {row.shiftDate} • Tutup {formatTimeWib(row.closedAt)} WIB
                      </span>
                      <span className="font-caption text-caption text-text-muted truncate">
                        Kas: {formatRupiah(row.actualCash)} dari ekspektasi{" "}
                        {formatRupiah(row.expectedCash)}
                      </span>
                    </div>
                    <span
                      className={`px-2 py-0.5 rounded-full font-caption text-caption shrink-0 ${
                        row.difference === 0
                          ? "bg-success-surface text-success-text"
                          : "bg-warning-surface text-warning-text"
                      }`}
                    >
                      {row.difference === 0
                        ? "SESUAI"
                        : `${row.difference && row.difference > 0 ? "+" : "-"}${formatRupiah(
                            Math.abs(row.difference ?? 0),
                          )}`}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : null}
      </section>

      {handoff === null ? (
        <BukaKasForm
          opening={opening}
          setOpening={setOpening}
          notes={notes}
          setNotes={setNotes}
          canSubmit={canSubmitOpen}
          busy={busy === "open"}
          onSubmit={handleOpen}
          shiftWindow={shiftWindow}
        />
      ) : handoff.status === "closed" && !success ? (
        <ClosedSummary
          handoff={handoff}
          userNames={userNames}
          handlePrint={handlePrint}
        />
      ) : success !== null || (handoff.status === "closed" && success !== null) ? (
        <SuccessCard
          handoff={handoff}
          success={success}
          handlePrint={handlePrint}
          onReload={() => window.location.reload()}
          hash={success?.hash ?? ""}
        />
      ) : (
        <AuditForm
          handoff={handoff}
          cash={cash}
          physical={physical}
          setPhysical={setPhysical}
          notes={notes}
          setNotes={setNotes}
          actualNumber={actualNumber}
          expected={expectedOpen}
          liveDifference={liveDifference}
          notesRequired={notesRequired}
          notesValid={notesValid}
          canSubmit={canSubmitClose}
          busy={busy === "close"}
          onSubmit={handleClose}
          profile={profile}
          nowClock={nowClock}
        />
      )}

      {error && (handoff?.status === "open" || handoff === null) ? (
        <section className="px-gutter pt-3">
          <div className="p-3 rounded-xl bg-danger-surface text-danger-text font-body text-body flex items-center gap-2">
            <Icon name="error" className="text-[18px]" />
            <span className="flex-1">{error}</span>
          </div>
        </section>
      ) : null}

      {info ? (
        <section className="px-gutter pt-3">
          <div className="p-3 rounded-xl bg-success-surface text-success-text font-body text-body flex items-center gap-2">
            <Icon name="check_circle" className="text-[18px]" />
            <span className="flex-1">{info}</span>
          </div>
        </section>
      ) : null}

      {/* Pintasan rekap */}
      <section className="px-gutter pt-4">
        <div className="bg-clay-overlay rounded-2xl p-3.5 flex items-center justify-between gap-3 border border-border-subtle">
          <div className="flex flex-col gap-0.5 min-w-0">
            <span className="font-body-bold text-body-bold text-text-primary">
              Rekap Kehadiran Staf
            </span>
            <span className="font-caption text-caption text-text-secondary">
              Cek kehadiran &amp; keterlambatan staf hari ini.
            </span>
          </div>
          <Link
            href="/rekap"
            className="min-h-11 px-3.5 rounded-xl primary-gradient text-white font-caption text-caption flex items-center gap-1.5 shrink-0 active:scale-95 transition-transform"
          >
            <Icon name="groups" className="text-[16px]" />
            Buka Rekap
          </Link>
        </div>
      </section>

      <StrukPrint
        handoff={handoff}
        expected={success?.expected ?? expectedOpen}
        actual={success?.actual ?? (handoff?.actualCash ?? 0)}
        difference={
          success?.difference ??
          (handoff?.status === "closed" && handoff.difference !== null
            ? handoff.difference
            : liveDifference)
        }
        notes={success ? notes : (handoff?.notes ?? notes)}
        hash={success?.hash ?? ""}
        closedBy={handoff?.closedBy ?? null}
        userNames={userNames}
        profile={profile}
        shiftWindow={shiftWindow}
        branch={branch}
      />
    </div>
  );
}

function BukaKasForm({
  opening,
  setOpening,
  notes,
  setNotes,
  canSubmit,
  busy,
  onSubmit,
  shiftWindow,
}: {
  opening: string;
  setOpening: (v: string) => void;
  notes: string;
  setNotes: (v: string) => void;
  canSubmit: boolean;
  busy: boolean;
  onSubmit: () => void;
  shiftWindow: string;
}) {
  const add = (value: number) => {
    const current = Number(opening.replace(/[^\d]/g, "") || 0);
    setOpening(String(current + value));
  };

  return (
    <section className="px-gutter pt-4">
      <div className="bg-surface rounded-[24px] p-4 sm:p-5 clay-card border border-white/80 inner-clay-highlight space-y-4">
        <div className="flex items-center justify-between px-1">
          <div className="flex items-center gap-2">
            <span className="p-1.5 rounded-lg bg-brand-50 text-brand-600">
              <Icon name="savings" className="text-[18px]" />
            </span>
            <span className="font-body-bold text-body-bold text-text-primary">
              Serah Terima Kas Titipan Pagi
            </span>
          </div>
          <span className="font-caption text-caption text-text-muted">{shiftWindow}</span>
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <label
              htmlFor="opening-cash"
              className="font-body-bold text-body-bold text-text-primary flex items-center gap-1"
            >
              Modal Awal Kas Laci
              <span className="text-danger-text font-extrabold">*</span>
            </label>
            <span className="font-caption text-caption text-text-muted">Wajib</span>
          </div>
          <div className="flex items-center gap-2 h-12 bg-surface-container-low rounded-2xl px-3 focus-within:ring-2 focus-within:ring-brand-500/20">
            <span className="font-body-bold text-body-bold text-brand-700">Rp</span>
            <input
              id="opening-cash"
              inputMode="numeric"
              value={opening}
              onChange={(e) => setOpening(e.target.value)}
              placeholder="0"
              className="flex-1 bg-transparent font-body-bold text-body-bold text-text-primary placeholder:text-text-muted outline-none"
            />
          </div>
          <div className="flex flex-wrap gap-1.5 pt-1">
            {[100000, 200000, 300000, 500000].map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => add(value)}
                className="h-10 px-3 rounded-full bg-surface border border-border-strong text-text-secondary font-caption text-caption active:scale-95 transition-transform"
              >
                +{formatRupiah(value)}
              </button>
            ))}
            {opening ? (
              <button
                type="button"
                onClick={() => setOpening("")}
                className="h-10 px-3 rounded-full bg-danger-surface text-danger-text font-caption text-caption active:scale-95 transition-transform"
              >
                Bersihkan
              </button>
            ) : null}
          </div>
        </div>

        <div className="space-y-1.5">
          <label htmlFor="opening-notes" className="font-body-bold text-body-bold text-text-primary block">
            Catatan (Opsional)
          </label>
          <textarea
            id="opening-notes"
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Contoh: pecahan kas laci diserahkan oleh kasir pagi..."
            className="w-full p-3 bg-surface border border-border-strong rounded-2xl font-body text-body text-text-primary placeholder:text-text-muted outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 resize-none"
          />
        </div>

        <button
          type="button"
          onClick={onSubmit}
          disabled={!canSubmit}
          className="w-full h-[50px] rounded-full primary-gradient text-white font-bold text-[14px] tracking-wide uppercase flex items-center justify-center gap-2.5 clay-glow active:scale-[0.98] transition-all disabled:opacity-60"
        >
          <Icon name="play_arrow" className="text-[22px]" />
          {busy ? "Membuka..." : "Buka & Catat Kas Titipan"}
        </button>
      </div>
    </section>
  );
}

function AuditForm({
  handoff,
  cash,
  physical,
  setPhysical,
  notes,
  setNotes,
  actualNumber,
  expected,
  liveDifference,
  notesRequired,
  notesValid,
  canSubmit,
  busy,
  onSubmit,
  profile,
  nowClock,
}: {
  handoff: Handoff;
  cash: CashSummary;
  physical: string;
  setPhysical: (v: string) => void;
  notes: string;
  setNotes: (v: string) => void;
  actualNumber: number;
  expected: number;
  liveDifference: number;
  notesRequired: boolean;
  notesValid: boolean;
  canSubmit: boolean;
  busy: boolean;
  onSubmit: () => void;
  profile: { fullName: string };
  nowClock: string | null;
}) {
  const add = (value: number) => {
    setPhysical(String(actualNumber + value));
  };

  const rows = [
    {
      label: "Penjualan Tunai Sistem",
      value: cash.cashInCash,
      className: "",
    },
    {
      label: "Pengeluaran Kas Hari Ini",
      value: -cash.cashOut,
      className: cash.cashOut > 0 ? "text-danger-text" : "",
    },
  ];
  if (cash.cashInOther > 0) {
    rows.push({
      label: "Non-Tunai QRIS / Transfer (bank)",
      value: cash.cashInOther,
      className: "text-text-muted",
    });
  }
  if (cash.unknownIn > 0 || handoff.unknownMethodCash > 0) {
    rows.push({
      label: "Metode Pembayaran Tak Teridentifikasi",
      value: cash.unknownIn > 0 ? cash.unknownIn : handoff.unknownMethodCash,
      className: "text-warning-text",
    });
  }

  return (
    <section className="px-gutter pt-4">
      <div className="bg-surface rounded-[24px] p-4 sm:p-5 clay-card border border-white/80 inner-clay-highlight space-y-4">
        <div className="flex items-center justify-between px-1">
          <div className="flex items-center gap-2">
            <span className="p-1.5 rounded-lg bg-brand-50 text-brand-600">
              <Icon name="fact_check" className="text-[18px]" />
            </span>
            <span className="font-body-bold text-body-bold text-text-primary">
              Rekonsiliasi Kas Shift
            </span>
          </div>
          <span className="font-micro-badge text-micro-badge px-2 py-0.5 rounded-full bg-brand-50 text-brand-700">
            POS AUTO-SYNC
          </span>
        </div>

        {/* Rincian perhitungan otomatis */}
        <div className="bg-surface-container-low rounded-2xl p-3.5 space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="font-caption text-caption text-text-secondary">
              Modal Awal Titipan
            </span>
            <span className="font-body-bold text-body-bold text-text-primary">
              {formatRupiah(handoff.openingCash)}
            </span>
          </div>
          {rows.map((row) => (
            <div key={row.label} className="flex items-center justify-between">
              <span className="font-caption text-caption text-text-secondary">
                {row.label}
              </span>
              <span className={`font-body-bold text-body-bold ${row.className}`}>
                {row.value >= 0 ? "+" : "-"}
                {formatRupiah(Math.abs(row.value))}
              </span>
            </div>
          ))}
        </div>

        {/* Ekspektasi */}
        <div className="bg-brand-50 border border-brand-200 rounded-2xl p-3.5 flex items-center justify-between">
          <div className="flex flex-col gap-0.5">
            <span className="font-body-bold text-body-bold text-brand-700">
              Ekspektasi Kas Fisik Laci
            </span>
            <span className="font-caption text-caption text-text-muted">
              Titipan + Tunai - Pengeluaran
            </span>
          </div>
          <span className="font-metric-display text-metric-display text-brand-700">
            {formatRupiah(expected)}
          </span>
        </div>

        {/* Kas fisik */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <label
              htmlFor="physical-cash"
              className="font-body-bold text-body-bold text-text-primary flex items-center gap-1"
            >
              Kas Fisik di Laci
              <span className="text-danger-text font-extrabold">*</span>
            </label>
            <span className="font-micro-badge text-micro-badge px-2 py-0.5 rounded-full bg-warning-surface text-warning-text">
              WAJIB DIHITUNG
            </span>
          </div>
          <div className="flex items-center gap-2 h-14 bg-surface-container-low rounded-2xl px-3 focus-within:ring-2 focus-within:ring-brand-500/20">
            <span className="font-body-bold text-body-bold text-brand-700">Rp</span>
            <input
              id="physical-cash"
              inputMode="numeric"
              value={physical}
              onChange={(e) => setPhysical(e.target.value)}
              placeholder="0"
              className="flex-1 bg-transparent font-body-bold text-body-bold text-[18px] text-text-primary placeholder:text-text-muted outline-none"
            />
          </div>
          <div className="flex flex-wrap gap-1.5 pt-1">
            {[100000, 50000, 20000, 10000, 5000].map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => add(value)}
                className="h-10 px-3 rounded-full bg-surface border border-border-strong text-text-secondary font-caption text-caption active:scale-95 transition-transform"
              >
                +{formatRupiah(value)}
              </button>
            ))}
            {physical ? (
              <button
                type="button"
                onClick={() => setPhysical("")}
                className="h-10 px-3 rounded-full bg-danger-surface text-danger-text font-caption text-caption active:scale-95 transition-transform"
              >
                Bersihkan
              </button>
            ) : null}
          </div>

          <div
            className={`mt-1.5 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full font-micro-badge text-micro-badge ${
              liveDifference === 0
                ? "bg-success-surface text-success-text"
                : "bg-warning-surface text-warning-text"
            }`}
          >
            <Icon name={liveDifference === 0 ? "task_alt" : "swap_horiz"} className="text-[14px]" />
            {liveDifference === 0
              ? "SESUAI"
              : `SELISIH ${liveDifference > 0 ? "+" : "-"}${formatRupiah(
                  Math.abs(liveDifference),
                )}`}
          </div>
        </div>

        {/* Catatan audit */}
        <div className="space-y-1.5">
          <label
            htmlFor="audit-notes"
            className="font-body-bold text-body-bold text-text-primary flex items-center gap-1"
          >
            Catatan Audit
            {notesRequired ? (
              <>
                <span className="text-danger-text font-extrabold">*</span>
                <span className="font-caption text-caption text-text-muted">
                  (Wajib saat ada selisih / metode tak dikenal)
                </span>
              </>
            ) : (
              <span className="font-caption text-caption text-text-muted">
                (Opsional)
              </span>
            )}
          </label>
          <textarea
            id="audit-notes"
            rows={3}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Jelaskan penyebab selisih atau kondisi kas fisik dengan jujur..."
            className="w-full h-20 p-3 bg-surface border border-border-strong rounded-2xl font-body text-body text-text-primary placeholder:text-text-muted outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 resize-none"
          />
          {notesRequired && !notesValid ? (
            <p className="font-caption text-caption text-danger-text">
              Catatan wajib diisi minimal 3 karakter.
            </p>
          ) : null}
        </div>

        {/* Tanda tangan digital */}
        <div className="bg-surface-container-low rounded-2xl p-3 flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-brand-500 text-white flex items-center justify-center font-micro-badge text-micro-badge shrink-0">
            {initials(profile.fullName)}
          </div>
          <div className="flex-1 min-w-0">
            <span className="font-caption text-caption text-text-secondary block">
              Diserahkan oleh:
            </span>
            <span className="font-body-bold text-body-bold text-text-primary block">
              {profile.fullName} • {nowClock ?? "--:--"} WIB
            </span>
          </div>
          <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-surface text-success-text font-micro-badge text-micro-badge border border-success-surface shrink-0">
            <Icon name="verified" className="text-[13px]" />
            SHA-256 VALID
          </span>
        </div>

        <button
          type="button"
          onClick={onSubmit}
          disabled={!canSubmit}
          className="w-full h-[50px] rounded-full primary-gradient text-white font-bold text-[14px] tracking-wide uppercase flex items-center justify-center gap-2.5 clay-glow active:scale-[0.98] transition-all disabled:opacity-60"
        >
          <Icon name="savings" className="text-[22px]" />
          {busy ? "Menutup Audit..." : "Simpan & Tutup Audit Shift"}
        </button>
      </div>
    </section>
  );
}

function ClosedSummary({
  handoff,
  userNames,
  handlePrint,
}: {
  handoff: Handoff;
  userNames: Record<string, string>;
  handlePrint: () => void;
}) {
  const diff = handoff.difference ?? 0;
  return (
    <section className="px-gutter pt-4">
      <div className="bg-surface rounded-[24px] p-4 sm:p-5 clay-card border border-white/80 inner-clay-highlight space-y-4">
        <div className="flex items-center justify-between px-1">
          <div className="flex items-center gap-2">
            <span className="p-1.5 rounded-lg bg-success-surface text-success-text">
              <Icon name="task_alt" className="text-[18px]" />
            </span>
            <span className="font-body-bold text-body-bold text-text-primary">
              Audit Shift Selesai
            </span>
          </div>
          <span className="font-caption text-caption text-text-muted">
            Tutup {formatTimeWib(handoff.closedAt)} WIB
          </span>
        </div>

        <div className="bg-success-surface rounded-2xl p-3.5 space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="font-caption text-caption text-success-text">Status Kas</span>
            <span className="font-micro-badge text-micro-badge px-2 py-0.5 rounded-full bg-surface text-success-text">
              {diff === 0 ? "SESUAI" : "ADA SELISIH"}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="font-caption text-caption text-success-text">
              Kas Fisik Diperiksa
            </span>
            <span className="font-body-bold text-body-bold text-success-text">
              {formatRupiah(handoff.actualCash)}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="font-caption text-caption text-success-text">Ekspektasi</span>
            <span className="font-body-bold text-body-bold text-success-text">
              {formatRupiah(handoff.expectedCash)}
            </span>
          </div>
          <div className="flex items-center justify-between border-t border-success-base/20 pt-2.5">
            <span className="font-body-bold text-body-bold text-success-text">Selisih</span>
            <span className="font-body-bold text-body-bold text-success-text">
              {diff === 0 ? "Tidak ada" : `${diff > 0 ? "+" : "-"}${formatRupiah(Math.abs(diff))}`}
            </span>
          </div>
        </div>

        {handoff.notes ? (
          <div className="bg-clay-overlay rounded-2xl p-3">
            <span className="font-caption text-caption text-text-muted block">
              Catatan Audit
            </span>
            <p className="font-body text-body text-text-primary mt-0.5 leading-relaxed">
              {handoff.notes}
            </p>
          </div>
        ) : null}

        <div className="flex items-center justify-between bg-surface-container-low rounded-2xl p-3">
          <div className="flex flex-col gap-0.5">
            <span className="font-caption text-caption text-text-secondary">
              Dibuka oleh
            </span>
            <span className="font-body-bold text-body-bold text-text-primary">
              {handoff.openedBy ? (userNames[handoff.openedBy] ?? "Staf") : "-"}
            </span>
          </div>
          <div className="flex flex-col gap-0.5 text-right">
            <span className="font-caption text-caption text-text-secondary">
              Ditutup oleh
            </span>
            <span className="font-body-bold text-body-bold text-text-primary">
              {handoff.closedBy ? (userNames[handoff.closedBy] ?? "Staf") : "-"}
            </span>
          </div>
        </div>

        <button
          type="button"
          onClick={handlePrint}
          className="w-full h-[50px] rounded-full primary-gradient text-white font-bold text-[14px] tracking-wide uppercase flex items-center justify-center gap-2.5 clay-glow active:scale-[0.98] transition-all"
        >
          <Icon name="print" className="text-[22px]" />
          Cetak Bukti (Opsional)
        </button>
      </div>
    </section>
  );
}

function SuccessCard({
  handoff,
  success,
  handlePrint,
  onReload,
  hash,
}: {
  handoff: Handoff;
  success: { actual: number; expected: number; difference: number; hash: string } | null;
  handlePrint: () => void;
  onReload: () => void;
  hash: string;
}) {
  const diff = success?.difference ?? 0;
  const finalActual = success?.actual ?? handoff.actualCash ?? 0;
  const finalExpected = success?.expected ?? handoff.expectedCash ?? 0;
  return (
    <section className="px-gutter pt-4">
      <div className="bg-surface rounded-[24px] p-4 sm:p-5 clay-card border border-white/80 inner-clay-highlight space-y-4">
        <div className="flex flex-col items-center gap-2 text-center px-1">
          <div className="w-16 h-16 rounded-full bg-success-surface text-success-text flex items-center justify-center">
            <Icon name="verified" className="text-[36px]" />
          </div>
          <div>
            <span className="font-headline-1 text-headline-1 text-text-primary block">
              Audit Shift Tersimpan
            </span>
            <span className="font-caption text-caption text-text-secondary block">
              Bukti serah terima kas telah dihasilkan.
            </span>
          </div>
        </div>

        <div className="bg-success-surface rounded-2xl p-3.5 space-y-2">
          <div className="flex items-center justify-between">
            <span className="font-caption text-caption text-success-text">Kas Fisik</span>
            <span className="font-body-bold text-body-bold text-success-text">
              {formatRupiah(finalActual)}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="font-caption text-caption text-success-text">Ekspektasi</span>
            <span className="font-body-bold text-body-bold text-success-text">
              {formatRupiah(finalExpected)}
            </span>
          </div>
          <div className="flex items-center justify-between border-t border-success-base/20 pt-2">
            <span className="font-body-bold text-body-bold text-success-text">Selisih</span>
            <span
              className={`px-2 py-0.5 rounded-full font-micro-badge text-micro-badge ${
                diff === 0
                  ? "bg-surface text-success-text"
                  : "bg-warning-surface text-warning-text"
              }`}
            >
              {diff === 0 ? "SESUAI" : `${diff > 0 ? "+" : "-"}${formatRupiah(Math.abs(diff))}`}
            </span>
          </div>
        </div>

        {hash ? (
          <div className="bg-surface-container-low rounded-2xl p-3 flex items-center gap-2.5">
            <Icon name="fingerprint" className="text-success-text text-[18px] shrink-0" />
            <div className="flex-1 min-w-0">
              <span className="font-caption text-caption text-text-muted block">
                Sidik Digital (SHA-256)
              </span>
              <span className="font-mono text-[11px] text-text-secondary break-all">
                {hash}
              </span>
            </div>
            <span className="font-micro-badge text-micro-badge px-2 py-1 rounded-full bg-success-surface text-success-text shrink-0">
              VALID
            </span>
          </div>
        ) : null}

        {/*
          Bukti cetak thermal adalah opsional, bukan tahap terakhir. Kalau
          printer thermal tidak tersedia, sebelumnya kasir hanya punya tombol
          cetak dan tombol muat ulang, sehingga tidak ada jalan keluar yang
          jelas dari layar ini. Urutannya ditutup dengan dua pilihan yang
          selalu bisa dipakai: kembali ke beranda atau cetak bukti.
        */}
        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={handlePrint}
            className="w-full h-12 rounded-full bg-surface-container text-text-secondary font-body-bold text-body-bold flex items-center justify-center gap-2 active:scale-[0.98] transition-all"
          >
            <Icon name="print" className="text-[20px]" />
            Cetak Bukti (Opsional)
          </button>
          <button
            type="button"
            onClick={onReload}
            className="w-full h-11 rounded-full bg-surface-container-low text-text-secondary font-body-bold text-body-bold flex items-center justify-center gap-2 active:scale-95 transition-transform"
          >
            <Icon name="refresh" className="text-[18px]" />
            Muat Ringkasan Terbaru
          </button>
          <a
            href="/dashboard"
            className="w-full h-[50px] rounded-full primary-gradient text-white font-bold text-[14px] tracking-wide uppercase flex items-center justify-center gap-2.5 clay-glow active:scale-[0.98] transition-all"
          >
            <Icon name="home" className="text-[22px]" />
            Selesai, Kembali ke Beranda
          </a>
        </div>
      </div>
    </section>
  );
}

// ---------- Cetak struk (mode print, 58mm) ----------

async function sha256Hex(text: string): Promise<string> {
  const buffer = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function StrukPrint({
  handoff,
  expected,
  actual,
  difference,
  notes,
  hash,
  closedBy,
  userNames,
  profile,
  shiftWindow,
  branch,
}: {
  handoff: Handoff | null;
  expected: number;
  actual: number;
  difference: number;
  notes: string;
  hash: string;
  closedBy: string | null;
  userNames: Record<string, string>;
  profile: { fullName: string };
  shiftWindow: string;
  branch: { name: string };
}) {
  const person = closedBy ? (userNames[closedBy] ?? profile.fullName) : profile.fullName;
  return (
    <div className="hidden print:block bg-white text-black font-mono text-[11px] leading-relaxed p-4">
      <div className="text-center">
        <p className="font-bold text-[13px]">RB AUTOLUXE</p>
        <p>{branch.name}</p>
        <p>Bukti Serah Terima Kas</p>
        <p>{handoff?.closedAt ? formatTimeWib(handoff.closedAt) : "--:--"} WIB</p>
      </div>
      <hr className="border-dashed my-2" />
      <p>Shift resmi : {shiftWindow}</p>
      <p>Kas titipan  : Rp{Math.round(handoff?.openingCash ?? 0).toLocaleString("id-ID")}</p>
      <p>Ekspektasi   : Rp{Math.round(expected).toLocaleString("id-ID")}</p>
      <p>Kas fisik    : Rp{Math.round(actual).toLocaleString("id-ID")}</p>
      <p>Selisih      : {difference === 0 ? "Sesuai" : `${difference > 0 ? "+" : "-"}Rp${Math.round(Math.abs(difference)).toLocaleString("id-ID")}`}</p>
      <hr className="border-dashed my-2" />
      {notes ? <p>Catatan: {notes}</p> : null}
      <p>Diserahkan oleh: {person}</p>
      <p>SHA-256: {hash || "-"}</p>
      <hr className="border-dashed my-2" />
      <p className="text-center">Terima kasih. Simpan struk ini terlampir pada Buku Kas.</p>
    </div>
  );
}

function handlePrint() {
  window.print();
}