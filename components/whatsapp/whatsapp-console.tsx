"use client";

import { useMemo, useState } from "react";
import { formatDateWib, formatRupiah, formatTimeWib } from "@/lib/format";
import {
  PAYMENT_LABELS,
  formatAngka,
  normalizeWaNumber,
  whatsappLink,
} from "@/lib/pos";
import { Icon } from "@/components/ui/icon";

export type WaOrderItem = {
  name: string;
  price: number;
  quantity: number;
};

export type WaOrder = {
  id: string;
  orderNumber: string;
  customerName: string;
  customerPhone: string | null;
  licensePlate: string;
  vehicleModel: string;
  vehicleSize: string;
  servicePackage: string;
  status: string;
  totalPrice: number;
  paymentMethod: string | null;
  paymentState: string | null;
  trackingToken: string;
  createdAt: string;
  completedAt: string | null;
  items: WaOrderItem[];
  warranty: { warrantyCode: string; endDate: string; status: string } | null;
};

export type WaClaim = {
  orderId: string;
  claimDate: string;
  status: string;
  problemDescription: string;
  resolutionNote: string | null;
};

const STATUS_LABEL: Record<string, string> = {
  queued: "Dalam Antrean",
  in_progress: "Sedang Dikerjakan",
  qc_review: "Menunggu Quality Control",
  completed: "Pengerjaan Selesai",
  // Dua status di bawah ada sejak migrasi 0030. Tanpa entri, pesan yang
  // dikirim ke pelanggan menuliskan status kosong.
  menunggu_diambil: "Siap Diambil",
  diserahkan: "Sudah Diserahkan",
  cancelled: "Dibatalkan",
};

const TEMPLATES = [
  { key: "nota", label: "Nota Transaksi", icon: "receipt_long" },
  { key: "status", label: "Update Status", icon: "progress_activity" },
  { key: "lacak", label: "Tautan Lacak", icon: "link" },
  { key: "garansi", label: "Sertifikat Garansi", icon: "verified_user" },
  { key: "klaim", label: "Status Klaim", icon: "support_agent" },
  { key: "custom", label: "Pesan Bebas", icon: "edit_note" },
] as const;

type TemplateKey = (typeof TEMPLATES)[number]["key"];

const CLAIM_STATUS_LABEL: Record<string, string> = {
  pending: "sedang ditinjau tim kami",
  approved: "disetujui",
  rejected: "belum disetujui",
};

export function WhatsappConsole({
  orders,
  claims,
  branchName,
  origin,
}: {
  orders: WaOrder[];
  claims: WaClaim[];
  branchName: string;
  origin: string;
}) {
  const [template, setTemplate] = useState<TemplateKey>("nota");
  const [selectedId, setSelectedId] = useState<string>(orders[0]?.id ?? "");
  const [freeText, setFreeText] = useState("");
  const [copied, setCopied] = useState(false);

  const selected = useMemo(
    () => orders.find((o) => o.id === selectedId) ?? null,
    [orders, selectedId],
  );

  const claimByOrderId = useMemo(() => {
    const map = new Map<string, WaClaim>();
    for (const claim of claims) map.set(claim.orderId, claim);
    return map;
  }, [claims]);

  const estimate = useMemo(() => {
    if (!selected) return "-";
    const base = new Date(selected.createdAt).getTime();
    const hours =
      selected.status === "queued"
        ? 2
        : selected.status === "in_progress"
          ? 3
          : selected.status === "qc_review"
            ? 1
            : 0;
    return formatDateWib(new Date(base + hours * 3600000).toISOString());
  }, [selected]);

  const message = useMemo(() => {
    if (template === "custom") return freeText.trim();

    if (!selected) {
      return "Pilih order terlebih dahulu.";
    }

    const greeting = `Halo ${selected.customerName || "Pelanggan"},`;
    const trackUrl = `${origin.replace(/\/$/, "")}/track/${selected.trackingToken}`;
    const header =
      branchName && branchName.trim().toUpperCase() !== "RB AUTOLUXE"
        ? `*RB AUTOLUXE* - ${branchName.trim()}`
        : "*RB AUTOLUXE*";

    if (template === "nota") {
      const lines = [
        header,
        greeting,
        "",
        `No. Order  : ${selected.orderNumber}`,
        `Kendaraan  : ${selected.vehicleModel} (${selected.vehicleSize})`,
        `Plat       : ${selected.licensePlate}`,
        `Layanan    : ${selected.servicePackage}`,
        "",
        "*Rincian*",
        // Harga per baris harus dikalikan jumlah, sama seperti struk POS di
        // lib/pos.ts. Tanpa itu rincian tidak menjumlah ke TOTAL.
        ...selected.items.map(
          (item) =>
            `${item.quantity}x ${item.name} - Rp ${formatAngka(item.price * item.quantity).replace(/,/g, ".")}`,
        ),
        "",
        `*TOTAL: ${formatRupiah(selected.totalPrice)}*`,
        `Pembayaran: ${
          selected.paymentState === "unpaid"
            ? "Belum dibayar"
            : (PAYMENT_LABELS[selected.paymentMethod ?? ""] ?? "-")
        }`,
        "",
        `Lacak progres: ${trackUrl}`,
        "",
        "Terima kasih telah mempercayakan kendaraan Anda di RB AUTOLUXE.",
      ];
      return lines.join("\n");
    }

    if (template === "status") {
      return [
        header,
        greeting,
        "",
        `Unit ${selected.licensePlate} (${selected.vehicleModel})`,
        `Status  : ${STATUS_LABEL[selected.status] ?? selected.status}`,
        `Layanan : ${selected.servicePackage}`,
        `Estimasi: ${estimate}`,
        "",
        `Lacak detail: ${trackUrl}`,
      ].join("\n");
    }

    if (template === "lacak") {
      return [
        header,
        greeting,
        "",
        `Berikut tautan pelacakan pengerjaan unit ${selected.licensePlate}:`,
        trackUrl,
        "",
        "Kode lacak: " + selected.trackingToken,
      ].join("\n");
    }

    if (template === "garansi") {
      if (!selected.warranty) {
        return [
          header,
          greeting,
          "",
          `Layanan ${selected.servicePackage} pada order ${selected.orderNumber} tidak didukung sertifikat garansi.`,
          "",
          `Lacak progres: ${trackUrl}`,
        ].join("\n");
      }

      return [
        header,
        greeting,
        "",
        `Sertifikat garansi untuk order ${selected.orderNumber}:`,
        `Kode garansi : ${selected.warranty.warrantyCode}`,
        `Berlaku s/d  : ${formatDateWib(selected.warranty.endDate)}`,
        `Status       : ${selected.warranty.status}`,
        "",
        `Lacak progres: ${trackUrl}`,
        "",
        "Simpan pesan ini sebagai bukti klaim garansi.",
      ].join("\n");
    }

    const claim = claimByOrderId.get(selected.id);
    if (!claim) {
      return [
        header,
        greeting,
        "",
        "Kami belum menerima klaim untuk unit ini.",
        "Silakan informasikan keluhan Anda melalui kasir atau teknisi kami.",
        "",
        `Lacak progres: ${trackUrl}`,
      ].join("\n");
    }

    return [
      header,
      greeting,
      "",
      `Klaim Anda untuk unit ${selected.licensePlate} (order ${selected.orderNumber})`,
      `Keluhan  : ${claim.problemDescription}`,
      `Status   : ${CLAIM_STATUS_LABEL[claim.status] ?? claim.status}`,
      ...(claim.resolutionNote ? [`Tindak lanjut: ${claim.resolutionNote}`] : []),
      "",
      `Lacak progres: ${trackUrl}`,
    ].join("\n");
  }, [branchName, claimByOrderId, estimate, freeText, origin, selected, template]);

  const phone = normalizeWaNumber(selected?.customerPhone ?? "");

  const waHref = useMemo(() => {
    if (template === "custom") {
      return phone
        ? whatsappLink(phone, message)
        : `https://wa.me/?text=${encodeURIComponent(message)}`;
    }
    if (!selected) return null;
    return whatsappLink(selected.customerPhone ?? "", message);
  }, [message, phone, selected, template]);

  async function copyMessage() {
    try {
      await navigator.clipboard.writeText(message);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  const messageCount = message.length;

  return (
    <div className="min-h-screen bg-canvas">
      <div className="pb-nav-plain px-gutter pt-4 space-y-space-lg">
        <section className="clay-card flex flex-col gap-space-md p-space-lg">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="font-headline-2 text-headline-2 text-text-primary">
                Kirim Pesan WhatsApp
              </h2>
              <p className="font-caption text-caption text-text-muted">
                Draf otomatis dari data order {branchName}
              </p>
            </div>
            <span className="px-2 py-0.5 rounded-full bg-brand-50 text-brand-600 font-micro-badge text-micro-badge whitespace-nowrap">
              {orders.length} order
            </span>
          </div>

          <div className="flex gap-space-xs overflow-x-auto pb-1">
            {TEMPLATES.map((tpl) => (
              <button
                key={tpl.key}
                type="button"
                onClick={() => setTemplate(tpl.key)}
                className={`px-3 py-2 min-h-10 rounded-xl font-caption text-caption whitespace-nowrap flex items-center gap-1 ${
                  template === tpl.key
                    ? "bg-brand-50 text-brand-600"
                    : "bg-surface-container-low text-text-secondary"
                }`}
              >
                <Icon name={tpl.icon} className="text-[15px]" />
                {tpl.label}
              </button>
            ))}
          </div>

          {template === "custom" ? (
            <label className="flex flex-col gap-space-xs">
              <span className="font-caption text-caption text-text-secondary">
                Isi pesan
              </span>
              <textarea
                value={freeText}
                onChange={(event) => setFreeText(event.target.value)}
                rows={5}
                placeholder="Tulis pesan bebas untuk pelanggan..."
                className="rounded-xl bg-surface px-3 py-2 font-body-regular text-body-regular text-text-primary shadow-[inset_0px_2px_4px_rgba(15,23,42,0.06)]"
              />
            </label>
          ) : (
            <label className="flex flex-col gap-space-xs">
              <span className="font-caption text-caption text-text-secondary">
                Pilih order
              </span>
              <select
                value={selectedId}
                onChange={(event) => setSelectedId(event.target.value)}
                className="h-12 rounded-xl bg-surface px-3 font-body-regular text-body-regular text-text-primary shadow-[inset_0px_2px_4px_rgba(15,23,42,0.06)]"
              >
                <option value="">Pilih order...</option>
                {orders.map((order) => (
                  <option key={order.id} value={order.id}>
                    {order.orderNumber} - {order.customerName} ({order.licensePlate})
                  </option>
                ))}
              </select>
            </label>
          )}

          {selected && template !== "custom" ? (
            <div className="rounded-xl bg-surface-container-low px-3 py-2.5 flex flex-col gap-1">
              <div className="flex items-center justify-between gap-2">
                <span className="font-caption text-caption text-text-secondary">
                  Pelanggan
                </span>
                <span className="font-body-bold text-body-bold text-text-primary">
                  {selected.customerName}
                </span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="font-caption text-caption text-text-secondary">
                  Nomor WhatsApp
                </span>
                <span
                  className={`font-caption text-caption ${phone ? "text-text-primary" : "text-danger-text"}`}
                >
                  {phone ? `+${phone}` : "tidak tersedia"}
                </span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="font-caption text-caption text-text-secondary">
                  Status
                </span>
                <span className="font-caption text-caption text-text-primary">
                  {STATUS_LABEL[selected.status] ?? selected.status}
                </span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="font-caption text-caption text-text-secondary">
                  Dibuat
                </span>
                <span className="font-caption text-caption text-text-primary">
                  {formatDateWib(selected.createdAt)} {formatTimeWib(selected.createdAt)}
                </span>
              </div>
            </div>
          ) : null}

          <div className="clay-card p-space-md flex flex-col gap-space-xs bg-surface">
            <div className="flex items-center justify-between">
              <p className="font-body-bold text-body-bold text-text-primary">
                Pratinjau Pesan
              </p>
              <span className="font-micro-badge text-micro-badge text-text-muted">
                {messageCount} karakter
              </span>
            </div>
            <p className="font-body-regular text-body-regular text-text-primary whitespace-pre-wrap max-h-72 overflow-y-auto">
              {message}
            </p>
          </div>

          <div className="flex flex-col gap-space-sm">
            {waHref ? (
              <a
                href={waHref}
                target="_blank"
                rel="noopener noreferrer"
                className="h-[50px] rounded-full bg-gradient-to-r from-emerald-600 to-whatsapp flex items-center justify-center gap-2 text-on-primary font-body-bold text-body-bold shadow-[0px_10px_22px_rgba(34,197,94,0.32)]"
              >
                <Icon name="chat" />
                {phone
                  ? `Kirim ke +${phone}`
                  : "Buka WhatsApp (pilih kontak)"}
              </a>
            ) : null}

            <div className="grid grid-cols-2 gap-space-sm">
              <button
                type="button"
                onClick={copyMessage}
                className="h-12 rounded-2xl bg-surface-container-low text-text-secondary font-caption text-caption flex items-center justify-center gap-2"
              >
                <Icon name={copied ? "check" : "content_copy"} className="text-[18px]" />
                {copied ? "Tersalin" : "Salin pesan"}
              </button>
              <button
                type="button"
                onClick={() => setTemplate("custom")}
                className="h-12 rounded-2xl bg-surface-container-low text-text-secondary font-caption text-caption flex items-center justify-center gap-2"
              >
                <Icon name="edit_note" className="text-[18px]" />
                Tulis sendiri
              </button>
            </div>
          </div>
        </section>

        <section className="clay-card flex flex-col gap-space-md p-space-lg">
          <div className="flex items-center justify-between">
            <h2 className="font-headline-2 text-headline-2 text-text-primary">
              Order dengan Nomor WhatsApp
            </h2>
            <span className="font-caption text-caption text-text-muted">
              {orders.filter((o) => normalizeWaNumber(o.customerPhone)).length}/{orders.length}
            </span>
          </div>
          <p className="font-caption text-caption text-text-muted">
            Order tanpa nomor WhatsApp tetap bisa memakai template, namun
            WhatsApp akan terbuka tanpa penerima sehingga kasir perlu memilih
            kontak secara manual.
          </p>
        </section>
      </div>
    </div>
  );
}