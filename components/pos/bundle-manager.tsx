"use client";

import { useState, useTransition } from "react";
import { useToast } from "@/components/toast";
import { Icon } from "@/components/ui/icon";
import { Modal } from "@/components/ui/modal";
import {
  createBundleClaimAction,
  confirmBundleClaimAction,
  rejectBundleClaimAction,
  setBundleDefinitionAction,
  deleteBundleAction,
} from "@/app/actions/stok";

// ─── Types ───────────────────────────────────────────────────────────────────

export type BundleComponent = {
  item_id: string;
  item_name: string;
  unit: string;
  quantity: number;
  unit_cost: number;
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

// ─── Helpers ─────────────────────────────────────────────────────────────────

const STATUS_MAP: Record<string, { label: string; cls: string; icon: string }> = {
  pending: {
    label: "Menunggu Persetujuan",
    cls: "bg-warning-surface text-warning-text",
    icon: "pending",
  },
  confirmed: {
    label: "Disetujui & Stok Bertambah",
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

function componentsPreview(components: BundleComponent[], outputQty: number, unit: string): string {
  if (components.length === 0) return "Belum ada bahan";
  const parts = components.map((c) => `${c.quantity} ${c.unit} ${c.item_name}`).join(" + ");
  return `1x racik (${outputQty} ${unit}) = ${parts}`;
}

// ─── Claim / Produksi Modal ──────────────────────────────────────────────────

function ClaimModal({
  bundle,
  activeOrders,
  onClose,
}: {
  bundle: BundleItem;
  activeOrders: ActiveOrderOption[];
  onClose: () => void;
}) {
  const toast = useToast();
  const [qty, setQty] = useState("1");
  const [selectedOrderId, setSelectedOrderId] = useState<string>("");
  const [note, setNote] = useState("");
  const [pending, startTransition] = useTransition();

  const batchCount = Math.max(1, Number(qty) || 1);
  const totalProduced = batchCount * (bundle.output_qty || 1);

  function handleSubmit() {
    const qtyNum = Number(qty);
    if (!qtyNum || qtyNum <= 0) {
      toast.gagal("Jumlah tidak valid", "Jumlah kali racik harus lebih dari 0");
      return;
    }
    startTransition(async () => {
      const res = await createBundleClaimAction({
        p_bundle_id: bundle.id,
        p_quantity: qtyNum,
        p_order_id: selectedOrderId || undefined,
        p_note: note.trim() || undefined,
      });
      if (res.ok) {
        toast.sukses("Klaim diajukan", "Pengajuan produksi racikan berhasil dikirim.");
        onClose();
      } else {
        toast.gagal("Gagal mengajukan", res.message ?? "Terjadi kesalahan sistem");
      }
    });
  }

  return (
    <Modal open onClose={onClose} title={`Produksi / Klaim — ${bundle.bundle_name}`}>
      <div className="flex flex-col gap-4">
        {/* Info Hasil Jadi */}
        <div className="rounded-2xl bg-brand-50 border border-brand-100 p-3.5 flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <span className="font-caption text-caption text-brand-700">Estimasi Hasil Jadi:</span>
            <span className="font-body-bold text-body-bold text-brand-900">
              +{totalProduced.toLocaleString("id-ID")} {bundle.unit}
            </span>
          </div>
          <div className="text-xs text-brand-600">
            {batchCount}x racik @ {bundle.output_qty} {bundle.unit}
          </div>
        </div>

        {/* Jumlah Kali Racik */}
        <div className="flex flex-col gap-1">
          <label className="font-label text-label text-text-secondary">
            Berapa Kali Meracik (Batch)?
          </label>
          <input
            type="number"
            min="1"
            step="1"
            value={qty}
            onChange={(e) => setQty(e.target.value)}
            className="w-full rounded-2xl border border-outline-variant bg-surface-container-low px-4 py-3 text-text-primary font-body text-body outline-none focus:border-brand-500"
          />
          <span className="font-caption text-caption text-text-muted mt-0.5">
            Contoh: Masukkan 1 untuk 1 botol/batch ({bundle.output_qty} {bundle.unit})
          </span>
        </div>

        {/* Tautan ke Order Aktif (Opsional) */}
        <div className="flex flex-col gap-1">
          <label className="font-label text-label text-text-secondary">
            Keperluan / Tautkan ke Order (Opsional)
          </label>
          <select
            value={selectedOrderId}
            onChange={(e) => setSelectedOrderId(e.target.value)}
            className="w-full rounded-2xl border border-outline-variant bg-surface-container-low px-3 py-3 text-text-primary font-body text-body outline-none focus:border-brand-500"
          >
            <option value="">Lainnya / Operasional Stok Bengkel</option>
            {activeOrders.map((ord) => (
              <option key={ord.id} value={ord.id}>
                {ord.order_number ? `#${ord.order_number} - ` : ""}
                {ord.license_plate} ({ord.customer_name}
                {ord.vehicle_size ? ` - ${ord.vehicle_size}` : ""})
              </option>
            ))}
          </select>
          <span className="font-caption text-caption text-text-muted">
            Pilih unit order jika racikan dibuat/ditambah khusus untuk pengerjaan mobil tersebut.
          </span>
        </div>

        {/* Bahan Baku yang Akan Terpotong */}
        <div className="rounded-2xl bg-surface-container-low p-3.5 flex flex-col gap-1.5 border border-outline-variant/40">
          <span className="font-label text-label text-text-secondary">
            Bahan Baku Gudang yang Akan Terpotong:
          </span>
          {bundle.components.map((c) => (
            <div key={c.item_id} className="flex justify-between text-xs text-text-secondary">
              <span>• {c.item_name}</span>
              <span className="font-mono font-medium">
                {(c.quantity * batchCount).toLocaleString("id-ID")} {c.unit}
              </span>
            </div>
          ))}
        </div>

        {/* Catatan */}
        <div className="flex flex-col gap-1">
          <label className="font-label text-label text-text-secondary">
            Catatan Tambahan (opsional)
          </label>
          <textarea
            rows={2}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="mis: racikan semir ban cadangan untuk minggu ini"
            className="w-full rounded-2xl border border-outline-variant bg-surface-container-low px-4 py-2.5 text-text-primary font-body text-body outline-none focus:border-brand-500 resize-none"
          />
        </div>

        <button
          type="button"
          disabled={pending}
          onClick={handleSubmit}
          className="w-full rounded-2xl bg-brand-500 text-white font-label-bold text-label-bold py-3.5 active:scale-[0.98] transition-transform disabled:opacity-50"
        >
          {pending ? "Mengajukan…" : "Ajukan Produksi Racikan"}
        </button>
      </div>
    </Modal>
  );
}

// ─── Bundle Form Modal (Buat / Edit) ─────────────────────────────────────────

type ComponentDraft = {
  item_id: string;
  quantity: string;
};

function BundleFormModal({
  editing,
  availableItems,
  branchId,
  onClose,
}: {
  editing: BundleItem | null;
  availableItems: { id: string; item_name: string; unit: string; unit_cost: number }[];
  branchId: string;
  onClose: () => void;
}) {
  const toast = useToast();
  const [pending, startTransition] = useTransition();

  const [name, setName] = useState(editing?.bundle_name ?? "");
  const [unit, setUnit] = useState(editing?.unit ?? "ml");
  const [outputQty, setOutputQty] = useState(String(editing?.output_qty ?? 1000));
  const [desc, setDesc] = useState(editing?.description ?? "");
  const [components, setComponents] = useState<ComponentDraft[]>(
    editing
      ? editing.components.map((c) => ({ item_id: c.item_id, quantity: String(c.quantity) }))
      : [{ item_id: "", quantity: "100" }],
  );

  const itemById = Object.fromEntries(availableItems.map((i) => [i.id, i]));

  function addComponent() {
    setComponents((prev) => [...prev, { item_id: "", quantity: "50" }]);
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
    if (!unit.trim()) {
      toast.gagal("Data belum lengkap", "Satuan hasil output wajib diisi");
      return;
    }
    if (!parsedOutputQty || parsedOutputQty <= 0) {
      toast.gagal("Jumlah hasil tidak valid", "Hasil bersih per 1x racik harus lebih dari 0");
      return;
    }
    if (!validComponents.length) {
      toast.gagal("Bahan kosong", "Tambahkan minimal satu bahan baku");
      return;
    }

    startTransition(async () => {
      const res = await setBundleDefinitionAction({
        p_branch_id: branchId,
        p_bundle_name: name.trim(),
        p_unit: unit.trim(),
        p_output_qty: parsedOutputQty,
        p_description: desc.trim() || undefined,
        p_components: validComponents.map((c) => ({
          item_id: c.item_id,
          quantity: Number(c.quantity),
        })),
      });

      if (res.ok) {
        toast.sukses(
          "Berhasil",
          editing ? "Racikan berhasil diperbarui" : "Racikan berhasil dibuat",
        );
        onClose();
      } else {
        toast.gagal("Gagal", res.message ?? "Gagal menyimpan racikan");
      }
    });
  }

  const UNIT_OPTIONS = ["ml", "gram", "botol", "pack", "sachet", "lainnya"];

  return (
    <Modal
      open
      onClose={onClose}
      title={editing ? "Edit Racikan" : "Buat Racikan Baru"}
    >
      <div className="flex flex-col gap-4">
        {/* Nama Racikan */}
        <div className="flex flex-col gap-1">
          <label className="font-label text-label text-text-secondary">Nama Racikan</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="mis: Semir Ban Glossy Extra"
            className="w-full rounded-2xl border border-outline-variant bg-surface-container-low px-4 py-3 text-text-primary font-body text-body outline-none focus:border-brand-500"
          />
        </div>

        {/* Hasil Bersih 1x Racik & Satuan */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="flex flex-col gap-1">
            <label className="font-label text-label text-text-secondary">
              Hasil Jadi 1x Racik (Volume / Qty)
            </label>
            <input
              type="number"
              min="0.1"
              step="any"
              value={outputQty}
              onChange={(e) => setOutputQty(e.target.value)}
              placeholder="mis: 1000"
              className="w-full rounded-2xl border border-outline-variant bg-surface-container-low px-4 py-2.5 text-text-primary font-body text-body outline-none focus:border-brand-500"
            />
            <span className="font-caption text-caption text-text-muted">
              Total volume jadi setelah dicampur air/pelarut
            </span>
          </div>

          <div className="flex flex-col gap-1">
            <label className="font-label text-label text-text-secondary">Satuan Output</label>
            <div className="flex gap-1.5 flex-wrap">
              {UNIT_OPTIONS.map((opt) => (
                <button
                  key={opt}
                  type="button"
                  onClick={() => setUnit(opt === "lainnya" ? "" : opt)}
                  className={`px-3 py-1.5 rounded-xl font-caption text-caption border transition-colors ${
                    unit === opt || (opt === "lainnya" && !UNIT_OPTIONS.includes(unit) && unit !== "")
                      ? "bg-brand-500 text-white border-brand-500 font-medium"
                      : "bg-surface-container-low text-text-secondary border-outline-variant"
                  }`}
                >
                  {opt}
                </button>
              ))}
            </div>
            {!UNIT_OPTIONS.slice(0, -1).includes(unit) && (
              <input
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
                placeholder="Ketik satuan…"
                className="mt-1 w-full rounded-xl border border-outline-variant bg-surface-container-low px-3 py-2 text-text-primary font-body text-body outline-none focus:border-brand-500"
              />
            )}
          </div>
        </div>

        {/* Daftar Bahan Baku */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <label className="font-label text-label text-text-secondary">
              Komposisi Bahan Baku Gudang
            </label>
            <span className="font-caption text-caption text-text-muted">
              (Biaya dihitung otomatis)
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
                        {it.item_name} ({it.unit}) — @{formatRupiah(it.unit_cost)}/{it.unit}
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
                      placeholder="Qty"
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
                      className="shrink-0 w-8 h-8 rounded-lg bg-danger-surface text-danger-text flex items-center justify-center active:scale-95"
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
                    <span className="font-semibold text-text-primary">
                      = {formatRupiah(cost)}
                    </span>
                  </div>
                )}
              </div>
            );
          })}

          <button
            type="button"
            onClick={addComponent}
            className="flex items-center gap-2 text-brand-600 font-label text-label mt-1 w-fit active:scale-95"
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
            placeholder="mis: Campuran semir ban + pengkilap untuk motor & mobil"
            className="w-full rounded-2xl border border-outline-variant bg-surface-container-low px-4 py-2.5 text-text-primary font-body text-body outline-none focus:border-brand-500"
          />
        </div>

        {/* Breakdown Live Matematika HPP Otomatis */}
        <div className="rounded-2xl bg-surface-container-high border border-brand-200/60 p-4 flex flex-col gap-2 shadow-sm">
          <div className="flex items-center gap-2 text-brand-700 font-label text-label">
            <Icon name="calculate" className="text-[18px]" />
            <span>Kalkulasi HPP Otomatis Sistem</span>
          </div>

          <div className="flex flex-col gap-1 text-xs text-text-secondary pt-1 border-t border-outline-variant/40">
            <div className="flex justify-between">
              <span>Total Modal Bahan per 1x Racik:</span>
              <span className="font-bold text-text-primary text-sm">
                {formatRupiah(totalBatchHpp)}
              </span>
            </div>
            <div className="flex justify-between">
              <span>Hasil Volume Jadi:</span>
              <span className="font-medium text-text-primary">
                {parsedOutputQty.toLocaleString("id-ID")} {unit}
              </span>
            </div>
            <div className="flex justify-between items-center pt-1.5 border-t border-dashed border-outline-variant">
              <span className="font-semibold text-brand-800">
                HPP Bersih per {unit || "unit"}:
              </span>
              <span className="font-headline-2 text-headline-2 text-brand-600">
                {formatRupiah(hppPerUnit)} / {unit || "unit"}
              </span>
            </div>
          </div>
          <span className="text-[11px] text-text-muted italic">
            * Anda tidak perlu menghitung manual. Nilai ini otomatis dipecah ke resep jasa per ukuran kendaraan.
          </span>
        </div>

        <button
          type="button"
          disabled={pending}
          onClick={handleSave}
          className="w-full rounded-2xl bg-brand-500 text-white font-label-bold text-label-bold py-3.5 active:scale-[0.98] transition-transform disabled:opacity-50 mt-1"
        >
          {pending ? "Menyimpan…" : editing ? "Simpan Perubahan" : "Buat Racikan Sekarang"}
        </button>
      </div>
    </Modal>
  );
}

// ─── Delete Confirm Modal ─────────────────────────────────────────────────────

function DeleteConfirmModal({
  bundle,
  onClose,
}: {
  bundle: BundleItem;
  onClose: () => void;
}) {
  const toast = useToast();
  const [pending, startTransition] = useTransition();

  function handleDelete() {
    startTransition(async () => {
      const res = await deleteBundleAction(bundle.id);
      if (res.ok) {
        toast.sukses("Berhasil", "Racikan berhasil dinonaktifkan");
        onClose();
      } else {
        toast.gagal("Gagal", res.message ?? "Gagal menghapus racikan");
      }
    });
  }

  return (
    <Modal open onClose={onClose} title="Hapus Racikan">
      <div className="flex flex-col gap-4">
        <p className="font-body text-body text-text-secondary">
          Yakin ingin menghapus racikan{" "}
          <strong className="text-text-primary">{bundle.bundle_name}</strong>?
          Tindakan ini akan menonaktifkan racikan dari resep jasa.
        </p>
        <div className="flex gap-3">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-2xl border border-outline-variant bg-surface-container-low text-text-primary font-label text-label py-3 active:scale-[0.98] transition-transform"
          >
            Batal
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={handleDelete}
            className="flex-1 rounded-2xl bg-danger text-white font-label-bold text-label-bold py-3 active:scale-[0.98] transition-transform disabled:opacity-50"
          >
            {pending ? "Menghapus…" : "Hapus"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ─── Bundle Card ──────────────────────────────────────────────────────────────

function BundleCard({
  bundle,
  canManage,
  onClaim,
  onEdit,
  onDelete,
}: {
  bundle: BundleItem;
  canManage: boolean;
  onClaim: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const hasStock = bundle.current_stock > 0;

  return (
    <div className="clay-card bg-surface rounded-[24px] p-4 sm:p-5 flex flex-col gap-3.5 shadow-sm border border-outline-variant/30">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-headline-2 text-headline-2 text-text-primary">
              {bundle.bundle_name}
            </span>
            <span
              className={`rounded-full px-2.5 py-0.5 font-caption text-caption font-semibold ${
                hasStock
                  ? "bg-success-surface text-success-text"
                  : "bg-danger-surface text-danger-text"
              }`}
            >
              Stok: {bundle.current_stock.toLocaleString("id-ID")} {bundle.unit}
            </span>
          </div>
          {bundle.description && (
            <p className="font-caption text-caption text-text-muted mt-1">
              {bundle.description}
            </p>
          )}
        </div>

        {canManage && (
          <div className="flex gap-1 shrink-0">
            <button
              type="button"
              onClick={onEdit}
              className="w-9 h-9 rounded-xl bg-surface-container-low text-text-secondary flex items-center justify-center active:scale-95"
              aria-label="Edit"
            >
              <Icon name="edit" className="text-[18px]" />
            </button>
            <button
              type="button"
              onClick={onDelete}
              className="w-9 h-9 rounded-xl bg-danger-surface text-danger-text flex items-center justify-center active:scale-95"
              aria-label="Hapus"
            >
              <Icon name="delete" className="text-[18px]" />
            </button>
          </div>
        )}
      </div>

      {/* Info Biaya HPP Otomatis */}
      <div className="rounded-2xl bg-surface-container-low p-3 grid grid-cols-2 gap-2 border border-outline-variant/40">
        <div>
          <span className="font-caption text-caption text-text-muted block">
            Modal 1x Racik ({bundle.output_qty} {bundle.unit}):
          </span>
          <span className="font-body-bold text-body-bold text-text-primary">
            {formatRupiah(bundle.total_hpp_batch)}
          </span>
        </div>
        <div>
          <span className="font-caption text-caption text-text-muted block">
            HPP per {bundle.unit}:
          </span>
          <span className="font-body-bold text-body-bold text-brand-600">
            {formatRupiah(bundle.hpp_per_unit)} / {bundle.unit}
          </span>
        </div>
      </div>

      {/* Rincian Komposisi */}
      {bundle.components.length > 0 && (
        <div className="rounded-xl bg-surface-container-low/70 px-3 py-2 text-xs text-text-secondary">
          <span className="font-medium text-text-primary block mb-0.5">Komposisi Bahan:</span>
          {componentsPreview(bundle.components, bundle.output_qty, bundle.unit)}
        </div>
      )}

      {/* Tombol Produksi Racikan */}
      <button
        type="button"
        onClick={onClaim}
        className="w-full rounded-2xl bg-brand-500 text-white font-label-bold text-label-bold py-3 flex items-center justify-center gap-2 active:scale-[0.98] transition-transform"
      >
        <Icon name="science" className="text-[18px]" />
        Produksi / Tambah Stok Racikan
      </button>
    </div>
  );
}

// ─── Claim Card ───────────────────────────────────────────────────────────────

function ClaimCard({
  claim,
  canManage,
}: {
  claim: BundleClaim;
  canManage: boolean;
}) {
  const toast = useToast();
  const [expanded, setExpanded] = useState(false);
  const [pending, startTransition] = useTransition();

  const statusInfo = STATUS_MAP[claim.status] ?? {
    label: claim.status,
    cls: "bg-surface-container-low text-text-muted",
    icon: "info",
  };

  function handleConfirm() {
    startTransition(async () => {
      const res = await confirmBundleClaimAction(claim.id);
      if (res.ok) {
        toast.sukses("Disetujui", "Klaim berhasil disetujui & stok racikan bertambah.");
      } else {
        toast.gagal("Gagal", res.message ?? "Gagal menyetujui klaim");
      }
    });
  }

  function handleReject() {
    const reason = window.prompt("Alasan penolakan (opsional):");
    if (reason === null) return;
    startTransition(async () => {
      const res = await rejectBundleClaimAction(claim.id, reason.trim());
      if (res.ok) toast.sukses("Ditolak", "Klaim berhasil ditolak");
      else toast.gagal("Gagal", res.message ?? "Gagal menolak klaim");
    });
  }

  return (
    <div className="clay-card bg-surface rounded-[20px] overflow-hidden border border-outline-variant/30">
      <button
        type="button"
        className="w-full text-left px-4 py-3.5 flex items-center gap-3"
        onClick={() => setExpanded((v) => !v)}
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-body-bold text-body-bold text-text-primary">
              {claim.bundle_name}
            </span>
            <span className="font-caption text-caption text-text-muted">
              •&nbsp;{claim.quantity} batch
            </span>
            {claim.order_label && (
              <span className="rounded-full bg-brand-50 text-brand-700 font-caption text-caption px-2 py-0.5 border border-brand-200">
                {claim.order_label}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            <span
              className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 font-caption text-caption ${statusInfo.cls}`}
            >
              <Icon name={statusInfo.icon} className="text-[14px]" />
              {statusInfo.label}
            </span>
            <span className="font-caption text-caption text-text-muted">
              {formatDateTimeWib(claim.created_at)}
            </span>
          </div>
        </div>
        <Icon
          name={expanded ? "expand_less" : "expand_more"}
          className="text-[20px] text-text-muted shrink-0"
        />
      </button>

      {expanded && (
        <div className="px-4 pb-4 flex flex-col gap-3 border-t border-outline-variant/30">
          <div className="pt-3 grid grid-cols-1 gap-1.5 text-sm">
            <Row label="Diajukan oleh" value={claim.claimed_by_name} />
            {claim.order_label && (
              <Row label="Tautan Order" value={claim.order_label} />
            )}
            {claim.confirmed_by_name && (
              <Row
                label={claim.status === "rejected" ? "Ditolak oleh" : "Disetujui oleh"}
                value={`${claim.confirmed_by_name}${
                  claim.confirmed_at ? ` pada ${formatDateTimeWib(claim.confirmed_at)}` : ""
                }`}
              />
            )}
            {claim.note && <Row label="Catatan" value={claim.note} />}
          </div>

          {/* Komponen yang terpotong dari gudang */}
          {claim.components.length > 0 && (
            <div className="rounded-xl bg-surface-container-low px-3 py-2 flex flex-col gap-1">
              <span className="font-label text-label text-text-secondary mb-0.5">
                Bahan baku yang dipotong dari gudang:
              </span>
              {claim.components.map((comp) => (
                <span
                  key={comp.item_id}
                  className="font-caption text-caption text-text-secondary"
                >
                  • {comp.item_name} → -{(comp.quantity * claim.quantity).toLocaleString("id-ID")} {comp.unit}
                </span>
              ))}
            </div>
          )}

          {/* Approve / Reject buttons for manager/owner/finance/kepala */}
          {claim.status === "pending" && canManage && (
            <div className="flex gap-2 pt-1">
              <button
                type="button"
                disabled={pending}
                onClick={handleConfirm}
                className="flex-1 rounded-2xl bg-success text-white font-label-bold text-label-bold py-2.5 flex items-center justify-center gap-1.5 active:scale-[0.98] transition-transform disabled:opacity-50"
              >
                <Icon name="task_alt" className="text-[16px]" />
                Setujui & Tambah Stok
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={handleReject}
                className="flex-1 rounded-2xl bg-danger-surface text-danger-text font-label-bold text-label-bold py-2.5 flex items-center justify-center gap-1.5 active:scale-[0.98] transition-transform disabled:opacity-50"
              >
                <Icon name="block" className="text-[16px]" />
                Tolak
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-1.5">
      <span className="font-caption text-caption text-text-muted shrink-0 w-32">{label}:</span>
      <span className="font-caption text-caption text-text-secondary">{value}</span>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

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
  availableItems: { id: string; item_name: string; unit: string; unit_cost: number }[];
  activeOrders: ActiveOrderOption[];
  canManage: boolean;
  branchId: string;
}) {
  const [tab, setTab] = useState<"bundles" | "claims">("bundles");

  // Modals
  const [claimTarget, setClaimTarget] = useState<BundleItem | null>(null);
  const [editTarget, setEditTarget] = useState<BundleItem | null | "new">(null);
  const [deleteTarget, setDeleteTarget] = useState<BundleItem | null>(null);

  return (
    <div className="flex flex-col flex-1">
      {/* Tabs */}
      <div className="px-4 pt-4 flex gap-2">
        <button
          type="button"
          onClick={() => setTab("bundles")}
          className={`flex-1 rounded-2xl py-2.5 font-label-bold text-label-bold transition-colors ${
            tab === "bundles"
              ? "bg-brand-500 text-white"
              : "bg-surface-container-low text-text-secondary"
          }`}
        >
          Daftar Racikan ({bundles.length})
        </button>
        <button
          type="button"
          onClick={() => setTab("claims")}
          className={`flex-1 rounded-2xl py-2.5 font-label-bold text-label-bold transition-colors ${
            tab === "claims"
              ? "bg-brand-500 text-white"
              : "bg-surface-container-low text-text-secondary"
          }`}
        >
          Riwayat Produksi ({claims.length})
        </button>
      </div>

      <main className="flex-1 px-4 py-4 flex flex-col gap-3">
        {/* ── Section 1 & 2: Daftar Bundle ── */}
        {tab === "bundles" && (
          <>
            {canManage && (
              <button
                type="button"
                onClick={() => setEditTarget("new")}
                className="flex items-center gap-2 justify-center w-full rounded-2xl border-2 border-dashed border-brand-300 text-brand-600 font-label-bold text-label-bold py-3.5 active:scale-[0.98] transition-transform bg-brand-50/40"
              >
                <Icon name="add_circle" className="text-[20px]" />
                Buat Racikan Baru
              </button>
            )}

            {bundles.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-12 text-text-muted">
                <Icon name="science" className="text-[40px]" />
                <span className="font-body text-body">Belum ada racikan dibuat</span>
                <span className="font-caption text-caption text-center max-w-xs">
                  Klik tombol &ldquo;Buat Racikan Baru&rdquo; di atas untuk mencampur bahan baku gudang.
                </span>
              </div>
            ) : (
              bundles.map((bundle) => (
                <BundleCard
                  key={bundle.id}
                  bundle={bundle}
                  canManage={canManage}
                  onClaim={() => setClaimTarget(bundle)}
                  onEdit={() => setEditTarget(bundle)}
                  onDelete={() => setDeleteTarget(bundle)}
                />
              ))
            )}
          </>
        )}

        {/* ── Section 3: Riwayat Klaim ── */}
        {tab === "claims" && (
          <>
            {claims.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-12 text-text-muted">
                <Icon name="history" className="text-[40px]" />
                <span className="font-body text-body">Belum ada riwayat produksi</span>
              </div>
            ) : (
              claims.map((claim) => (
                <ClaimCard
                  key={claim.id}
                  claim={claim}
                  canManage={canManage}
                />
              ))
            )}
          </>
        )}
      </main>

      {/* ── Modals ── */}
      {claimTarget && (
        <ClaimModal
          bundle={claimTarget}
          activeOrders={activeOrders}
          onClose={() => setClaimTarget(null)}
        />
      )}

      {editTarget !== null && (
        <BundleFormModal
          editing={editTarget === "new" ? null : editTarget}
          availableItems={availableItems}
          branchId={branchId}
          onClose={() => setEditTarget(null)}
        />
      )}

      {deleteTarget && (
        <DeleteConfirmModal bundle={deleteTarget} onClose={() => setDeleteTarget(null)} />
      )}
    </div>
  );
}
