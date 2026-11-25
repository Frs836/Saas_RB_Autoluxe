"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/toast";
import { Icon } from "@/components/ui/icon";
import { Modal } from "@/components/ui/modal";
import { formatAngka } from "@/lib/pos";
import {
  createBundleClaimAction,
  confirmBundleClaimAction,
  rejectBundleClaimAction,
  setBundleDefinitionAction,
  deleteBundleAction,
  opnameBundleAction,
  opnameBundleBatchAction,
} from "@/app/actions/stok";

// ─── Types ───────────────────────────────────────────────────────────────────

export type BundleComponent = {
  item_id: string;
  item_name: string;
  unit: string;
  quantity: number;
  unit_cost: number;
  current_stock?: number;
};

export type BundleItem = {
  id: string;
  bundle_name: string;
  unit: string;
  output_qty: number;
  current_stock: number;
  description: string | null;
  components: BundleComponent[];
  total_hpp_batch: number;
  hpp_per_unit: number;
};

export type ActiveOrderOption = {
  id: string;
  order_number: string | null;
  license_plate: string;
  customer_name: string;
  vehicle_size: string | null;
};

export type BundleClaim = {
  id: string;
  bundle_id: string;
  bundle_name: string;
  quantity: number;
  unit: string;
  claim_type: "produce" | "use";
  note: string | null;
  order_id: string | null;
  order_label: string | null;
  status: string; // pending | confirmed | rejected
  claimed_by_name: string;
  confirmed_by_name: string | null;
  created_at: string;
  confirmed_at: string | null;
  components: BundleComponent[];
};

export type AvailableItem = {
  id: string;
  item_name: string;
  unit: string;
  unit_cost: number;
  current_stock?: number;
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

const STATUS_MAP: Record<string, { label: string; cls: string; icon: string }> = {
  pending: {
    label: "Menunggu Persetujuan",
    cls: "bg-warning-surface text-warning-text",
    icon: "pending",
  },
  confirmed: {
    label: "Disetujui",
    cls: "bg-success-surface text-success-text",
    icon: "task_alt",
  },
  rejected: {
    label: "Ditolak",
    cls: "bg-danger-surface text-danger-text",
    icon: "block",
  },
};

function formatRupiah(value: number): string {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(value);
}

function formatDateTimeWib(value: string | null | undefined): string {
  if (!value) return "-";
  const date = new Date(value);
  const formatted = new Intl.DateTimeFormat("id-ID", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Jakarta",
  }).format(date);
  return `${formatted} WIB`;
}

// ─── Modal 1: Produksi Racikan (Trigger Potong Bahan Baku & Tambah Stok) ─────

function ProductionModal({
  bundles,
  initialBundle,
  availableItems,
  onClose,
}: {
  bundles: BundleItem[];
  initialBundle: BundleItem | null;
  availableItems: AvailableItem[];
  onClose: () => void;
}) {
  const toast = useToast();
  const router = useRouter();
  const [selectedId, setSelectedId] = useState<string>(
    initialBundle?.id ?? (bundles[0]?.id || ""),
  );
  const [batchCount, setBatchCount] = useState("1");
  const [note, setNote] = useState("");
  const [pending, startTransition] = useTransition();

  const bundle = bundles.find((b) => b.id === selectedId) ?? initialBundle ?? bundles[0];
  const itemById = useMemo(
    () => Object.fromEntries(availableItems.map((i) => [i.id, i])),
    [availableItems],
  );

  const batches = Math.max(1, Number(batchCount) || 1);
  const totalProduced = bundle ? batches * (bundle.output_qty || 1) : 0;
  const totalCost = bundle ? batches * (bundle.total_hpp_batch || 0) : 0;

  // Cek kecukupan stok bahan baku di gudang
  const materialChecks = useMemo(() => {
    if (!bundle) return [];
    return bundle.components.map((comp) => {
      const inv = itemById[comp.item_id];
      const available = inv?.current_stock ?? comp.current_stock ?? 0;
      const needed = comp.quantity * batches;
      return {
        ...comp,
        available,
        needed,
        isSufficient: available >= needed,
      };
    });
  }, [bundle, batches, itemById]);

  const hasInsufficientStock = materialChecks.some((c) => !c.isSufficient);

  function handleSubmit() {
    if (!bundle) return;
    const qtyNum = Number(batchCount);
    if (!qtyNum || qtyNum <= 0) {
      toast.gagal("Jumlah tidak valid", "Jumlah batch produksi harus lebih dari 0");
      return;
    }

    startTransition(async () => {
      const res = await createBundleClaimAction({
        p_bundle_id: bundle.id,
        p_quantity: qtyNum,
        p_claim_type: "produce",
        p_note: note.trim() || undefined,
      });

      if (res.ok) {
        toast.sukses(
          "Pengajuan Produksi Terkirim",
          `Pengajuan produksi ${bundle.bundle_name} (${qtyNum} batch) berhasil dikirim untuk diverifikasi.`,
        );
        onClose();
        router.refresh();
      } else {
        toast.gagal("Gagal mengajukan", res.message ?? "Terjadi kesalahan sistem");
      }
    });
  }

  return (
    <Modal open onClose={onClose} title="Produksi / Tambah Stok Racikan">
      <div className="flex flex-col gap-4">
        {/* Pilih Racikan jika belum spesifik */}
        {bundles.length > 1 && (
          <div className="flex flex-col gap-1">
            <label className="font-label text-label text-text-secondary">Pilih Racikan</label>
            <select
              value={selectedId}
              onChange={(e) => setSelectedId(e.target.value)}
              className="w-full rounded-2xl border border-outline-variant bg-surface-container-low px-4 py-3 text-text-primary font-body text-body outline-none focus:border-brand-500"
            >
              {bundles.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.bundle_name} (Sisa fisik: {formatAngka(b.current_stock)} {b.unit})
                </option>
              ))}
            </select>
          </div>
        )}

        {bundle ? (
          <>
            {/* Kartu Estimasi Hasil Produksi */}
            <div className="rounded-2xl bg-brand-50 border border-brand-200/80 p-4 flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="font-caption text-caption text-brand-700 font-medium">
                  Estimasi Tambahan Stok Racikan:
                </span>
                <span className="font-headline-2 text-headline-2 text-brand-900">
                  +{formatAngka(totalProduced)} {bundle.unit}
                </span>
              </div>
              <div className="flex justify-between items-center text-xs text-brand-700 border-t border-brand-200/60 pt-2">
                <span>
                  {batches} batch @ {formatAngka(bundle.output_qty)} {bundle.unit}
                </span>
                <span className="font-semibold">Estimasi HPP Total: {formatRupiah(totalCost)}</span>
              </div>
            </div>

            {/* Input Berapa Batch */}
            <div className="flex flex-col gap-1">
              <label className="font-label text-label text-text-secondary">
                Berapa Kali Meracik (Batch)?
              </label>
              <input
                type="number"
                min="1"
                step="1"
                value={batchCount}
                onChange={(e) => setBatchCount(e.target.value)}
                placeholder="1"
                className="w-full rounded-2xl border border-outline-variant bg-surface-container-low px-4 py-3 text-text-primary font-body text-body outline-none focus:border-brand-500"
              />
              <span className="font-caption text-caption text-text-muted mt-0.5">
                1 batch menghasilkan {formatAngka(bundle.output_qty)} {bundle.unit} racikan siap pakai.
              </span>
            </div>

            {/* Rincian Bahan Baku yang Akan Terpotong dari Gudang */}
            <div className="rounded-2xl bg-surface-container-low p-3.5 flex flex-col gap-2 border border-outline-variant/40">
              <span className="font-label text-label text-text-secondary">
                Bahan Baku Gudang yang Akan Terpotong:
              </span>
              <div className="flex flex-col gap-1.5">
                {materialChecks.map((c) => (
                  <div
                    key={c.item_id}
                    className="flex items-center justify-between text-xs py-1 border-b border-outline-variant/30 last:border-none"
                  >
                    <div className="flex flex-col min-w-0">
                      <span className="font-medium text-text-primary truncate">{c.item_name}</span>
                      <span className="text-[11px] text-text-muted">
                        Stok gudang: {formatAngka(c.available)} {c.unit}
                      </span>
                    </div>
                    <div className="flex flex-col items-end shrink-0">
                      <span
                        className={`font-semibold ${
                          c.isSufficient ? "text-text-primary" : "text-danger-text"
                        }`}
                      >
                        -{formatAngka(c.needed)} {c.unit}
                      </span>
                      {!c.isSufficient && (
                        <span className="text-[10px] text-danger-text font-bold">Stok kurang!</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {hasInsufficientStock && (
              <div className="p-3 rounded-xl bg-danger-surface text-danger-text text-xs flex items-center gap-2">
                <Icon name="block" className="text-[18px] shrink-0" />
                <span>
                  Perhatian: Sebagian bahan baku di gudang tidak mencukupi untuk {batches} batch.
                  Pengajuan tetap dapat dikirim namun persetujuan membutuhkan stok yang cukup.
                </span>
              </div>
            )}

            {/* Catatan Tambahan */}
            <div className="flex flex-col gap-1">
              <label className="font-label text-label text-text-secondary">
                Catatan Produksi (opsional)
              </label>
              <textarea
                rows={2}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="mis: Persiapan semir ban untuk akhir pekan"
                className="w-full rounded-2xl border border-outline-variant bg-surface-container-low px-4 py-2.5 text-text-primary font-body text-body outline-none focus:border-brand-500 resize-none"
              />
            </div>

            <button
              type="button"
              disabled={pending}
              onClick={handleSubmit}
              className="w-full rounded-2xl bg-brand-500 text-white font-label-bold text-label-bold py-3.5 flex items-center justify-center gap-2 transition-transform disabled:opacity-50"
            >
              <Icon name="science" className="text-[20px]" />
              {pending ? "Mengajukan Produksi…" : "Ajukan Produksi Racikan"}
            </button>
          </>
        ) : (
          <p className="text-text-muted text-sm py-4 text-center">Belum ada data racikan.</p>
        )}
      </div>
    </Modal>
  );
}

// ─── Modal 2: Klaim Pemakaian Racikan (Ambil dari Stok Fisik) ────────────────

function ClaimUsageModal({
  bundle,
  activeOrders,
  onClose,
}: {
  bundle: BundleItem;
  activeOrders: ActiveOrderOption[];
  onClose: () => void;
}) {
  const toast = useToast();
  const router = useRouter();
  const [qty, setQty] = useState("50");
  const [selectedOrderId, setSelectedOrderId] = useState<string>("");
  const [note, setNote] = useState("");
  const [pending, startTransition] = useTransition();

  function handleSubmit() {
    const qtyNum = Number(qty);
    if (!qtyNum || qtyNum <= 0) {
      toast.gagal("Jumlah tidak valid", `Jumlah pemakaian harus lebih dari 0 ${bundle.unit}`);
      return;
    }

    startTransition(async () => {
      const res = await createBundleClaimAction({
        p_bundle_id: bundle.id,
        p_quantity: qtyNum,
        p_claim_type: "use",
        p_order_id: selectedOrderId || undefined,
        p_note: note.trim() || undefined,
      });

      if (res.ok) {
        toast.sukses(
          "Klaim Pemakaian Diajukan",
          `Pengajuan pemakaian ${qtyNum} ${bundle.unit} ${bundle.bundle_name} berhasil dikirim.`,
        );
        onClose();
        router.refresh();
      } else {
        toast.gagal("Gagal mengajukan", res.message ?? "Terjadi kesalahan sistem");
      }
    });
  }

  return (
    <Modal open onClose={onClose} title={`Klaim Pemakaian - ${bundle.bundle_name}`}>
      <div className="flex flex-col gap-4">
        {/* Info Sisa Stok Fisik */}
        <div className="rounded-2xl bg-surface-container-low p-3.5 flex items-center justify-between border border-outline-variant/40">
          <span className="font-caption text-caption text-text-muted">Stok Fisik Tersedia:</span>
          <span className="font-body-bold text-body-bold text-text-primary">
            {formatAngka(bundle.current_stock)} {bundle.unit}
          </span>
        </div>

        {/* Input Jumlah Diambil */}
        <div className="flex flex-col gap-1">
          <label className="font-label text-label text-text-secondary">
            Jumlah yang Diambil / Dipakai ({bundle.unit})
          </label>
          <input
            type="number"
            min="0.1"
            step="any"
            value={qty}
            onChange={(e) => setQty(e.target.value)}
            placeholder="50"
            className="w-full rounded-2xl border border-outline-variant bg-surface-container-low px-4 py-3 text-text-primary font-body text-body outline-none focus:border-brand-500"
          />
        </div>

        {/* Tautan Order Aktif */}
        <div className="flex flex-col gap-1">
          <label className="font-label text-label text-text-secondary">
            Keperluan / Tautkan ke Order (Opsional)
          </label>
          <select
            value={selectedOrderId}
            onChange={(e) => setSelectedOrderId(e.target.value)}
            className="w-full rounded-2xl border border-outline-variant bg-surface-container-low px-3 py-3 text-text-primary font-body text-body outline-none focus:border-brand-500"
          >
            <option value="">Lainnya / Operasional Bengkel</option>
            {activeOrders.map((ord) => (
              <option key={ord.id} value={ord.id}>
                {ord.order_number ? `#${ord.order_number} - ` : ""}
                {ord.license_plate} ({ord.customer_name}
                {ord.vehicle_size ? ` - ${ord.vehicle_size}` : ""})
              </option>
            ))}
          </select>
          <span className="font-caption text-caption text-text-muted">
            Tautkan ke order kendaraan jika racikan ini diambil untuk pengerjaan unit tersebut.
          </span>
        </div>

        {/* Catatan Tambahan */}
        <div className="flex flex-col gap-1">
          <label className="font-label text-label text-text-secondary">
            Catatan Keperluan (opsional)
          </label>
          <textarea
            rows={2}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="mis: Tambahan cairan untuk velg ekstra kotor"
            className="w-full rounded-2xl border border-outline-variant bg-surface-container-low px-4 py-2.5 text-text-primary font-body text-body outline-none focus:border-brand-500 resize-none"
          />
        </div>

        <button
          type="button"
          disabled={pending}
          onClick={handleSubmit}
          className="w-full rounded-2xl bg-brand-500 text-white font-label-bold text-label-bold py-3.5 flex items-center justify-center gap-2 transition-transform disabled:opacity-50"
        >
          <Icon name="shopping_cart_checkout" className="text-[20px]" />
          {pending ? "Mengajukan Klaim…" : "Ajukan Klaim Pemakaian"}
        </button>
      </div>
    </Modal>
  );
}

// ─── Modal 3: Opname Fisik Racikan ───────────────────────────────────────────

function OpnameModal({
  bundle,
  onClose,
}: {
  bundle: BundleItem;
  onClose: () => void;
}) {
  const toast = useToast();
  const router = useRouter();
  const [physicalQty, setPhysicalQty] = useState(String(bundle.current_stock));
  const [note, setNote] = useState("");
  const [pending, startTransition] = useTransition();

  const parsedQty = Number(physicalQty) || 0;
  const difference = parsedQty - bundle.current_stock;

  function handleSubmit() {
    if (parsedQty < 0) {
      toast.gagal("Nilai tidak valid", "Stok fisik tidak boleh kurang dari 0");
      return;
    }

    startTransition(async () => {
      const res = await opnameBundleAction({
        p_bundle_id: bundle.id,
        p_physical_qty: parsedQty,
        p_note: note.trim() || undefined,
      });

      if (res.ok) {
        toast.sukses(
          "Opname Disimpan",
          `Stok fisik ${bundle.bundle_name} disesuaikan menjadi ${formatAngka(parsedQty)} ${bundle.unit}.`,
        );
        onClose();
        router.refresh();
      } else {
        toast.gagal("Gagal opname", res.message ?? "Terjadi kesalahan sistem");
      }
    });
  }

  return (
    <Modal open onClose={onClose} title={`Opname Fisik - ${bundle.bundle_name}`}>
      <div className="flex flex-col gap-4">
        {/* Stok Sistem Saat Ini */}
        <div className="rounded-2xl bg-surface-container-low p-3.5 flex items-center justify-between border border-outline-variant/40">
          <span className="font-caption text-caption text-text-muted">Stok Tercatat di Sistem:</span>
          <span className="font-body-bold text-body-bold text-text-primary">
            {formatAngka(bundle.current_stock)} {bundle.unit}
          </span>
        </div>

        {/* Input Stok Fisik Aktual */}
        <div className="flex flex-col gap-1">
          <label className="font-label text-label text-text-secondary">
            Stok Fisik Aktual di Bengkel ({bundle.unit})
          </label>
          <input
            type="number"
            min="0"
            step="any"
            value={physicalQty}
            onChange={(e) => setPhysicalQty(e.target.value)}
            placeholder="0"
            className="w-full rounded-2xl border border-outline-variant bg-surface-container-low px-4 py-3 text-text-primary font-body text-body outline-none focus:border-brand-500"
          />
          <span className="font-caption text-caption text-text-muted">
            Hitung sisa fisik botol/jerigen racikan di rak pengerjaan.
          </span>
        </div>

        {/* Live Selisih */}
        <div
          className={`rounded-2xl p-3 flex items-center justify-between text-xs font-medium border ${
            difference === 0
              ? "bg-surface-container-low text-text-muted border-outline-variant/40"
              : difference > 0
              ? "bg-success-surface text-success-text border-success-base/30"
              : "bg-danger-surface text-danger-text border-danger-base/30"
          }`}
        >
          <span>Selisih dengan Sistem:</span>
          <span className="font-bold text-sm">
            {difference > 0 ? `+${formatAngka(difference)}` : formatAngka(difference)}{" "}
            {bundle.unit}
          </span>
        </div>

        {/* Catatan Opname */}
        <div className="flex flex-col gap-1">
          <label className="font-label text-label text-text-secondary">
            Catatan Penyesuaian (opsional)
          </label>
          <textarea
            rows={2}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="mis: Tumpah saat pengerjaan / penyesuaian takaran botol"
            className="w-full rounded-2xl border border-outline-variant bg-surface-container-low px-4 py-2.5 text-text-primary font-body text-body outline-none focus:border-brand-500 resize-none"
          />
        </div>

        <button
          type="button"
          disabled={pending}
          onClick={handleSubmit}
          className="w-full rounded-2xl bg-brand-500 text-white font-label-bold text-label-bold py-3.5 flex items-center justify-center gap-2 transition-transform disabled:opacity-50"
        >
          <Icon name="tune" className="text-[20px]" />
          {pending ? "Menyimpan Penyesuaian…" : "Simpan Penyesuaian Opname"}
        </button>
      </div>
    </Modal>
  );
}

// ─── Modal 3B: Opname Global Seluruh Racikan Sekaligus ─────────────────────────

function BatchOpnameModal({
  bundles,
  onClose,
}: {
  bundles: BundleItem[];
  onClose: () => void;
}) {
  const toast = useToast();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [counts, setCounts] = useState<Record<string, string>>(() =>
    Object.fromEntries(bundles.map((b) => [b.id, String(b.current_stock)])),
  );
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [generalNote, setGeneralNote] = useState("");

  const changedItems = useMemo(() => {
    return bundles.filter((b) => {
      const inputVal = counts[b.id];
      if (inputVal === undefined || inputVal.trim() === "") return false;
      const num = Number(inputVal);
      return !isNaN(num) && num !== b.current_stock;
    });
  }, [bundles, counts]);

  function handleSave() {
    startTransition(async () => {
      const itemsToSubmit = bundles.map((b) => ({
        bundle_id: b.id,
        physical_qty: Number(counts[b.id] ?? b.current_stock) || 0,
        note: notes[b.id]?.trim() || undefined,
      }));

      const res = await opnameBundleBatchAction({
        p_items: itemsToSubmit,
        p_general_note: generalNote.trim() || undefined,
      });

      if (res.ok) {
        toast.sukses(
          "Opname Global Berhasil",
          `Stok fisik ${bundles.length} racikan berhasil diselaraskan dengan hasil hitung fisik bengkel.`,
        );
        onClose();
        router.refresh();
      } else {
        toast.gagal("Gagal opname", res.message ?? "Terjadi kesalahan sistem");
      }
    });
  }

  return (
    <Modal open onClose={onClose} title="Opname Stok Racikan (Global)">
      <div className="flex flex-col gap-4 max-h-[75vh] overflow-y-auto pr-1">
        <div className="p-3.5 rounded-2xl bg-surface-container-low border border-outline-variant/40 text-xs text-text-secondary flex flex-col gap-1">
          <span className="font-bold text-text-primary text-sm">
            Rekonsiliasi Stok Fisik Seluruh Racikan
          </span>
          <span>
            Hitung sisa fisik botol/jerigen racikan di rak pengerjaan. Masukkan angka riil pada kolom Stok Fisik.
            Sistem otomatis menghitung selisih dan mencatatnya ke jejak audit.
          </span>
        </div>

        <div className="flex flex-col gap-3">
          {bundles.map((bundle) => {
            const currentStr = counts[bundle.id] ?? String(bundle.current_stock);
            const physicalNum = Number(currentStr) || 0;
            const diff = physicalNum - bundle.current_stock;

            return (
              <div
                key={bundle.id}
                className="p-3.5 rounded-2xl border border-outline-variant/60 bg-surface flex flex-col gap-2.5 shadow-2xs"
              >
                <div className="flex items-center justify-between">
                  <div className="flex flex-col">
                    <span className="font-body-bold text-body-bold text-text-primary">
                      {bundle.bundle_name}
                    </span>
                    <span className="text-xs text-text-muted">
                      Stok Sistem: <strong className="text-text-primary">{formatAngka(bundle.current_stock)} {bundle.unit}</strong>
                    </span>
                  </div>

                  <span
                    className={`px-2.5 py-1 rounded-xl text-xs font-bold ${
                      diff === 0
                        ? "bg-surface-container-low text-text-muted"
                        : diff > 0
                        ? "bg-success-surface text-success-text"
                        : "bg-danger-surface text-danger-text"
                    }`}
                  >
                    Selisih: {diff > 0 ? `+${formatAngka(diff)}` : formatAngka(diff)} {bundle.unit}
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <div className="flex flex-col gap-1">
                    <label className="text-[11px] font-medium text-text-muted">
                      Stok Fisik Aktual ({bundle.unit})
                    </label>
                    <input
                      type="number"
                      min="0"
                      step="any"
                      value={currentStr}
                      onChange={(e) =>
                        setCounts((prev) => ({ ...prev, [bundle.id]: e.target.value }))
                      }
                      className="h-10 px-3 rounded-xl border border-outline-variant bg-surface-container-low text-text-primary font-body text-body outline-none focus:border-brand-500 font-bold"
                    />
                  </div>

                  <div className="flex flex-col gap-1">
                    <label className="text-[11px] font-medium text-text-muted">
                      Catatan Penyesuaian (opsional)
                    </label>
                    <input
                      type="text"
                      value={notes[bundle.id] ?? ""}
                      onChange={(e) =>
                        setNotes((prev) => ({ ...prev, [bundle.id]: e.target.value }))
                      }
                      placeholder="mis: tumpah / takaran kurang"
                      className="h-10 px-3 rounded-xl border border-outline-variant bg-surface-container-low text-text-primary font-body text-body outline-none focus:border-brand-500 text-xs"
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="flex flex-col gap-1 pt-2 border-t border-outline-variant/40">
          <label className="font-label text-label text-text-secondary">
            Catatan Opname Global (opsional)
          </label>
          <input
            type="text"
            value={generalNote}
            onChange={(e) => setGeneralNote(e.target.value)}
            placeholder="mis: Opname stok racikan berkala"
            className="w-full rounded-2xl border border-outline-variant bg-surface-container-low px-4 py-2.5 text-text-primary font-body text-body outline-none focus:border-brand-500 text-sm"
          />
        </div>

        <div className="flex items-center justify-between text-xs text-text-muted pt-1">
          <span>
            {changedItems.length > 0 ? (
              <strong className="text-brand-600 font-bold">
                {changedItems.length} dari {bundles.length} racikan mengalami penyesuaian
              </strong>
            ) : (
              "Semua stok fisik sama dengan catatan sistem"
            )}
          </span>
        </div>

        <button
          type="button"
          disabled={pending}
          onClick={handleSave}
          className="w-full rounded-2xl bg-brand-500 text-white font-label-bold text-label-bold py-3.5 flex items-center justify-center gap-2 transition-transform disabled:opacity-50"
        >
          <Icon name="tune" className="text-[20px]" />
          {pending ? "Menyimpan Opname…" : "Simpan Semua Penyesuaian Opname"}
        </button>
      </div>
    </Modal>
  );
}

// ─── Modal 4: Buat / Edit Definisi Racikan ────────────────────────────────────

type ComponentDraft = {
  item_id: string;
  quantity: string;
};

// Satuan output STRICT sesuai kebutuhan user: ML, GR, PCS
const STRICT_UNITS = [
  { value: "ml", label: "ML (Mililiter)" },
  { value: "gr", label: "GR (Gram)" },
  { value: "pcs", label: "PCS (Pieces)" },
];

function BundleFormModal({
  editing,
  availableItems,
  branchId,
  onClose,
}: {
  editing: BundleItem | null;
  availableItems: AvailableItem[];
  branchId: string;
  onClose: () => void;
}) {
  const toast = useToast();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [name, setName] = useState(editing?.bundle_name ?? "");
  const [unit, setUnit] = useState(editing?.unit ?? "ml");
  const [outputQty, setOutputQty] = useState(String(editing?.output_qty ?? 100));
  const [currentStock, setCurrentStock] = useState(
    editing ? String(editing.current_stock) : "0",
  );
  const [desc, setDesc] = useState(editing?.description ?? "");
  const [components, setComponents] = useState<ComponentDraft[]>(
    editing
      ? editing.components.map((c) => ({ item_id: c.item_id, quantity: String(c.quantity) }))
      : [{ item_id: "", quantity: "10" }],
  );

  const itemById = useMemo(
    () => Object.fromEntries(availableItems.map((i) => [i.id, i])),
    [availableItems],
  );

  function addComponent() {
    setComponents((prev) => [...prev, { item_id: "", quantity: "10" }]);
  }

  function removeComponent(idx: number) {
    setComponents((prev) => prev.filter((_, i) => i !== idx));
  }

  function updateComponent(idx: number, field: keyof ComponentDraft, value: string) {
    setComponents((prev) =>
      prev.map((c, i) => (i === idx ? { ...c, [field]: value } : c)),
    );
  }

  // Kalkulasi Matematika HPP Otomatis
  const validComponents = components.filter(
    (c) => c.item_id && Number(c.quantity) > 0,
  );

  const totalBatchHpp = validComponents.reduce((acc, c) => {
    const item = itemById[c.item_id];
    const cost = item?.unit_cost ?? 0;
    return acc + Number(c.quantity) * cost;
  }, 0);

  const parsedOutputQty = Math.max(0.01, Number(outputQty) || 1);
  const hppPerUnit = totalBatchHpp / parsedOutputQty;

  function handleSave() {
    if (!name.trim()) {
      toast.gagal("Data belum lengkap", "Nama racikan wajib diisi");
      return;
    }
    if (!validComponents.length) {
      toast.gagal("Bahan kosong", "Pilih minimal 1 bahan baku gudang");
      return;
    }

    startTransition(async () => {
      const res = await setBundleDefinitionAction({
        p_branch_id: branchId,
        p_bundle_name: name.trim(),
        p_unit: unit.trim().toLowerCase(),
        p_output_qty: parsedOutputQty,
        p_current_stock: currentStock.trim() !== "" ? Number(currentStock) : undefined,
        p_description: desc.trim() || undefined,
        p_bundle_id: editing?.id,
        p_components: validComponents.map((c) => ({
          item_id: c.item_id,
          quantity: Number(c.quantity),
        })),
      });

      if (res.ok) {
        toast.sukses(
          "Berhasil",
          editing ? "Racikan berhasil diperbarui" : "Racikan baru berhasil disimpan",
        );
        onClose();
        router.refresh();
      } else {
        toast.gagal("Gagal", res.message ?? "Gagal menyimpan racikan");
      }
    });
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={editing ? `Edit Racikan - ${editing.bundle_name}` : "Buat Racikan Baru"}
    >
      <div className="flex flex-col gap-4">
        {/* Nama Racikan */}
        <div className="flex flex-col gap-1">
          <label className="font-label text-label text-text-secondary">Nama Racikan</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="mis: Semir Ban Premium"
            className="w-full rounded-2xl border border-outline-variant bg-surface-container-low px-4 py-3 text-text-primary font-body text-body outline-none focus:border-brand-500"
          />
        </div>

        {/* Satuan Output (STRICT: ML, GR, PCS) */}
        <div className="flex flex-col gap-1.5">
          <label className="font-label text-label text-text-secondary">
            Satuan Hasil Jadi (Output Unit)
          </label>
          <div className="grid grid-cols-3 gap-2">
            {STRICT_UNITS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setUnit(opt.value)}
                className={`py-2.5 px-3 rounded-xl font-label text-label border transition-all text-center ${
                  unit === opt.value
                    ? "bg-brand-500 text-white border-brand-500 font-bold shadow-sm"
                    : "bg-surface-container-low text-text-secondary border-outline-variant hover:border-brand-300"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* Hasil Bersih 1x Racik */}
        <div className="flex flex-col gap-1">
          <label className="font-label text-label text-text-secondary">
            Hasil Bersih 1x Racik ({unit.toUpperCase()})
          </label>
          <input
            type="number"
            min="0.1"
            step="any"
            value={outputQty}
            onChange={(e) => setOutputQty(e.target.value)}
            placeholder="mis: 100"
            className="w-full rounded-2xl border border-outline-variant bg-surface-container-low px-4 py-3 text-text-primary font-body text-body outline-none focus:border-brand-500"
          />
          <span className="font-caption text-caption text-text-muted">
            Total volume/bobot jadi per 1x racik (termasuk air/pelarut). Contoh: 1000 ml.
          </span>
        </div>

        {/* Stok Fisik Saat Ini */}
        <div className="flex flex-col gap-1">
          <label className="font-label text-label text-text-secondary">
            Stok Fisik Tersedia di Bengkel ({unit.toUpperCase()})
          </label>
          <input
            type="number"
            min="0"
            step="any"
            value={currentStock}
            onChange={(e) => setCurrentStock(e.target.value)}
            placeholder="0"
            className="w-full rounded-2xl border border-outline-variant bg-surface-container-low px-4 py-3 text-text-primary font-body text-body outline-none focus:border-brand-500 font-bold"
          />
          <span className="font-caption text-caption text-text-muted">
            Jumlah riil fisik racikan siap pakai yang saat ini tersedia di bengkel (misal: 1000 ml).
          </span>
        </div>

        {/* Daftar Komposisi Bahan Gudang */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <label className="font-label text-label text-text-secondary">
              Komposisi Bahan Baku Gudang
            </label>
            <span className="font-caption text-caption text-text-muted">
              (Biaya otomatis dari harga beli gudang)
            </span>
          </div>

          {components.map((comp, idx) => {
            const item = itemById[comp.item_id];
            const cost = (item?.unit_cost ?? 0) * (Number(comp.quantity) || 0);

            return (
              <div
                key={idx}
                className="rounded-2xl border border-outline-variant/60 bg-surface-container-low p-3 flex flex-col gap-2"
              >
                <div className="flex gap-2 items-center">
                  <select
                    value={comp.item_id}
                    onChange={(e) => updateComponent(idx, "item_id", e.target.value)}
                    className="flex-1 min-w-0 rounded-xl border border-outline-variant bg-surface px-3 py-2 text-text-primary font-body text-body outline-none focus:border-brand-500"
                  >
                    <option value="">Pilih bahan gudang…</option>
                    {availableItems.map((it) => (
                      <option key={it.id} value={it.id}>
                        {it.item_name} ({it.unit}) - @{formatRupiah(it.unit_cost)}/{it.unit}
                      </option>
                    ))}
                  </select>

                  <div className="flex items-center gap-1 shrink-0">
                    <input
                      type="number"
                      min="0.01"
                      step="any"
                      value={comp.quantity}
                      onChange={(e) => updateComponent(idx, "quantity", e.target.value)}
                      placeholder="Takaran"
                      className="w-20 rounded-xl border border-outline-variant bg-surface px-2.5 py-2 text-text-primary font-body text-body text-right outline-none focus:border-brand-500"
                    />
                    <span className="text-xs text-text-muted w-8 shrink-0">
                      {item?.unit ?? ""}
                    </span>
                  </div>

                  {components.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeComponent(idx)}
                      className="shrink-0 w-8 h-8 rounded-lg bg-danger-surface text-danger-text flex items-center justify-center "
                    >
                      <Icon name="delete" className="text-[16px]" />
                    </button>
                  )}
                </div>

                {item && (
                  <div className="flex justify-between items-center text-xs text-text-muted pt-1 border-t border-outline-variant/30">
                    <span>
                      {comp.quantity || 0} {item.unit} × {formatRupiah(item.unit_cost)}/{item.unit}
                    </span>
                    <span className="font-semibold text-text-primary">= {formatRupiah(cost)}</span>
                  </div>
                )}
              </div>
            );
          })}

          <button
            type="button"
            onClick={addComponent}
            className="flex items-center gap-1.5 text-brand-600 font-label text-label mt-1 w-fit "
          >
            <Icon name="add_circle" className="text-[18px]" />
            Tambah Bahan Lain
          </button>
        </div>

        {/* Deskripsi */}
        <div className="flex flex-col gap-1">
          <label className="font-label text-label text-text-secondary">
            Catatan / Deskripsi (opsional)
          </label>
          <input
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
            placeholder="mis: Campuran semir ban HF + HCl + air"
            className="w-full rounded-2xl border border-outline-variant bg-surface-container-low px-4 py-2.5 text-text-primary font-body text-body outline-none focus:border-brand-500"
          />
        </div>

        {/* Live Auto-HPP Breakdown */}
        <div className="rounded-2xl bg-surface-container-high border border-brand-200/80 p-4 flex flex-col gap-2 shadow-sm">
          <div className="flex items-center gap-2 text-brand-700 font-label text-label font-bold">
            <Icon name="calculate" className="text-[18px]" />
            <span>Kalkulasi Otomatis HPP Sistem</span>
          </div>

          <div className="flex flex-col gap-1.5 text-xs text-text-secondary pt-1 border-t border-outline-variant/40">
            <div className="flex justify-between">
              <span>Total Modal Bahan per 1x Racik:</span>
              <span className="font-bold text-text-primary text-sm">
                {formatRupiah(totalBatchHpp)}
              </span>
            </div>
            <div className="flex justify-between">
              <span>Hasil Volume Jadi:</span>
              <span className="font-medium text-text-primary">
                {formatAngka(parsedOutputQty)} {unit.toUpperCase()}
              </span>
            </div>
            <div className="flex justify-between items-center pt-1.5 border-t border-dashed border-outline-variant">
              <span className="font-bold text-brand-900">
                HPP Bersih per {unit.toUpperCase()}:
              </span>
              <span className="font-headline-2 text-headline-2 text-brand-600">
                {formatRupiah(hppPerUnit)} / {unit.toUpperCase()}
              </span>
            </div>
          </div>
        </div>

        <button
          type="button"
          disabled={pending}
          onClick={handleSave}
          className="w-full rounded-2xl bg-brand-500 text-white font-label-bold text-label-bold py-3.5 transition-transform disabled:opacity-50 mt-1"
        >
          {pending ? "Menyimpan…" : editing ? "Simpan Perubahan Racikan" : "Simpan Racikan Baru"}
        </button>
      </div>
    </Modal>
  );
}

// ─── Modal 5: Hapus Racikan ───────────────────────────────────────────────────

function DeleteModal({
  bundle,
  onClose,
}: {
  bundle: BundleItem;
  onClose: () => void;
}) {
  const toast = useToast();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function handleDelete() {
    startTransition(async () => {
      const res = await deleteBundleAction(bundle.id);
      if (res.ok) {
        toast.sukses("Racikan Dinonaktifkan", `${bundle.bundle_name} berhasil dinonaktifkan.`);
        onClose();
        router.refresh();
      } else {
        toast.gagal("Gagal menghapus", res.message ?? "Terjadi kesalahan sistem");
      }
    });
  }

  return (
    <Modal open onClose={onClose} title="Hapus Racikan">
      <div className="flex flex-col gap-4">
        <p className="font-body text-body text-text-secondary">
          Yakin ingin menonaktifkan racikan{" "}
          <strong className="text-text-primary">{bundle.bundle_name}</strong>? Racikan ini tidak
          akan muncul lagi di daftar resep order.
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 py-3 rounded-2xl bg-surface-container text-text-secondary font-body-bold text-body-bold transition-transform"
          >
            Batal
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={handleDelete}
            className="flex-1 py-3 rounded-2xl bg-danger text-white font-body-bold text-body-bold flex items-center justify-center gap-2 transition-transform disabled:opacity-50"
          >
            {pending ? "Menghapus…" : "Hapus Racikan"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ─── Main Component: BundleManager ────────────────────────────────────────────

export function BundleManager({
  bundles,
  claims,
  availableItems,
  activeOrders,
  canManage,
  branchId,
}: {
  bundles: BundleItem[];
  claims: BundleClaim[];
  availableItems: AvailableItem[];
  activeOrders: ActiveOrderOption[];
  canManage: boolean;
  branchId: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const [tab, setTab] = useState<"items" | "claims">("items");
  const [search, setSearch] = useState("");
  const [huruf, setHuruf] = useState<string>("all");
  const [expandedClaimId, setExpandedClaimId] = useState<string | null>(null);
  const [busyClaimId, setBusyClaimId] = useState<string | null>(null);

  // Modals state
  const [productionTarget, setProductionTarget] = useState<BundleItem | null>(null);
  const [isProductionOpen, setIsProductionOpen] = useState(false);
  const [claimUsageTarget, setClaimUsageTarget] = useState<BundleItem | null>(null);
  const [opnameTarget, setOpnameTarget] = useState<BundleItem | null>(null);
  const [isGlobalOpnameOpen, setIsGlobalOpnameOpen] = useState(false);
  const [editingBundle, setEditingBundle] = useState<BundleItem | null>(null);
  const [isNewBundleOpen, setIsNewBundleOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<BundleItem | null>(null);

  // Filter alfabet & pencarian untuk racikan
  const filteredBundles = useMemo(() => {
    const q = search.trim().toLowerCase();
    return bundles
      .filter((b) => {
        if (huruf !== "all") {
          const firstChar = b.bundle_name.trim().charAt(0).toUpperCase();
          if (huruf === "#") {
            if (/^[A-Z]/.test(firstChar)) return false;
          } else if (firstChar !== huruf) {
            return false;
          }
        }
        if (!q) return true;
        return b.bundle_name.toLowerCase().includes(q);
      })
      .sort((a, b) => a.bundle_name.localeCompare(b.bundle_name, "id"));
  }, [bundles, search, huruf]);

  const pendingClaimsCount = useMemo(
    () => claims.filter((c) => c.status === "pending").length,
    [claims],
  );

  async function handleConfirmClaim(claim: BundleClaim) {
    setBusyClaimId(claim.id);
    const res = await confirmBundleClaimAction(claim.id);
    setBusyClaimId(null);
    if (res.ok) {
      toast.sukses(
        "Pengajuan Disetujui",
        claim.claim_type === "produce"
          ? `Produksi ${claim.bundle_name} disetujui. Bahan baku dipotong dan stok racikan bertambah.`
          : `Klaim pemakaian ${claim.bundle_name} disetujui. Stok fisik racikan dipotong.`,
      );
      router.refresh();
    } else {
      toast.gagal("Gagal menyetujui", res.message ?? "Terjadi kesalahan sistem");
    }
  }

  async function handleRejectClaim(claim: BundleClaim) {
    const reason =
      typeof window !== "undefined"
        ? window.prompt(`Alasan menolak pengajuan ${claim.bundle_name}:`, "Stok tidak sesuai")
        : null;
    if (reason === null) return;

    setBusyClaimId(claim.id);
    const res = await rejectBundleClaimAction(claim.id, reason);
    setBusyClaimId(null);
    if (res.ok) {
      toast.sukses("Pengajuan Ditolak", `Pengajuan ${claim.bundle_name} telah ditolak.`);
      router.refresh();
    } else {
      toast.gagal("Gagal menolak", res.message ?? "Terjadi kesalahan sistem");
    }
  }

  const alphabetList = ["all", "#", ..."ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("")];

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto flex flex-col gap-5 w-full">
      {/* ─── Tabs Header: Paritas dengan Stok Utama ─── */}
      <div className="flex gap-2 p-1 rounded-2xl bg-surface-container-low border border-outline-variant/30 w-full sm:w-fit">
        <button
          type="button"
          onClick={() => setTab("items")}
          className={`flex-1 sm:flex-initial px-5 py-2.5 rounded-xl font-label text-label transition-all flex items-center justify-center gap-2 ${
            tab === "items"
              ? "bg-brand-500 text-white font-bold shadow-sm"
              : "text-text-secondary hover:text-text-primary"
          }`}
        >
          <Icon name="science" className="text-[18px]" />
          Daftar Racikan ({bundles.length})
        </button>
        <button
          type="button"
          onClick={() => setTab("claims")}
          className={`flex-1 sm:flex-initial px-5 py-2.5 rounded-xl font-label text-label transition-all flex items-center justify-center gap-2 ${
            tab === "claims"
              ? "bg-brand-500 text-white font-bold shadow-sm"
              : "text-text-secondary hover:text-text-primary"
          }`}
        >
          <Icon name="history" className="text-[18px]" />
          Riwayat Pengajuan
          {pendingClaimsCount > 0 && (
            <span
              className={`px-2 py-0.5 rounded-full text-xs font-bold ${
                tab === "claims" ? "bg-white text-brand-600" : "bg-warning-surface text-warning-text"
              }`}
            >
              {pendingClaimsCount}
            </span>
          )}
        </button>
      </div>

      {/* ─── TAB 1: DAFTAR RACIKAN ─── */}
      {tab === "items" ? (
        <div className="flex flex-col gap-4">
          {/* Top Actions: Produksi Racikan & Buat Racikan Baru */}
          <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center justify-between">
            <div className="flex-1 min-w-0">
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Cari racikan obat/bahan…"
                className="w-full h-11 px-4 rounded-2xl bg-surface-container-low border border-outline-variant/60 text-text-primary font-body text-body outline-none focus:border-brand-500"
              />
            </div>

            <div className="flex gap-2 shrink-0">
              {/* Tombol Halaman Opname Bulanan Racikan & Export */}
              <Link
                href="/stok/racikan/opname"
                className="flex-1 sm:flex-initial px-4 py-2.5 rounded-2xl bg-surface-container border border-outline-variant text-text-primary font-label-bold text-label-bold flex items-center justify-center gap-2 transition-transform hover:bg-surface-container-high"
                title="Buka Halaman Opname Fisik Bulanan Racikan & Export Excel"
              >
                <Icon name="fact_check" className="text-[18px]" />
                Opname Racikan
              </Link>

              {/* Tombol Buat Racikan Baru */}
              {canManage && (
                <button
                  type="button"
                  onClick={() => setIsNewBundleOpen(true)}
                  className="flex-1 sm:flex-initial px-4 py-2.5 rounded-2xl bg-brand-500 text-white font-label-bold text-label-bold flex items-center justify-center gap-2 transition-transform shadow-sm"
                >
                  <Icon name="add_circle" className="text-[18px]" />
                  + Racikan Baru
                </button>
              )}
            </div>
          </div>

          {/* Filter Huruf Alfabet */}
          <div className="flex gap-1 overflow-x-auto pb-1 scrollbar-none">
            {alphabetList.map((h) => (
              <button
                key={h}
                type="button"
                onClick={() => setHuruf(h)}
                className={`min-w-8 h-8 px-2 rounded-xl text-xs font-semibold flex items-center justify-center transition-colors shrink-0 ${
                  huruf === h
                    ? "bg-brand-500 text-white font-bold"
                    : "bg-surface-container-low text-text-muted hover:text-text-primary"
                }`}
              >
                {h === "all" ? "Semua" : h}
              </button>
            ))}
          </div>

          {/* Grid Racikan Cards */}
          {filteredBundles.length === 0 ? (
            <div className="clay-card p-12 text-center flex flex-col items-center justify-center gap-3">
              <Icon name="science" className="text-[48px] text-text-muted" />
              <p className="font-headline-3 text-headline-3 text-text-primary">
                Belum ada racikan ditemukan
              </p>
              <p className="font-body text-body text-text-secondary max-w-sm">
                {search
                  ? `Tidak ada racikan yang sesuai dengan kata kunci "${search}".`
                  : "Mulai buat racikan untuk menggabungkan bahan baku gudang dan menghitung HPP secara presisi."}
              </p>
              {canManage && (
                <button
                  type="button"
                  onClick={() => setIsNewBundleOpen(true)}
                  className="mt-2 px-5 py-2.5 rounded-2xl bg-brand-500 text-white font-label-bold text-label-bold transition-transform"
                >
                  + Buat Racikan Baru
                </button>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
              {filteredBundles.map((bundle) => {
                const stock = Number(bundle.current_stock);
                const hasStock = stock > 0;
                const partsPreview = bundle.components
                  .map((c) => `${formatAngka(c.quantity)} ${c.unit} ${c.item_name}`)
                  .join(" + ");

                return (
                  <div
                    key={bundle.id}
                    className="clay-card p-4 sm:p-5 flex flex-col justify-between gap-3 min-w-0"
                  >
                    <div className="flex flex-col gap-2.5">
                      {/* Top Header Card */}
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <div className="w-9 h-9 rounded-xl bg-brand-50 text-brand-600 flex items-center justify-center shrink-0">
                            <Icon name="science" className="text-[20px]" />
                          </div>
                          <div className="flex flex-col min-w-0">
                            <span className="font-body-bold text-body-bold text-text-primary leading-tight truncate">
                              {bundle.bundle_name}
                            </span>
                            <span className="font-micro-badge text-micro-badge text-text-muted">
                              Satuan Output: {bundle.unit.toUpperCase()}
                            </span>
                          </div>
                        </div>

                        {/* Badge Stok Fisik di Rak */}
                        <div className="flex flex-col items-end shrink-0">
                          <span className="text-[10px] font-bold text-text-muted uppercase tracking-wider">
                            Stok Fisik di Rak
                          </span>
                          <div className="flex items-baseline gap-1">
                            <span
                              className={`font-headline-2 text-headline-2 ${
                                hasStock ? "text-text-primary" : "text-danger-text"
                              }`}
                            >
                              {formatAngka(stock)}
                            </span>
                            <span className="font-caption text-caption font-bold text-text-secondary">
                              {bundle.unit.toUpperCase()}
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* Formula Preview */}
                      <div className="p-2.5 rounded-xl bg-surface-container-low text-xs text-text-secondary border border-outline-variant/30 flex flex-col gap-0.5">
                        <span className="text-[11px] text-text-muted font-medium">
                          1x Racik ({formatAngka(bundle.output_qty)} {bundle.unit}):
                        </span>
                        <span className="font-medium text-text-primary">
                          {partsPreview || "Belum ada komposisi bahan"}
                        </span>
                      </div>

                      {/* HPP Metrics Breakdown */}
                      <div className="grid grid-cols-2 gap-2 text-xs">
                        <div className="p-2 rounded-xl bg-surface-container-low/70 flex flex-col">
                          <span className="text-[11px] text-text-muted">Modal 1x Racik</span>
                          <span className="font-bold text-text-primary text-xs mt-0.5">
                            {formatRupiah(bundle.total_hpp_batch)}
                          </span>
                        </div>
                        <div className="p-2 rounded-xl bg-surface-container-low/70 flex flex-col">
                          <span className="text-[11px] text-text-muted">HPP per {bundle.unit}</span>
                          <span className="font-bold text-brand-600 text-xs mt-0.5">
                            {formatRupiah(bundle.hpp_per_unit)} / {bundle.unit}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Bottom Action Buttons: Paritas Lengkap (Produksi, Klaim, Opname, Edit, Hapus) */}
                    <div className="flex flex-col gap-1.5 pt-2 border-t border-outline-variant/40">
                      <div className="flex gap-1.5 w-full">
                        {/* Tombol Produksi: SATU-SATUNYA trigger memotong bahan baku gudang & menambah stok racikan */}
                        <button
                          type="button"
                          onClick={() => {
                            setProductionTarget(bundle);
                            setIsProductionOpen(true);
                          }}
                          className="flex-1 min-h-10 rounded-xl bg-brand-500 text-white font-caption text-caption font-bold flex items-center justify-center gap-1 transition-transform shadow-xs"
                          title="Produksi Racikan (Potong Bahan Baku Gudang)"
                        >
                          <Icon name="science" className="text-[16px]" />
                          Produksi
                        </button>

                        {/* Tombol Klaim Pemakaian: Mengambil dari stok fisik racikan di rak */}
                        <button
                          type="button"
                          onClick={() => setClaimUsageTarget(bundle)}
                          className="flex-1 min-h-10 rounded-xl bg-brand-50 text-brand-700 font-caption text-caption font-semibold flex items-center justify-center gap-1 transition-transform"
                          title="Klaim Pemakaian Racikan untuk Order / Operasional"
                        >
                          <Icon name="shopping_cart_checkout" className="text-[16px]" />
                          Klaim
                        </button>
                      </div>

                      <div className="flex gap-1.5 w-full">
                        {/* Tombol Opname: Penyesuaian stok fisik aktual */}
                        <button
                          type="button"
                          onClick={() => setOpnameTarget(bundle)}
                          className="flex-1 min-h-9 rounded-xl bg-surface-container text-text-secondary font-caption text-caption flex items-center justify-center gap-1 transition-transform"
                          title="Opname Penyesuaian Stok Fisik"
                        >
                          <Icon name="tune" className="text-[15px]" />
                          Opname
                        </button>

                        {/* Tombol Edit */}
                        {canManage && (
                          <button
                            type="button"
                            onClick={() => setEditingBundle(bundle)}
                            className="px-3 min-h-9 rounded-xl bg-surface-container text-text-primary font-caption text-caption flex items-center justify-center gap-1 transition-transform"
                            title="Edit Racikan & Formula"
                          >
                            <Icon name="edit" className="text-[15px]" />
                          </button>
                        )}

                        {/* Tombol Hapus */}
                        {canManage && (
                          <button
                            type="button"
                            onClick={() => setDeleteTarget(bundle)}
                            className="px-3 min-h-9 rounded-xl bg-danger-surface text-danger-text font-caption text-caption flex items-center justify-center gap-1 transition-transform"
                            title="Hapus Racikan"
                          >
                            <Icon name="delete" className="text-[15px]" />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ) : (
        /* ─── TAB 2: RIWAYAT PENGAJUAN (PRODUKSI & KLAIM PEMAKAIAN) ─── */
        <div className="flex flex-col gap-3">
          {claims.length === 0 ? (
            <div className="clay-card p-12 text-center flex flex-col items-center justify-center gap-2">
              <Icon name="history" className="text-[40px] text-text-muted" />
              <p className="font-body text-body text-text-secondary">
                Belum ada riwayat pengajuan racikan.
              </p>
            </div>
          ) : (
            claims.map((claim) => {
              const meta = STATUS_MAP[claim.status] ?? STATUS_MAP.pending;
              const isExpanded = expandedClaimId === claim.id;
              const isBusy = busyClaimId === claim.id;
              const isProduce = claim.claim_type === "produce";

              return (
                <div
                  key={claim.id}
                  className="clay-card rounded-2xl overflow-hidden border border-border-subtle transition-all"
                >
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => setExpandedClaimId(isExpanded ? null : claim.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        setExpandedClaimId(isExpanded ? null : claim.id);
                      }
                    }}
                    className="p-4 flex items-start justify-between gap-2 cursor-pointer hover:bg-surface-container-low/40 transition-colors"
                  >
                    <div className="flex items-start gap-3 min-w-0">
                      <span
                        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl mt-0.5 ${
                          isProduce
                            ? "bg-brand-50 text-brand-600"
                            : "bg-surface-container text-text-secondary"
                        }`}
                      >
                        <Icon
                          name={isProduce ? "science" : "shopping_cart_checkout"}
                          className="text-[20px]"
                        />
                      </span>

                      <div className="flex flex-col min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-body-bold text-body-bold text-text-primary truncate">
                            {claim.bundle_name}
                          </span>
                          <span
                            className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                              isProduce
                                ? "bg-brand-100 text-brand-800"
                                : "bg-surface-container text-text-secondary"
                            }`}
                          >
                            {isProduce ? "🧪 PRODUKSI" : "📦 KLAIM PAKAI"}
                          </span>
                        </div>

                        <span className="font-caption text-caption text-text-muted mt-0.5">
                          {isProduce ? (
                            <>
                              Jumlah:{" "}
                              <strong className="text-text-primary">
                                {claim.quantity} batch
                              </strong>{" "}
                              (menambah stok racikan)
                            </>
                          ) : (
                            <>
                              Jumlah:{" "}
                              <strong className="text-text-primary">
                                {formatAngka(claim.quantity)} {claim.unit}
                              </strong>{" "}
                              (memakai stok fisik)
                            </>
                          )}
                          {" • "}Oleh {claim.claimed_by_name}
                        </span>

                        {claim.order_label && (
                          <span className="inline-block w-fit text-[11px] font-medium text-brand-700 bg-brand-50 px-2 py-0.5 rounded-full border border-brand-200 mt-1">
                            Tautan Order: {claim.order_label}
                          </span>
                        )}

                        <span className="font-caption text-caption text-text-secondary mt-0.5">
                          {formatDateTimeWib(claim.created_at)}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <span
                        className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full font-caption text-caption shrink-0 font-medium ${meta.cls}`}
                      >
                        <Icon name={meta.icon} className="text-[14px]" />
                        {meta.label}
                      </span>
                      <Icon
                        name={isExpanded ? "expand_less" : "expand_more"}
                        className="text-text-muted text-[20px]"
                      />
                    </div>
                  </div>

                  {/* Dropdown Rincian Lengkap */}
                  {isExpanded && (
                    <div className="px-4 pb-4 pt-1 border-t border-border-subtle/80 bg-surface/70 flex flex-col gap-2.5">
                      <div className="grid grid-cols-2 gap-2 pt-1 text-xs">
                        <div className="p-2.5 rounded-xl bg-surface-container-low border border-border-subtle/50 flex flex-col">
                          <span className="text-[11px] text-text-muted">Jenis Pengajuan</span>
                          <span className="font-bold text-text-primary mt-0.5">
                            {isProduce ? "Produksi Racikan Baru" : "Klaim Pemakaian Fisik"}
                          </span>
                        </div>
                        <div className="p-2.5 rounded-xl bg-surface-container-low border border-border-subtle/50 flex flex-col">
                          <span className="text-[11px] text-text-muted">Diajukan Oleh</span>
                          <span className="font-bold text-text-primary mt-0.5">
                            {claim.claimed_by_name}
                          </span>
                        </div>
                      </div>

                      {/* Detail Bahan Baku Terpotong jika Produksi */}
                      {isProduce && claim.components.length > 0 && (
                        <div className="p-3 rounded-xl bg-surface-container-low border border-border-subtle/50 flex flex-col gap-1 text-xs">
                          <span className="font-medium text-text-primary">
                            Bahan Baku Gudang yang Terpotong ({claim.quantity} batch):
                          </span>
                          {claim.components.map((c) => (
                            <div
                              key={c.item_id}
                              className="flex justify-between text-text-secondary"
                            >
                              <span>• {c.item_name}</span>
                              <span className="font-mono font-medium">
                                {formatAngka(c.quantity * claim.quantity)} {c.unit}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Info Verifikasi */}
                      {claim.confirmed_at && (
                        <div className="p-2.5 rounded-xl bg-surface-container-low border border-border-subtle/50 flex flex-col text-xs gap-0.5">
                          <span className="text-[11px] text-text-muted">Diverifikasi Oleh:</span>
                          <span className="font-semibold text-text-primary">
                            {claim.confirmed_by_name ?? "Petugas"} pada{" "}
                            {formatDateTimeWib(claim.confirmed_at)}
                          </span>
                        </div>
                      )}

                      {/* Catatan */}
                      {claim.note && (
                        <div className="p-2.5 rounded-xl bg-surface-container-low border border-border-subtle/50 flex flex-col text-xs gap-0.5">
                          <span className="text-[11px] text-text-muted">Catatan:</span>
                          <span className="italic text-text-primary font-medium">
                            "{claim.note}"
                          </span>
                        </div>
                      )}

                      {/* Approval Actions untuk Role Berhak (Manager, Maintainer, Owner, Finance) */}
                      {canManage && claim.status === "pending" && (
                        <div className="flex gap-2 pt-2 border-t border-border-subtle/60">
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => handleConfirmClaim(claim)}
                            className="flex-1 py-2.5 rounded-xl bg-success-surface text-success-text font-caption text-caption font-bold flex items-center justify-center gap-1 transition-transform disabled:opacity-60"
                          >
                            <Icon name="check" className="text-[18px]" />
                            {isProduce ? "Setujui Produksi" : "Setujui Pemakaian"}
                          </button>
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => handleRejectClaim(claim)}
                            className="flex-1 py-2.5 rounded-xl bg-danger-surface text-danger-text font-caption text-caption font-bold flex items-center justify-center gap-1 transition-transform disabled:opacity-60"
                          >
                            <Icon name="close" className="text-[18px]" />
                            Tolak
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}

      {/* ─── MODALS ─── */}

      {/* Modal Produksi */}
      {isProductionOpen && (
        <ProductionModal
          bundles={bundles}
          initialBundle={productionTarget}
          availableItems={availableItems}
          onClose={() => {
            setIsProductionOpen(false);
            setProductionTarget(null);
          }}
        />
      )}

      {/* Modal Klaim Pemakaian */}
      {claimUsageTarget && (
        <ClaimUsageModal
          bundle={claimUsageTarget}
          activeOrders={activeOrders}
          onClose={() => setClaimUsageTarget(null)}
        />
      )}

      {/* Modal Opname Fisik Satuan */}
      {opnameTarget && (
        <OpnameModal bundle={opnameTarget} onClose={() => setOpnameTarget(null)} />
      )}

      {/* Modal Opname Global (Semua Racikan Sekaligus) */}
      {isGlobalOpnameOpen && (
        <BatchOpnameModal
          bundles={bundles}
          onClose={() => setIsGlobalOpnameOpen(false)}
        />
      )}

      {/* Modal Buat Racikan Baru */}
      {isNewBundleOpen && (
        <BundleFormModal
          editing={null}
          availableItems={availableItems}
          branchId={branchId}
          onClose={() => setIsNewBundleOpen(false)}
        />
      )}

      {/* Modal Edit Racikan */}
      {editingBundle && (
        <BundleFormModal
          editing={editingBundle}
          availableItems={availableItems}
          branchId={branchId}
          onClose={() => setEditingBundle(null)}
        />
      )}

      {/* Modal Hapus Racikan */}
      {deleteTarget && (
        <DeleteModal bundle={deleteTarget} onClose={() => setDeleteTarget(null)} />
      )}
    </div>
  );
}
