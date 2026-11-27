"use client";

import { useState } from "react";
import Link from "next/link";
import { Icon } from "@/components/ui/icon";
import { Modal } from "@/components/ui/modal";
import { formatDateWib, formatRupiah, formatTimeWib } from "@/lib/format";
import { sizeLabel, whatsappLink, type VehicleSize } from "@/lib/pos";

export type PrintableInvoiceData = {
  orderId: string;
  orderNumber: string;
  invoiceNumber: string;
  createdAt: string;
  completedAt?: string | null;
  paidAt?: string | null;
  status: string;
  paymentState: string;
  paymentMethod: string;
  totalPrice: number;
  customerName: string;
  customerPhone?: string | null;
  licensePlate: string;
  vehicleModel: string;
  vehicleSize?: string | null;
  servicePackage: string;
  trackingToken?: string | null;
  branchName: string;
  branchAddress?: string | null;
  items: {
    name: string;
    quantity: number;
    price: number;
    total: number;
  }[];
  warranty?: {
    warrantyCode: string;
    startDate: string;
    endDate: string;
    status: string;
  } | null;
  maintenanceSchedules: {
    id: string;
    scheduleType: "6_month" | "12_month" | string;
    dueDate: string;
    status: "pending" | "reminded" | "completed" | "cancelled" | string;
    notes?: string | null;
  }[];
};

const PAYMENT_LABELS: Record<string, string> = {
  cash: "Tunai (Cash)",
  qris: "QRIS Payment",
  bank_transfer: "Transfer Bank",
};

export function InvoicePrintable({ data }: { data: PrintableInvoiceData }) {
  const [waModalOpen, setWaModalOpen] = useState(false);
  const [phoneInput, setPhoneInput] = useState(data.customerPhone ?? "");

  const handlePrint = () => {
    window.print();
  };

  const invoiceDate = data.paidAt || data.completedAt || data.createdAt;
  const isWash =
    data.servicePackage.toLowerCase().includes("wash") &&
    !data.servicePackage.toLowerCase().includes("coating") &&
    !data.servicePackage.toLowerCase().includes("polish");

  const isCoatingOrPolish =
    !isWash &&
    (data.servicePackage.toLowerCase().includes("coating") ||
      data.servicePackage.toLowerCase().includes("polish") ||
      data.servicePackage.toLowerCase().includes("poles") ||
      data.servicePackage.toLowerCase().includes("ceramic") ||
      data.servicePackage.toLowerCase().includes("detailing") ||
      Boolean(data.warranty));

  const m6 = isCoatingOrPolish
    ? data.maintenanceSchedules.find((s) => s.scheduleType === "6_month")
    : undefined;
  const m12 = isCoatingOrPolish
    ? data.maintenanceSchedules.find((s) => s.scheduleType === "12_month")
    : undefined;

  // Format link WhatsApp draft invoice
  const shareUrl = typeof window !== "undefined" ? window.location.href : "";
  const waDraftMessage =
    `*${isCoatingOrPolish ? "INVOICE & KARTU GARANSI RB AUTOLUXE" : "INVOICE PEMBAYARAN RB AUTOLUXE"}*\n\n` +
    `Halo Kak *${data.customerName || "Pelanggan"}*,\n` +
    `Terima kasih telah mempercayakan perawatan kendaraan Anda di RB AUTOLUXE.\n\n` +
    `📄 *No. Invoice:* ${data.invoiceNumber}\n` +
    `🚗 *Kendaraan:* ${data.vehicleModel} (${data.licensePlate})\n` +
    `💎 *Paket Layanan:* ${data.servicePackage}\n` +
    `💰 *Total Pembayaran:* ${formatRupiah(data.totalPrice)} *(LUNAS)*\n` +
    (data.warranty
      ? `🛡️ *Kode Garansi:* ${data.warranty.warrantyCode}\n` +
        `📅 *Masa Garansi:* ${formatDateWib(data.warranty.startDate)} s/d ${formatDateWib(data.warranty.endDate)}\n`
      : "") +
    (m6
      ? `\n⏰ *Jadwal Perawatan Berkala:*\n` +
        `• *Bulan ke-6:* ${formatDateWib(m6.dueDate)}\n` +
        (m12 ? `• *Bulan ke-12 (1 Thn):* ${formatDateWib(m12.dueDate)}\n` : "")
      : "") +
    `\nBuka invoice resmi: ${shareUrl}\n\n` +
    `RB AUTOLUXE - Premium Detailing & Paint Protection`;

  return (
    <div className="min-h-screen bg-surface-container-low pb-12 print:bg-white print:p-0 print:pb-0">
      {/* Top Action Bar - hidden when printing */}
      <header className="sticky top-0 z-40 clay-nav px-4 py-3 flex items-center justify-between gap-3 print:hidden">
        <div className="flex items-center gap-2">
          <Link
            href="/invoice"
            className="w-10 h-10 rounded-[8px] border border-border bg-surface flex items-center justify-center text-text-secondary hover:bg-surface-container transition-colors"
            aria-label="Kembali ke riwayat invoice"
          >
            <Icon name="arrow_back" className="text-[20px]" />
          </Link>
          <div>
            <h1 className="font-headline-3 text-headline-3 text-text-primary">
              {data.invoiceNumber}
            </h1>
            <p className="font-caption text-caption text-text-muted">
              {data.licensePlate} · {data.customerName}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setWaModalOpen(true)}
            className="h-10 px-3.5 rounded-[8px] bg-whatsapp text-white font-body-bold text-caption flex items-center gap-1.5 hover:opacity-90 transition-opacity shadow-sm"
          >
            <Icon name="chat" className="text-[18px]" />
            <span className="hidden sm:inline">Kirim ke WA</span>
          </button>
          <button
            type="button"
            onClick={handlePrint}
            className="h-10 px-4 rounded-[8px] primary-gradient clay-glow text-white font-body-bold text-caption flex items-center gap-1.5 hover:opacity-90 transition-opacity shadow-sm"
          >
            <Icon name="print" className="text-[18px]" />
            <span>Cetak / Simpan PDF</span>
          </button>
        </div>
      </header>

      {/* Main Printable A4 Document Sheet */}
      <main className="max-w-4xl mx-auto my-6 px-4 print:max-w-none print:m-0 print:p-0">
        <div className="bg-white rounded-[10px] shadow-lg border border-border p-6 sm:p-10 flex flex-col gap-6 print:rounded-none print:shadow-none print:border-none print:p-6 text-slate-800">
          {/* Header Workshop & Invoice Info */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-slate-200 pb-6">
            <div className="flex items-center gap-3.5">
              <div className="w-14 h-14 rounded-2xl bg-gradient-to-tr from-brand-900 via-brand-700 to-indigo-600 text-white flex items-center justify-center shadow-md print:shadow-none shrink-0">
                <span className="font-headline-1 font-black text-2xl tracking-tighter">RB</span>
              </div>
              <div>
                <h2 className="font-headline-1 text-xl sm:text-2xl font-black tracking-tight text-slate-900 uppercase">
                  RB Autoluxe
                </h2>
                <p className="text-xs font-semibold text-brand-700 uppercase tracking-wider">
                  Automotive Detailing &amp; Paint Protection
                </p>
                <p className="text-xs text-slate-500 mt-0.5 max-w-sm">
                  {data.branchName}
                  {data.branchAddress ? ` · ${data.branchAddress}` : ""}
                </p>
              </div>
            </div>

            <div className="text-left sm:text-right flex flex-col sm:items-end">
              <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 text-xs font-bold uppercase tracking-wider mb-1">
                <Icon name="task_alt" className="text-[14px]" />
                Lunas / Paid
              </span>
              <p className="text-lg font-black tracking-tight text-slate-900">
                {data.invoiceNumber}
              </p>
              <p className="text-xs text-slate-500">
                Tanggal: {formatDateWib(invoiceDate)} · {formatTimeWib(invoiceDate)} WIB
              </p>
            </div>
          </div>

          {/* Customer & Vehicle Info Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Customer Box */}
            <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200/80 flex flex-col gap-1">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                Data Pelanggan
              </span>
              <p className="text-base font-bold text-slate-900">
                {data.customerName || "Pelanggan Terhormat"}
              </p>
              <p className="text-xs text-slate-600 flex items-center gap-1 mt-0.5">
                <Icon name="phone" className="text-[14px] text-slate-400" />
                {data.customerPhone || "-"}
              </p>
            </div>

            {/* Vehicle Box */}
            <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200/80 flex flex-col gap-1">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                Kendaraan &amp; Ukuran
              </span>
              <div className="flex items-center justify-between gap-2">
                <p className="text-base font-bold text-slate-900">
                  {data.vehicleModel || "-"}
                </p>
                <span className="px-2.5 py-0.5 rounded-lg bg-brand-50 border border-brand-200 font-bold text-xs text-brand-800 shrink-0">
                  {data.licensePlate}
                </span>
              </div>
              <p className="text-xs text-slate-600 mt-0.5">
                Kategori Size:{" "}
                <span className="font-semibold text-slate-800">
                  {data.vehicleSize ? sizeLabel(data.vehicleSize as VehicleSize) : "Standar"}
                </span>
              </p>
            </div>
          </div>

          {/* Services & Payments Table */}
          <div className="flex flex-col gap-2">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
              Rincian Layanan &amp; Pengerjaan
            </span>
            <div className="rounded-2xl border border-slate-200 overflow-hidden">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-100/80 text-slate-600 text-xs uppercase font-bold border-b border-slate-200">
                  <tr>
                    <th className="py-3 px-4">Deskripsi Layanan</th>
                    <th className="py-3 px-3 text-center w-20">Qty</th>
                    <th className="py-3 px-4 text-right w-36">Harga</th>
                    <th className="py-3 px-4 text-right w-36">Subtotal</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.items.length > 0 ? (
                    data.items.map((item, idx) => (
                      <tr key={idx} className="hover:bg-slate-50/50">
                        <td className="py-3 px-4 font-semibold text-slate-900">
                          {item.name}
                        </td>
                        <td className="py-3 px-3 text-center text-slate-600 font-medium">
                          {item.quantity}
                        </td>
                        <td className="py-3 px-4 text-right text-slate-600">
                          {formatRupiah(item.price)}
                        </td>
                        <td className="py-3 px-4 text-right font-bold text-slate-900">
                          {formatRupiah(item.total)}
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td className="py-3 px-4 font-semibold text-slate-900">
                        {data.servicePackage}
                      </td>
                      <td className="py-3 px-3 text-center text-slate-600 font-medium">1</td>
                      <td className="py-3 px-4 text-right text-slate-600">
                        {formatRupiah(data.totalPrice)}
                      </td>
                      <td className="py-3 px-4 text-right font-bold text-slate-900">
                        {formatRupiah(data.totalPrice)}
                      </td>
                    </tr>
                  )}
                </tbody>
                <tfoot className="bg-slate-50/80 border-t border-slate-200 text-sm">
                  <tr>
                    <td colSpan={2} className="py-3 px-4 text-xs text-slate-500">
                      Metode Pembayaran:{" "}
                      <span className="font-semibold text-slate-800">
                        {PAYMENT_LABELS[data.paymentMethod] ?? data.paymentMethod}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right font-bold text-slate-700">Total Akhir</td>
                    <td className="py-3 px-4 text-right text-base font-black text-brand-700">
                      {formatRupiah(data.totalPrice)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          {/* Official Warranty Certificate Box (Jika ada garansi atau layanan coating) */}
          {data.warranty ? (
            <div className="rounded-2xl border-2 border-emerald-300 bg-gradient-to-r from-emerald-50/90 via-teal-50/60 to-emerald-50/90 p-4 sm:p-5 flex flex-col gap-3">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-2 text-emerald-800">
                  <Icon name="verified" className="text-[24px] text-emerald-600" />
                  <span className="font-black text-sm uppercase tracking-wider">
                    Sertifikat Garansi Resmi (Warranty Certificate)
                  </span>
                </div>
                <span className="px-3 py-1 rounded-full bg-emerald-600 text-white font-mono font-bold text-xs shadow-sm">
                  {data.warranty.warrantyCode}
                </span>
              </div>
              <p className="text-xs text-emerald-900/90 leading-relaxed">
                Kendaraan ini dilindungi garansi resmi kilau cat &amp; hydrophobic layer dari{" "}
                <span className="font-bold">{formatDateWib(data.warranty.startDate)}</span> sampai{" "}
                <span className="font-bold">{formatDateWib(data.warranty.endDate)}</span>.
                Klaim garansi berlaku di seluruh workshop resmi RB Autoluxe dengan menunjukkan nomor invoice atau kode garansi ini.
              </p>
            </div>
          ) : null}

          {/* Periodic Maintenance Schedule Section (Bulan ke-6 & Bulan ke-12) */}
          {isCoatingOrPolish ? (
            <div className="rounded-2xl border border-indigo-200 bg-indigo-50/50 p-4 sm:p-5 flex flex-col gap-3">
              <div className="flex items-center gap-2 text-indigo-900">
                <Icon name="event_repeat" className="text-[22px] text-indigo-600" />
                <span className="font-black text-sm uppercase tracking-wider">
                  Jadwal Perawatan Berkala (Periodic Maintenance)
                </span>
              </div>
              <p className="text-xs text-indigo-950/80">
                Untuk mempertahankan ketahanan coating, hidrofobik maksimal, dan keabsahan garansi, disarankan melakukan perawatan berkala pada tanggal rekomendasi berikut:
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-1">
                {/* Perawatan Bulan ke-6 */}
                <div className="p-3.5 rounded-xl bg-white border border-indigo-100 shadow-sm flex flex-col gap-1.5">
                  <div className="flex items-center justify-between">
                    <span className="px-2 py-0.5 rounded-md bg-indigo-100 text-indigo-800 text-[10px] font-bold uppercase tracking-wider">
                      Perawatan I (Bulan ke-6)
                    </span>
                    <Icon name="schedule" className="text-[16px] text-indigo-500" />
                  </div>
                  <p className="text-sm font-black text-indigo-950">
                    {m6 ? formatDateWib(m6.dueDate) : "6 Bulan setelah pengerjaan"}
                  </p>
                  <p className="text-[11px] text-slate-500 leading-snug">
                    Pembersihan kerak air/jamur, deep decontamination wash, serta peremajaan layer hidrofobik.
                  </p>
                </div>

                {/* Perawatan Bulan ke-12 (1 Tahun) */}
                <div className="p-3.5 rounded-xl bg-white border border-indigo-100 shadow-sm flex flex-col gap-1.5">
                  <div className="flex items-center justify-between">
                    <span className="px-2 py-0.5 rounded-md bg-purple-100 text-purple-800 text-[10px] font-bold uppercase tracking-wider">
                      Perawatan II (Bulan ke-12 / 1 Thn)
                    </span>
                    <Icon name="verified_user" className="text-[16px] text-purple-500" />
                  </div>
                  <p className="text-sm font-black text-purple-950">
                    {m12 ? formatDateWib(m12.dueDate) : "12 Bulan setelah pengerjaan"}
                  </p>
                  <p className="text-[11px] text-slate-500 leading-snug">
                    Inspeksi tahunan ketebalan coating, evaluasi garansi, &amp; re-coating top protection layer.
                  </p>
                </div>
              </div>
            </div>
          ) : null}

          {/* Terms & Signatures */}
          <div className="border-t border-slate-200 pt-6 mt-2 flex flex-col sm:flex-row items-end justify-between gap-6 text-xs text-slate-500">
            <div className="max-w-md flex flex-col gap-1">
              <span className="font-bold text-slate-700 uppercase tracking-wider text-[10px]">
                Ketentuan Layanan &amp; Garansi
              </span>
              <p className="text-[11px] leading-relaxed text-slate-500">
                1. Garansi mencakup pengelupasan lapisan coating dan penurunan signifikan efek tolak air (hydrophobic).
                <br />
                2. Hindari mencuci kendaraan dengan sampo cuci piring/deterjen keras atau spons kasar.
                <br />
                3. Invoice digital ini merupakan bukti bayar sah workshop resmi RB Autoluxe.
              </p>
            </div>

            <div className="flex items-center gap-8 text-center shrink-0">
              <div className="flex flex-col items-center gap-10">
                <span className="text-[10px] uppercase font-bold text-slate-400">
                  Pelanggan
                </span>
                <span className="font-semibold text-slate-800 border-t border-slate-300 pt-1 px-4">
                  {data.customerName || "Pelanggan"}
                </span>
              </div>
              <div className="flex flex-col items-center gap-10">
                <span className="text-[10px] uppercase font-bold text-slate-400">
                  Workshop Manager
                </span>
                <span className="font-semibold text-slate-800 border-t border-slate-300 pt-1 px-4">
                  RB Autoluxe
                </span>
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* Modal Kirim WhatsApp Draft */}
      {waModalOpen && (
        <Modal
          open={waModalOpen}
          onClose={() => setWaModalOpen(false)}
          title="Kirim Draft Invoice & Garansi"
        >
          <label className="flex flex-col gap-1.5">
            <span className="font-caption text-caption text-text-secondary">
              Nomor WhatsApp Tujuan
            </span>
            <input
              type="tel"
              value={phoneInput}
              onChange={(e) => setPhoneInput(e.target.value)}
              placeholder="08123456789"
              className="h-11 px-3.5 rounded-[8px] border border-border bg-surface font-body text-body text-text-primary outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
            />
            <span className="text-[11px] text-text-muted">
              Dapat berupa nomor pelanggan atau nomor kasir/admin.
            </span>
          </label>

          <div className="p-3 rounded-[8px] bg-surface-container-low text-xs text-text-secondary whitespace-pre-wrap max-h-48 overflow-y-auto border border-border">
            {waDraftMessage}
          </div>

          <div className="flex gap-2 justify-end pt-2">
            <button
              type="button"
              onClick={() => setWaModalOpen(false)}
              className="h-11 px-4 rounded-[8px] border border-border bg-surface text-text-secondary font-body-bold text-caption hover:bg-surface-container transition-colors"
            >
              Batal
            </button>
            <a
              href={whatsappLink(phoneInput.trim(), waDraftMessage)}
              target="_blank"
              rel="noreferrer"
              onClick={() => setWaModalOpen(false)}
              className={`h-11 px-5 rounded-[8px] font-body-bold text-caption text-white flex items-center gap-2 hover:opacity-90 transition-opacity shadow-sm ${
                phoneInput.trim() ? "bg-whatsapp" : "bg-surface-container text-text-muted pointer-events-none opacity-50"
              }`}
            >
              <Icon name="send" className="text-[18px]" />
              Kirim via WhatsApp
            </a>
          </div>
        </Modal>
      )}
    </div>
  );
}
