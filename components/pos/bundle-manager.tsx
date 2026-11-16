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
};

export type BundleItem = {
  id: string;
  bundle_name: string;
  unit: string;
  description: string | null;
  components: BundleComponent[];
};

export type BundleClaim = {
  id: string;
  bundle_id: string;
  bundle_name: string;
  quantity: number;
  unit: string;
  note: string | null;
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

function componentsPreview(components: BundleComponent[], unit: string): string {
  if (components.length === 0) return "Belum ada bahan";
  return `1 ${unit} = ${components.map((c) => `${c.quantity} ${c.unit} ${c.item_name}`).join(" + ")}`;
}

// ─── Claim Modal ──────────────────────────────────────────────────────────────

function ClaimModal({
  bundle,
  onClose,
}: {
  bundle: BundleItem;
  onClose: () => void;
}) {
  const toast = useToast();
  const [qty, setQty] = useState("1");
  const [note, setNote] = useState("");
  const [pending, startTransition] = useTransition();

  function handleSubmit() {
    const qtyNum = Number(qty);
    if (!qtyNum || qtyNum <= 0) {
      toast.gagal("Jumlah tidak valid", "Jumlah harus lebih dari 0");
      return;
    }
    startTransition(async () => {
      const res = await createBundleClaimAction({
        p_bundle_id: bundle.id,
        p_quantity: qtyNum,
        p_note: note.trim() || undefined,
      });
      if (res.ok) {
        toast.sukses("Klaim diajukan", "Klaim racikan berhasil dikirim.");
        onClose();
      } else {
        toast.gagal("Gagal klaim", res.message ?? "Gagal mengajukan klaim");
      }
    });
  }

  return (
    <Modal open onClose={onClose} title={`Ajukan Klaim — ${bundle.bundle_name}`}>
      <div className="flex flex-col gap-4">
        <div className="rounded-2xl bg-surface-container-low p-3 text-sm text-text-secondary">
          {componentsPreview(bundle.components, bundle.unit)}
        </div>

        <div className="flex flex-col gap-1">
          <label className="font-label text-label text-text-secondary">
            Jumlah ({bundle.unit})
          </label>
          <input
            type="number"
            min="1"
            step="1"
            value={qty}
            onChange={(e) => setQty(e.target.value)}
            className="w-full rounded-2xl border border-outline-variant bg-surface-container-low px-4 py-3 text-text-primary font-body text-body outline-none focus:border-brand-500"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className="font-label text-label text-text-secondary">
            Catatan (opsional)
          </label>
          <textarea
            rows={2}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="mis: untuk produksi batch pagi"
            className="w-full rounded-2xl border border-outline-variant bg-surface-container-low px-4 py-3 text-text-primary font-body text-body outline-none focus:border-brand-500 resize-none"
          />
        </div>

        <button
          type="button"
          disabled={pending}
          onClick={handleSubmit}
          className="w-full rounded-2xl bg-brand-500 text-white font-label-bold text-label-bold py-3.5 active:scale-[0.98] transition-transform disabled:opacity-50"
        >
          {pending ? "Mengajukan…" : "Ajukan Klaim"}
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
  availableItems: { id: string; item_name: string; unit: string }[];
  branchId: string;
  onClose: () => void;
}) {
  const toast = useToast();
  const [pending, startTransition] = useTransition();

  const [name, setName] = useState(editing?.bundle_name ?? "");
  const [unit, setUnit] = useState(editing?.unit ?? "pack");
  const [desc, setDesc] = useState(editing?.description ?? "");
  const [components, setComponents] = useState<ComponentDraft[]>(
    editing
      ? editing.components.map((c) => ({ item_id: c.item_id, quantity: String(c.quantity) }))
      : [{ item_id: "", quantity: "1" }],
  );

  const itemById = Object.fromEntries(availableItems.map((i) => [i.id, i]));

  function addComponent() {
    setComponents((prev) => [...prev, { item_id: "", quantity: "1" }]);
  }

  function removeComponent(idx: number) {
    setComponents((prev) => prev.filter((_, i) => i !== idx));
  }

  function updateComponent(idx: number, field: keyof ComponentDraft, value: string) {
    setComponents((prev) =>
      prev.map((c, i) => (i === idx ? { ...c, [field]: value } : c)),
    );
  }

  function buildPreview(): string {
    const filled = components.filter((c) => c.item_id && Number(c.quantity) > 0);
    if (!filled.length) return "Belum ada bahan";
    const parts = filled
      .map((c) => {
        const item = itemById[c.item_id];
        return `${c.quantity} ${item?.unit ?? ""} ${item?.item_name ?? ""}`;
      })
      .join(" + ");
    return `1 ${unit || "unit"} = ${parts}`;
  }

  function handleSave() {
    if (!name.trim()) { toast.gagal("Data belum lengkap", "Nama racikan wajib diisi"); return; }
    if (!unit.trim()) { toast.gagal("Data belum lengkap", "Satuan output wajib diisi"); return; }
    const filled = components.filter((c) => c.item_id && Number(c.quantity) > 0);
    if (!filled.length) { toast.gagal("Bahan kosong", "Tambahkan minimal satu bahan"); return; }

    startTransition(async () => {
      const res = await setBundleDefinitionAction({
        p_branch_id: branchId,
        p_bundle_name: name.trim(),
        p_unit: unit.trim(),
        p_description: desc.trim() || undefined,
        p_components: filled.map((c) => ({ item_id: c.item_id, quantity: Number(c.quantity) })),
      });
      if (res.ok) {
        toast.sukses("Berhasil", editing ? "Racikan berhasil diperbarui" : "Racikan berhasil dibuat");
        onClose();
      } else {
        toast.gagal("Gagal", res.message ?? "Gagal menyimpan racikan");
      }
    });
  }

  const UNIT_OPTIONS = ["pack", "botol", "sachet", "lainnya"];

  return (
    <Modal
      open
      onClose={onClose}
      title={editing ? "Edit Racikan" : "Buat Racikan Baru"}
    >
      <div className="flex flex-col gap-4">
        {/* Nama */}
        <div className="flex flex-col gap-1">
          <label className="font-label text-label text-text-secondary">Nama Racikan</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="mis: Paket HF + HCL"
            className="w-full rounded-2xl border border-outline-variant bg-surface-container-low px-4 py-3 text-text-primary font-body text-body outline-none focus:border-brand-500"
          />
        </div>

        {/* Satuan output */}
        <div className="flex flex-col gap-1">
          <label className="font-label text-label text-text-secondary">Satuan Output</label>
          <div className="flex gap-2 flex-wrap">
            {UNIT_OPTIONS.map((opt) => (
              <button
                key={opt}
                type="button"
                onClick={() => setUnit(opt === "lainnya" ? "" : opt)}
                className={`px-4 py-2 rounded-xl font-label text-label border transition-colors ${
                  unit === opt || (opt === "lainnya" && !UNIT_OPTIONS.includes(unit) && unit !== "")
                    ? "bg-brand-500 text-white border-brand-500"
                    : "bg-surface-container-low text-text-secondary border-outline-variant"
                }`}
              >
                {opt}
              </button>
            ))}
          </div>
          {(!UNIT_OPTIONS.slice(0, -1).includes(unit)) && (
            <input
              value={unit}
              onChange={(e) => setUnit(e.target.value)}
              placeholder="Ketik satuan…"
              className="mt-1 w-full rounded-2xl border border-outline-variant bg-surface-container-low px-4 py-2.5 text-text-primary font-body text-body outline-none focus:border-brand-500"
            />
          )}
        </div>

        {/* Deskripsi */}
        <div className="flex flex-col gap-1">
          <label className="font-label text-label text-text-secondary">
            Deskripsi (opsional)
          </label>
          <input
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
            placeholder="mis: Campuran untuk poles eksterior"
            className="w-full rounded-2xl border border-outline-variant bg-surface-container-low px-4 py-3 text-text-primary font-body text-body outline-none focus:border-brand-500"
          />
        </div>

        {/* Komponen */}
        <div className="flex flex-col gap-2">
          <label className="font-label text-label text-text-secondary">Daftar Bahan</label>
          {components.map((comp, idx) => (
            <div key={idx} className="flex gap-2 items-center">
              <select
                value={comp.item_id}
                onChange={(e) => updateComponent(idx, "item_id", e.target.value)}
                className="flex-1 min-w-0 rounded-2xl border border-outline-variant bg-surface-container-low px-3 py-2.5 text-text-primary font-body text-body outline-none focus:border-brand-500"
              >
                <option value="">Pilih bahan…</option>
                {availableItems.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.item_name} ({item.unit})
                  </option>
                ))}
              </select>
              <input
                type="number"
                min="0.01"
                step="any"
                value={comp.quantity}
                onChange={(e) => updateComponent(idx, "quantity", e.target.value)}
                className="w-20 shrink-0 rounded-2xl border border-outline-variant bg-surface-container-low px-3 py-2.5 text-text-primary font-body text-body outline-none focus:border-brand-500"
              />
              {components.length > 1 && (
                <button
                  type="button"
                  onClick={() => removeComponent(idx)}
                  className="shrink-0 w-9 h-9 rounded-xl bg-danger-surface text-danger-text flex items-center justify-center active:scale-95"
                >
                  <Icon name="delete" className="text-[18px]" />
                </button>
              )}
            </div>
          ))}
          <button
            type="button"
            onClick={addComponent}
            className="flex items-center gap-2 text-brand-600 font-label text-label mt-1 w-fit"
          >
            <Icon name="add_circle" className="text-[18px]" />
            Tambah Bahan
          </button>
        </div>

        {/* Preview */}
        <div className="rounded-2xl bg-surface-container-low p-3 text-sm text-text-secondary border border-dashed border-outline-variant">
          <span className="font-label text-label text-text-primary block mb-1">Preview:</span>
          {buildPreview()}
        </div>

        <button
          type="button"
          disabled={pending}
          onClick={handleSave}
          className="w-full rounded-2xl bg-brand-500 text-white font-label-bold text-label-bold py-3.5 active:scale-[0.98] transition-transform disabled:opacity-50"
        >
          {pending ? "Menyimpan…" : editing ? "Simpan Perubahan" : "Buat Racikan"}
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
        toast.sukses("Berhasil", "Racikan berhasil dihapus");
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
          Tindakan ini tidak dapat dibatalkan.
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
  return (
    <div className="clay-card bg-surface rounded-[20px] p-4 flex flex-col gap-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-body-bold text-body-bold text-text-primary">
              {bundle.bundle_name}
            </span>
            <span className="rounded-full bg-brand-50 text-brand-600 font-caption text-caption px-2 py-0.5">
              {bundle.unit}
            </span>
            <span className="rounded-full bg-surface-container-low text-text-muted font-caption text-caption px-2 py-0.5">
              {bundle.components.length} bahan
            </span>
          </div>
          {bundle.description && (
            <p className="font-caption text-caption text-text-muted mt-0.5">
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

      {bundle.components.length > 0 && (
        <div className="rounded-xl bg-surface-container-low px-3 py-2 font-caption text-caption text-text-secondary">
          {componentsPreview(bundle.components, bundle.unit)}
        </div>
      )}

      <button
        type="button"
        onClick={onClaim}
        className="w-full rounded-2xl bg-brand-500 text-white font-label-bold text-label-bold py-3 flex items-center justify-center gap-2 active:scale-[0.98] transition-transform"
      >
        <Icon name="science" className="text-[18px]" />
        Ajukan Klaim
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
      if (res.ok) toast.sukses("Disetujui", "Klaim berhasil disetujui");
      else toast.gagal("Gagal", res.message ?? "Gagal menyetujui klaim");
    });
  }

  function handleReject() {
    const reason = window.prompt("Alasan penolakan (opsional):");
    if (reason === null) return; // user cancelled
    startTransition(async () => {
      const res = await rejectBundleClaimAction(claim.id, reason.trim());
      if (res.ok) toast.sukses("Ditolak", "Klaim berhasil ditolak");
      else toast.gagal("Gagal", res.message ?? "Gagal menolak klaim");
    });
  }

  return (
    <div className="clay-card bg-surface rounded-[20px] overflow-hidden">
      {/* Header row — always visible */}
      <button
        type="button"
        className="w-full text-left px-4 py-3 flex items-center gap-3"
        onClick={() => setExpanded((v) => !v)}
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-body-bold text-body-bold text-text-primary">
              {claim.bundle_name}
            </span>
            <span className="font-caption text-caption text-text-muted">
              •&nbsp;{claim.quantity} {claim.unit}
            </span>
          </div>
          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
            <span
              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-caption text-caption ${statusInfo.cls}`}
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

      {/* Expanded detail */}
      {expanded && (
        <div className="px-4 pb-4 flex flex-col gap-3 border-t border-outline-variant/30">
          <div className="pt-3 grid grid-cols-1 gap-1.5 text-sm">
            <Row label="Diajukan oleh" value={claim.claimed_by_name} />
            {claim.confirmed_by_name && (
              <Row
                label={claim.status === "rejected" ? "Ditolak oleh" : "Disetujui oleh"}
                value={`${claim.confirmed_by_name}${claim.confirmed_at ? ` pada ${formatDateTimeWib(claim.confirmed_at)}` : ""}`}
              />
            )}
            {claim.note && <Row label="Catatan" value={claim.note} />}
          </div>

          {/* Komponen yang terpotong (jika confirmed) */}
          {claim.status === "confirmed" && claim.components.length > 0 && (
            <div className="rounded-xl bg-surface-container-low px-3 py-2 flex flex-col gap-1">
              <span className="font-label text-label text-text-secondary mb-0.5">
                Komponen yang dikurangi:
              </span>
              {claim.components.map((comp) => (
                <span
                  key={comp.item_id}
                  className="font-caption text-caption text-text-secondary"
                >
                  • {comp.item_name} → -{comp.quantity * claim.quantity} {comp.unit}
                </span>
              ))}
            </div>
          )}

          {/* Approve / Reject buttons for manager */}
          {claim.status === "pending" && canManage && (
            <div className="flex gap-2">
              <button
                type="button"
                disabled={pending}
                onClick={handleConfirm}
                className="flex-1 rounded-2xl bg-success text-white font-label-bold text-label-bold py-2.5 flex items-center justify-center gap-1.5 active:scale-[0.98] transition-transform disabled:opacity-50"
              >
                <Icon name="task_alt" className="text-[16px]" />
                Setujui
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
  canManage,
  branchId,
}: {
  bundles: BundleItem[];
  claims: BundleClaim[];
  availableItems: { id: string; item_name: string; unit: string }[];
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
          Daftar Racikan
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
          Riwayat Klaim
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
                className="flex items-center gap-2 justify-center w-full rounded-2xl border-2 border-dashed border-brand-300 text-brand-600 font-label-bold text-label-bold py-3.5 active:scale-[0.98] transition-transform"
              >
                <Icon name="add_circle" className="text-[20px]" />
                Buat Racikan Baru
              </button>
            )}

            {bundles.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-12 text-text-muted">
                <Icon name="science" className="text-[40px]" />
                <span className="font-body text-body">Belum ada racikan</span>
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
                <span className="font-body text-body">Belum ada riwayat klaim</span>
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
        <ClaimModal bundle={claimTarget} onClose={() => setClaimTarget(null)} />
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
