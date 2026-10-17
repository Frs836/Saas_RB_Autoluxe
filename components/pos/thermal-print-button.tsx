"use client";

import { useCallback, useEffect, useState } from "react";
import {
  bluetoothSupport,
  buildThermalReceipt,
  listPairedPrinters,
  printToThermalPrinter,
  requestPrinter,
  type PrinterInfo,
  type ThermalReceipt,
} from "@/lib/thermal";
import { Icon } from "@/components/ui/icon";

/**
 * Kontrol cetak struk ke printer thermal Bluetooth.
 *
 * Dukungan Web Bluetooth tidak merata. Safari di iOS tidak mendukungnya sama
 * sekali, dan beberapa peramban memblokirnya pada mode pribadi. Karena itu
 * kontrol ini menampilkan alasannya secara terbuka bila tidak tersedia,
 * alih-alih menyembunyikan tombol dan membiarkan kasir bingung.
 */
export function ThermalPrintButton({
  receipt,
  label = "Cetak struk",
  compact = false,
}: {
  receipt: ThermalReceipt;
  label?: string;
  compact?: boolean;
}) {
  const [support, setSupport] = useState<{ supported: boolean; reason: string | null } | null>(
    null,
  );
  const [printers, setPrinters] = useState<PrinterInfo[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(
    null,
  );
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let active = true;
    // Dukungan Web Bluetooth adalah API peramban, jadi baru bisa dibaca setelah
    // mount. Semua setState terjadi setelah await supaya tidak ada render
    // berantai langsung di badan effect.
    async function init() {
      const supportInfo = bluetoothSupport();
      const found = await listPairedPrinters().catch(() => [] as PrinterInfo[]);
      if (!active) return;
      setSupport(supportInfo);
      setPrinters(found);
      if (found.length === 1) setSelectedId(found[0].id);
    }
    void init();
    return () => {
      active = false;
    };
  }, []);

  const pair = useCallback(async () => {
    setMessage(null);
    try {
      const printer = await requestPrinter();
      setPrinters((prev) =>
        prev.some((item) => item.id === printer.id) ? prev : [...prev, printer],
      );
      setSelectedId(printer.id);
      setMessage({ tone: "ok", text: `${printer.name} terhubung.` });
    } catch (error) {
      // Pembatalan perangkat oleh pengguna juga dilempar sebagai galat.
      setMessage({
        tone: "error",
        text:
          error instanceof Error
            ? `Tidak bisa-pair printer: ${error.message}`
            : "Printer tidak dapat dipasangkan.",
      });
    }
  }, []);

  const print = useCallback(async () => {
    if (!selectedId) {
      setMessage({ tone: "error", text: "Pilih atau pasangkan printer terlebih dahulu." });
      return;
    }
    setBusy(true);
    setMessage(null);
    const result = await printToThermalPrinter(
      selectedId,
      buildThermalReceipt(receipt),
    );
    setBusy(false);
    setMessage(
      result.ok
        ? { tone: "ok", text: "Struk terkirim ke printer." }
        : { tone: "error", text: result.message },
    );
  }, [receipt, selectedId]);

  if (support && !support.supported) {
    return (
      <div className="flex flex-col gap-1">
        <button
          type="button"
          disabled
          className={`h-11 px-4 rounded-xl bg-surface-container text-text-muted font-caption text-caption flex items-center justify-center gap-1.5 ${
            compact ? "" : "w-full"
          }`}
        >
          <Icon name="print_disabled" className="text-[18px]" />
          Cetak thermal tidak tersedia
        </button>
        {support.reason ? (
          <span className="font-micro-badge text-micro-badge text-text-muted">
            {support.reason}
          </span>
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex gap-2">
        <select
          value={selectedId}
          onChange={(e) => setSelectedId(e.target.value)}
          className="flex-1 h-11 px-3 rounded-xl bg-surface-container-low font-caption text-caption text-text-primary outline-none focus:ring-2 focus:ring-brand-400"
        >
          <option value="">Pilih printer...</option>
          {printers.map((printer) => (
            <option key={printer.id} value={printer.id}>
              {printer.name}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="h-11 px-3 rounded-xl bg-surface-container text-text-secondary font-caption text-caption flex items-center gap-1 active:scale-95 transition-transform"
        >
          <Icon name="bluetooth" className="text-[18px]" />
        </button>
      </div>

      {open ? (
        <button
          type="button"
          onClick={pair}
          className="h-10 px-3 rounded-xl bg-brand-50 text-brand-700 font-caption text-caption flex items-center gap-1.5 self-start active:scale-95 transition-transform"
        >
          <Icon name="add" className="text-[16px]" />
          Pasangkan printer baru
        </button>
      ) : null}

      <button
        type="button"
        onClick={print}
        disabled={busy || printers.length === 0}
        className={`h-11 px-4 rounded-xl bg-brand-500 text-white font-caption text-caption flex items-center justify-center gap-1.5 active:scale-95 transition-transform disabled:opacity-50 ${
          compact ? "" : "w-full"
        }`}
      >
        <Icon name={busy ? "hourglass_top" : "print"} className="text-[18px]" />
        {busy ? "Mengirim..." : label}
      </button>

      {message ? (
        <span
          className={`font-micro-badge text-micro-badge ${
            message.tone === "ok" ? "text-success-text" : "text-danger-text"
          }`}
        >
          {message.text}
        </span>
      ) : null}
    </div>
  );
}