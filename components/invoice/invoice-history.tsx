"use client";

import { useMemo, useState } from "react";
import { ThermalPrintButton } from "@/components/pos/thermal-print-button";
import { Icon } from "@/components/ui/icon";
import { formatDateWib, formatRupiah, formatTimeWib } from "@/lib/format";
import { sizeLabel, whatsappLink, type VehicleSize } from "@/lib/pos";
import type { ThermalReceipt } from "@/lib/thermal";

export type InvoiceRow = {
  id: string;
  orderId: string;
  invoiceNumber: string;
  totalPrice: number;
  paymentMethod: string;
  paymentState: string;
  status: string;
  customerName: string;
  customerPhone: string;
  licensePlate: string;
  vehicleModel: string;
  vehicleSize: string;
  servicePackage: string;
  issuedAt: string;
  branchName: string;
  trackingToken: string;
  items: { name: string; quantity: number; total: number }[];
};

const STATUS_LABEL: Record<string, string> = {
  queued: "Antre",
  in_progress: "Pengerjaan",
  qc_review: "Quality Control",
  completed: "Selesai",
  menunggu_diambil: "Siap Diambil",
  diserahkan: "Diserahkan",
  cancelled: "Dibatalkan",
};

const PAYMENT_LABEL: Record<string, string> = {
  cash: "Tunai",
  qris: "QRIS",
  bank_transfer: "Transfer Bank",
};

function toReceipt(row: InvoiceRow): ThermalReceipt {
  return {
    branchName: row.branchName,
    orderNumber: row.invoiceNumber,
    vehicleModel: row.vehicleModel,
    licensePlate: row.licensePlate,
    customerName: row.customerName,
    items: row.items,
    total: row.totalPrice,
    paymentMethod: PAYMENT_LABEL[row.paymentMethod] ?? row.paymentMethod,
    paid: row.paymentState === "paid",
    trackingUrl: row.trackingToken
      ? `${typeof window === "undefined" ? "" : window.location.origin}/track/${row.trackingToken}`
      : "",
  };
}

/**
 * Daftar invoice dengan pencarian dan cetak ulang.
 *
 * Kolom pencarian menyaring nomor invoice, nomor order, plat, dan nama
 * pelanggan sekaligus, karena kasir hanya mengingat satu dari keempatnya
 * ketika pelanggan datang minta salinan nota.
 */
export function InvoiceHistory({ invoices }: { invoices: InvoiceRow[] }) {
  const [cari, setCari] = useState("");
  const [terbuka, setTerbuka] = useState<string | null>(null);

  const tersaring = useMemo(() => {
    const q = cari.trim().toLowerCase();
    if (!q) return invoices;
    return invoices.filter((row) =>
      [
        row.invoiceNumber,
        row.licensePlate,
        row.customerName,
        row.servicePackage,
      ]
        .join(" ")
        .toLowerCase()
        .includes(q),
    );
  }, [invoices, cari]);

  const totalNilai = tersaring.reduce((sum, row) => sum + row.totalPrice, 0);
  const belumLunas = tersaring.filter((r) => r.paymentState === "unpaid").length;

  if (invoices.length === 0) {
    return (
      <main className="flex-1 px-gutter pt-4 pb-nav-plain">
        <div className="clay-card p-8 flex flex-col items-center text-center gap-2">
          <Icon name="receipt_long" className="text-[40px] text-text-muted" />
          <p className="font-body text-body text-text-secondary">
            Belum ada invoice yang tercatat.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="flex-1 px-gutter pt-4 pb-nav-plain flex flex-col gap-3">
      <div className="grid grid-cols-3 gap-2">
        <div className="clay-card p-3 flex flex-col items-center gap-0.5">
          <span className="font-headline-2 text-headline-2 text-text-primary">
            {tersaring.length}
          </span>
          <span className="font-caption text-caption text-text-muted">Invoice</span>
        </div>
        <div className="clay-card p-3 flex flex-col items-center gap-0.5">
          <span className="font-headline-2 text-headline-2 text-brand-600">
            {formatRupiah(totalNilai)}
          </span>
          <span className="font-caption text-caption text-text-muted">Total</span>
        </div>
        <div className="clay-card p-3 flex flex-col items-center gap-0.5">
          <span className="font-headline-2 text-headline-2 text-warning-text">
            {belumLunas}
          </span>
          <span className="font-caption text-caption text-text-muted">Belum Lunas</span>
        </div>
      </div>

      <div className="relative">
        <Icon
          name="search"
          className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted text-[20px]"
        />
        <input
          value={cari}
          onChange={(e) => setCari(e.target.value)}
          type="search"
          placeholder="Cari nomor invoice, plat, atau nama..."
          className="w-full h-12 pl-11 pr-4 rounded-2xl bg-surface text-body text-text-primary outline-none focus:ring-2 focus:ring-brand-400"
        />
      </div>

      {tersaring.length === 0 ? (
        <div className="clay-card p-6 flex flex-col items-center text-center gap-2">
          <Icon name="inventory_2" className="text-[32px] text-text-muted" />
          <p className="font-body text-body text-text-secondary">
            Tidak ada invoice yang cocok dengan pencarian ini.
          </p>
        </div>
      ) : null}

      {tersaring.map((row) => {
        const terbukaBaris = terbuka === row.id;
        return (
          <article key={row.id} className="clay-card p-4 flex flex-col gap-2">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-body-bold text-body-bold text-text-primary">
                  {row.invoiceNumber}
                </p>
                <p className="font-caption text-caption text-text-muted">
                  {row.issuedAt
                    ? `${formatDateWib(row.issuedAt)} • ${formatTimeWib(row.issuedAt)} WIB`
                    : "-"}
                </p>
              </div>
              <span
                className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full font-caption text-caption shrink-0 ${
                  row.paymentState === "paid"
                    ? "bg-success-surface text-success-text"
                    : "bg-warning-surface text-warning-text"
                }`}
              >
                <Icon
                  name={row.paymentState === "paid" ? "task_alt" : "pending"}
                  className="text-[14px]"
                />
                {row.paymentState === "paid" ? "Lunas" : "Belum Lunas"}
              </span>
            </div>

            <div className="flex items-baseline justify-between gap-2">
              <span className="font-caption text-caption text-text-secondary truncate">
                {row.licensePlate} · {row.customerName}
              </span>
              <span className="font-body-bold text-body-bold text-text-primary shrink-0">
                {formatRupiah(row.totalPrice)}
              </span>
            </div>

            <div className="flex flex-wrap gap-1.5">
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-surface-container font-micro-badge text-micro-badge text-text-secondary">
                {STATUS_LABEL[row.status] ?? row.status}
              </span>
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-surface-container font-micro-badge text-micro-badge text-text-secondary">
                {PAYMENT_LABEL[row.paymentMethod] ?? row.paymentMethod}
              </span>
              {row.vehicleSize ? (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-surface-container font-micro-badge text-micro-badge text-text-secondary">
                  {sizeLabel(row.vehicleSize as VehicleSize)}
                </span>
              ) : null}
            </div>

            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={() => setTerbuka(terbukaBaris ? null : row.id)}
                className="flex-1 min-h-11 rounded-xl bg-surface-container text-text-secondary font-caption text-caption flex items-center justify-center gap-1.5 active:scale-95 transition-transform"
              >
                <Icon name="expand_more" className={`text-[18px] ${terbukaBaris ? "rotate-180" : ""}`} />
                {terbukaBaris ? "Tutup" : "Rincian"}
              </button>
              <a
                href={`/pos/orders/${row.orderId}`}
                className="flex-1 min-h-11 rounded-xl bg-brand-50 text-brand-700 font-caption text-caption flex items-center justify-center gap-1.5 active:scale-95 transition-transform"
              >
                <Icon name="receipt_long" className="text-[18px]" />
                Order
              </a>
              {row.trackingToken ? (
                <a
                  href={`/track/${row.trackingToken}`}
                  className="flex-1 min-h-11 rounded-xl bg-surface-container text-text-secondary font-caption text-caption flex items-center justify-center gap-1.5 active:scale-95 transition-transform"
                >
                  <Icon name="link" className="text-[18px]" />
                  Lacak
                </a>
              ) : null}
            </div>

            {terbukaBaris ? (
              <div className="pt-3 mt-1 border-t border-outline-variant/40 flex flex-col gap-3">
                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-xl bg-surface-container/60 p-2.5">
                    <p className="font-micro-badge text-micro-badge text-text-muted">
                      Kendaraan
                    </p>
                    <p className="font-body-bold text-caption text-text-primary">
                      {row.vehicleModel}
                    </p>
                  </div>
                  <div className="rounded-xl bg-surface-container/60 p-2.5">
                    <p className="font-micro-badge text-micro-badge text-text-muted">
                      Paket Layanan
                    </p>
                    <p className="font-body-bold text-caption text-text-primary">
                      {row.servicePackage}
                    </p>
                  </div>
                </div>

                {row.items.length > 0 ? (
                  <div className="flex flex-col gap-1.5">
                    <p className="font-body-bold text-caption text-text-secondary">
                      Rincian
                    </p>
                    {row.items.map((item, idx) => (
                      <div
                        key={`${row.id}-item-${idx}`}
                        className="flex items-center justify-between gap-2"
                      >
                        <span className="font-caption text-caption text-text-secondary truncate">
                          {item.quantity}x {item.name}
                        </span>
                        <span className="font-caption text-caption text-text-primary shrink-0">
                          {formatRupiah(item.total)}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="font-caption text-caption text-text-muted">
                    Rincian item tidak tersedia untuk invoice ini.
                  </p>
                )}

                <div className="flex flex-col gap-2">
                  <p className="font-body-bold text-caption text-text-secondary">
                    Cetak ulang
                  </p>
                  <ThermalPrintButton
                    receipt={toReceipt(row)}
                    label="Cetak struk"
                  />
                  {row.customerPhone ? (
                    <a
                      href={whatsappLink(
                        row.customerPhone,
                        `Halo ${row.customerName}, berikut salinan invoice ${row.invoiceNumber} dari RB Autoluxe. Nominal ${formatRupiah(row.totalPrice)}${
                          row.trackingToken
                            ? `. Lacak status: ${typeof window !== "undefined" ? window.location.origin : ""}/track/${row.trackingToken}`
                            : ""
                        }`,
                      )}
                      target="_blank"
                      rel="noreferrer"
                      className="min-h-11 rounded-xl bg-brand-50 text-brand-700 font-caption text-caption flex items-center justify-center gap-1.5 active:scale-95 transition-transform"
                    >
                      <Icon name="chat" className="text-[18px]" />
                      Kirim ulang ke WhatsApp
                    </a>
                  ) : null}
                </div>
              </div>
            ) : null}
          </article>
        );
      })}
    </main>
  );
}