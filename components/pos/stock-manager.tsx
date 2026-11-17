"use client";

import { useMemo, useRef, useState } from "react";
import { useToast } from "@/components/toast";
import { SyaratBelumTerpenuhi } from "@/components/submit-requirements";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { formatTimeWib, formatDateWib } from "@/lib/format";
import { formatAngka } from "@/lib/pos";
import { Icon } from "@/components/ui/icon";
import { Modal } from "@/components/ui/modal";
import {
  confirmStockClaimAction,
  rejectStockClaimAction,
  recordStockInAction,
  createStockClaimAction,
  updateInventoryItemAction,
} from "@/app/actions/stok";

export type InventoryItem = {
  id: string;
  item_name: string;
  current_stock: number;
  unit: string;
  min_stock_alert: number;
  purchase_unit?: string | null;
  purchase_price?: number | null;
  purchase_content_qty?: number | null;
  unit_cost?: number | null;
};

export type StockClaim = {
  id: string;
  item_id: string;
  item_name: string;
  quantity: number;
  unit: string;
  note: string | null;
  order_id?: string | null;
  order_label?: string | null;
  status: string;
  claimed_by_name: string;
  confirmed_by_name: string | null;
  created_at: string;
  confirmed_at: string | null;
};

const CLAIM_STATUS: Record<string, { label: string; cls: string; icon: string }> =
  {
    pending: {
      label: "Menunggu",
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

export function StockManager({
  items: initialItems,
  claims: initialClaims,
  activeOrders = [],
  canManage,
}: {
  items: InventoryItem[];
  claims: StockClaim[];
  activeOrders?: {
    id: string;
    order_number: string | null;
    license_plate: string;
    customer_name: string;
    vehicle_size: string | null;
  }[];
  canManage: boolean;
}) {
  const router = useRouter();

const items = initialItems;
const claims = initialClaims;
const [tab, setTab] = useState<"items" | "claims">("items");
  const toast = useToast();
  const [selected, setSelected] = useState<InventoryItem | null>(null);
  const [qty, setQty] = useState("1");
  const [claimOrderId, setClaimOrderId] = useState("");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  // Formulir stok masuk memakai state terpisah agar tidak bentrok dengan modal
  // klaim dan angka pengajuan tidak tertimpa.
  const [inOpen, setInOpen] = useState(false);
  const [inItemId, setInItemId] = useState("");
  const [cariBarang, setCariBarang] = useState("");
  // Modal tambah item baru
  const [newItemOpen, setNewItemOpen] = useState(false);
  const [newItemName, setNewItemName] = useState("");
  const [newItemUnit, setNewItemUnit] = useState("ml");
  const [newItemPurchaseUnit, setNewItemPurchaseUnit] = useState("Botol");
  const [newItemPurchasePrice, setNewItemPurchasePrice] = useState("");
  const [newItemPurchaseContentQty, setNewItemPurchaseContentQty] = useState("1000");
  const [newItemStock, setNewItemStock] = useState("1000");
  const [newItemMin, setNewItemMin] = useState("200");
  const [newItemCost, setNewItemCost] = useState("");
  const [newItemLoading, setNewItemLoading] = useState(false);
  const [newItemError, setNewItemError] = useState<string | null>(null);

  const previewUnitCost = useMemo(() => {
    const price = Number(newItemPurchasePrice);
    const content = Number(newItemPurchaseContentQty);
    if (price > 0 && content > 0) {
      return Math.round((price / content) * 100) / 100;
    }
    return Number(newItemCost) || 0;
  }, [newItemPurchasePrice, newItemPurchaseContentQty, newItemCost]);
  const [deleteTarget, setDeleteTarget] = useState<InventoryItem | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Modal edit item
  const [editItemTarget, setEditItemTarget] = useState<InventoryItem | null>(null);
  const [editItemName, setEditItemName] = useState("");
  const [editItemUnit, setEditItemUnit] = useState("ml");
  const [editItemPurchaseUnit, setEditItemPurchaseUnit] = useState("Botol");
  const [editItemPurchasePrice, setEditItemPurchasePrice] = useState("");
  const [editItemPurchaseContentQty, setEditItemPurchaseContentQty] = useState("1000");
  const [editItemMin, setEditItemMin] = useState("200");
  const [editItemStock, setEditItemStock] = useState("");
  const [editItemLoading, setEditItemLoading] = useState(false);
  const [editItemError, setEditItemError] = useState<string | null>(null);

  const editPreviewUnitCost = useMemo(() => {
    const price = Number(editItemPurchasePrice);
    const content = Number(editItemPurchaseContentQty);
    if (price > 0 && content > 0) {
      return Math.round((price / content) * 100) / 100;
    }
    return 0;
  }, [editItemPurchasePrice, editItemPurchaseContentQty]);

  function openEditItem(item: InventoryItem) {
    setEditItemTarget(item);
    setEditItemName(item.item_name);
    setEditItemUnit(item.unit || "ml");
    setEditItemPurchaseUnit(item.purchase_unit || "Botol");
    setEditItemPurchasePrice(item.purchase_price ? String(item.purchase_price) : "");
    setEditItemPurchaseContentQty(item.purchase_content_qty ? String(item.purchase_content_qty) : "1000");
    setEditItemMin(item.min_stock_alert !== undefined ? String(item.min_stock_alert) : "200");
    setEditItemStock(item.current_stock !== undefined ? String(item.current_stock) : "");
    setEditItemError(null);
  }

  async function submitEditItem() {
    if (!editItemTarget) return;
    if (!editItemName.trim()) { setEditItemError("Nama item wajib diisi."); return; }
    setEditItemLoading(true);
    setEditItemError(null);
    try {
      const pPrice = Number(editItemPurchasePrice) || 0;
      const pQty = Number(editItemPurchaseContentQty) || 1;
      const pStock = editItemStock.trim() !== "" ? Number(editItemStock) : undefined;

      const result = await updateInventoryItemAction({
        p_item_id: editItemTarget.id,
        p_item_name: editItemName.trim(),
        p_unit: editItemUnit.trim() || "pcs",
        p_min_stock_alert: Number(editItemMin) || 0,
        p_purchase_unit: editItemPurchaseUnit.trim() || "Pcs",
        p_purchase_price: pPrice,
        p_purchase_content_qty: pQty,
        p_current_stock: pStock,
      });

      if (!result.ok) {
        setEditItemError(result.message);
        return;
      }

      toast.sukses("Item diperbarui", `${editItemName.trim()} berhasil disimpan.`);
      setEditItemTarget(null);
      router.refresh();
    } catch (e) {
      setEditItemError(e instanceof Error ? e.message : "Gagal memperbarui item.");
    } finally {
      setEditItemLoading(false);
    }
  }
  // Penahan sinkron untuk menahan double-klik. State submitting baru berlaku
  // setelah React selesai merender, jadi dua klik cepat bisa sama-sama lolos
  // sebelum tombol terlihat mati.
  const kirimSedangJalan = useRef(false);
  const klaimSedangJalan = useRef(false);
  const [inQty, setInQty] = useState("1");
  const [inCost, setInCost] = useState("");
  const [inNote, setInNote] = useState("");
  // Pencarian dan filter huruf untuk daftar barang. Tanpa ini, daftar barang
  // yang panjang harus digulir satu per satu hanya untuk menemukan satu nama.
  const [cariItem, setCariItem] = useState("");
  const [huruf, setHuruf] = useState<string>("all");
  const [expandedClaimId, setExpandedClaimId] = useState<string | null>(null);

// Diturunkan setelah seluruh state dideklarasikan. Barisnya sebelumnya diletakkan
// di atas deklarasi state sehingga memicu zona mati temporal dan membuat seluruh
// halaman gagal render dengan galat 500 untuk semua peran.
const inItem = items.find((item) => item.id === inItemId) ?? null;

  const barangTersaring = useMemo(() => {
    const q = cariBarang.trim().toLowerCase();
    if (!q) return items;
    return items.filter((item) =>
      item.item_name.toLowerCase().includes(q),
    );
  }, [items, cariBarang]);

  const itemsTerfilter = useMemo(() => {
    const q = cariItem.trim().toLowerCase();
    return items
      .filter((item) => {
        if (huruf !== "all") {
          const awal = item.item_name.trim().charAt(0).toUpperCase();
          if (huruf === "#") {
            if (/^[A-Z]/.test(awal)) return false;
          } else if (awal !== huruf) {
            return false;
          }
        }
        if (!q) return true;
        return item.item_name.toLowerCase().includes(q);
      })
      .sort((a, b) => a.item_name.localeCompare(b.item_name, "id"));
  }, [items, cariItem, huruf]);

  const lowStock = items.filter(
    (item) => Number(item.current_stock) <= Number(item.min_stock_alert),
  );
  const pendingClaims = claims.filter((c) => c.status === "pending");

  function openClaim(item: InventoryItem) {
    setSelected(item);
    setQty("1");
    setNote("");
    setError(null);
  }

  async function submitClaim() {
    if (!selected) return;
    const quantity = Number(qty);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      setError("Jumlah harus lebih dari 0.");
      return;
    }
    // Penahan disetel sebelum awaits apa pun, jadi klik kedua yang datang
    // secepat apa pun berhenti di sini dan tidak membuat klaim ganda.
    if (klaimSedangJalan.current) return;
    klaimSedangJalan.current = true;
    setSubmitting(true);
    setError(null);
    try {
      const result = await createStockClaimAction({
        p_item_id: selected.id,
        p_quantity: quantity,
        p_note: note.trim() === "" ? undefined : note.trim(),
        p_order_id: claimOrderId || undefined,
      });
      setSubmitting(false);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setSelected(null);
      setClaimOrderId("");
      router.refresh();
    } finally {
      klaimSedangJalan.current = false;
    }
  }
  async function submitStockIn() {
    // Pengaman pertama: penahan disetel sebelum awaits apa pun, jadi klik
    // kedua yang datang secepat apa pun akan berhenti di sini.
    if (kirimSedangJalan.current) return;

    if (!inItem) {
      toast.gagal(
        "Barang belum dipilih",
        "Cari dan pilih barang lebih dulu pada kolom Barang di atas.",
      );
      return;
    }

    const quantity = Number(inQty);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      toast.gagal(
        "Jumlah stok masuk tidak valid",
        "Isi jumlah dengan angka lebih dari 0, contoh: 12",
      );
      return;
    }

    const cost = inCost.trim() === "" ? null : Number(inCost);
    if (cost !== null && (!Number.isFinite(cost) || cost < 0)) {
      toast.gagal(
        "Harga beli tidak valid",
        "Isi harga beli dengan angka nol atau lebih, contoh: 25000. Kosongkan bila tidak ada harga.",
      );
      return;
    }

    kirimSedangJalan.current = true;
    setSubmitting(true);
    setError(null);
    setSuccess(null);
    toast.info(
      "Mencatat stok masuk",
      `Menyimpan ${formatAngka(quantity)} ${inItem.unit} untuk ${inItem.item_name}.`,
    );

    try {
      const result = await recordStockInAction({
        p_item_id: inItem.id,
        p_quantity: quantity,
        p_unit_cost: cost ?? undefined,
        p_note: inNote.trim() === "" ? undefined : inNote.trim(),
      });

      if (!result.ok) {
        toast.gagal(
          "Stok masuk gagal dicatat",
          `Penyebab: ${result.message}. Data tidak tersimpan, periksa jumlah, harga, dan hak akses Anda lalu coba lagi.`,
        );
        return;
      }

      setInItemId("");
      setCariBarang("");
      setInQty("1");
      setInCost("");
      setInNote("");
      setSuccess(
        `Stok ${inItem.item_name} bertambah ${formatAngka(quantity)} ${inItem.unit}.`,
      );
      toast.sukses(
        "Stok masuk berhasil dicatat",
        `Saldo ${inItem.item_name} bertambah ${formatAngka(quantity)} ${inItem.unit}.`,
      );
      router.refresh();
    } catch (e) {
      toast.gagal(
        "Stok masuk gagal dikirim",
        `Penyebab: ${e instanceof Error ? e.message : "koneksi ke server terputus"}. Data tidak tersimpan, coba lagi.`,
      );
    } finally {
      kirimSedangJalan.current = false;
      setSubmitting(false);
    }
  }

  async function submitNewItem() {
    if (!newItemName.trim()) { setNewItemError("Nama item wajib diisi."); return; }
    setNewItemLoading(true);
    setNewItemError(null);
    try {
      const supabase = createClient();
      const pPrice = Number(newItemPurchasePrice) || 0;
      const pQty = Number(newItemPurchaseContentQty) || 1;
      const computedCost = pPrice > 0 && pQty > 0 ? Math.round((pPrice / pQty) * 100) / 100 : (Number(newItemCost) || null);

      const { error: rpcErr } = await (supabase as any).rpc("create_inventory_item", {
        p_item_name:            newItemName.trim(),
        p_unit:                 newItemUnit.trim() || "pcs",
        p_current_stock:        Number(newItemStock) || 0,
        p_min_stock_alert:      Number(newItemMin) || 0,
        p_unit_cost:            computedCost,
        p_purchase_unit:        newItemPurchaseUnit.trim() || "Pcs",
        p_purchase_price:       pPrice,
        p_purchase_content_qty: pQty,
      });
      if (rpcErr) { setNewItemError(rpcErr.message); return; }
      toast.sukses("Item baru berhasil ditambahkan", `${newItemName.trim()} ditambahkan ke inventaris.`);
      setNewItemOpen(false);
      setNewItemName("");
      setNewItemUnit("ml");
      setNewItemPurchaseUnit("Botol");
      setNewItemPurchasePrice("");
      setNewItemPurchaseContentQty("1000");
      setNewItemStock("1000");
      setNewItemMin("200");
      setNewItemCost("");
      router.refresh();
    } catch(e) {
      setNewItemError(e instanceof Error ? e.message : "Gagal menambahkan item.");
    } finally {
      setNewItemLoading(false);
    }
  }

  async function deleteItem() {
    if (!deleteTarget) return;
    setDeleteLoading(true);
    setDeleteError(null);
    try {
      const supabase = createClient();
      const { error: delErr } = await supabase
        .from("inventory_items")
        .delete()
        .eq("id", deleteTarget.id);
      if (delErr) {
        setDeleteError(delErr.message);
        return;
      }
      setDeleteTarget(null);
      toast.sukses("Item dihapus", `${deleteTarget.item_name} berhasil dihapus dari inventaris.`);
      router.refresh();
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : "Gagal menghapus item.");
    } finally {
      setDeleteLoading(false);
    }
  }

  async function confirmClaim(claim: StockClaim) {
    setBusyId(claim.id);
    setError(null);
    const supabase = createClient();
    const { error: rpcError } = await supabase.rpc("confirm_stock_claim", {
      p_claim_id: claim.id,
    });
    setBusyId(null);
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    router.refresh();
  }

  async function rejectClaim(claim: StockClaim) {
    const reason =
      typeof window !== "undefined"
        ? window.prompt(`Alasan menolak klaim ${claim.item_name}:`, "Stok tidak sesuai")
        : null;
    if (reason === null) return;
    setBusyId(claim.id);
    setError(null);
    const supabase = createClient();
    const { error: rpcError } = await supabase.rpc("reject_stock_claim", {
      p_claim_id: claim.id,
      p_reason: reason.trim() || "Ditolak",
    });
    setBusyId(null);
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    router.refresh();
  }

  return (
<div className="px-gutter py-4 pb-nav-plain lg:pb-8 flex flex-col gap-4">
      <div className="grid grid-cols-3 gap-2">
        <div className="clay-card p-3 flex flex-col items-center gap-0.5">
          <span className="font-headline-2 text-headline-2 text-text-primary">
            {items.length}
          </span>
          <span className="font-caption text-caption text-text-muted">Item</span>
        </div>
        <div className="clay-card p-3 flex flex-col items-center gap-0.5">
          <span className="font-headline-2 text-headline-2 text-danger-text">
            {lowStock.length}
          </span>
          <span className="font-caption text-caption text-text-muted">Stok Tipis</span>
        </div>
        <div className="clay-card p-3 flex flex-col items-center gap-0.5">
          <span className="font-headline-2 text-headline-2 text-warning-text">
            {pendingClaims.length}
          </span>
          <span className="font-caption text-caption text-text-muted">Klaim</span>
        </div>
      </div>

      <div className="flex gap-2 p-1 bg-surface-container-low rounded-2xl">
        {[
          { key: "items", label: "Daftar Item" },
          { key: "claims", label: "Riwayat Klaim" },
        ].map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => setTab(item.key as "items" | "claims")}
            className={`flex-1 min-h-11 rounded-xl font-body-bold text-body-bold flex items-center justify-center active:scale-95 transition-transform ${
              tab === item.key
                ? "bg-surface text-text-primary shadow-[0_1px_4px_rgba(15,23,42,0.08)]"
                : "text-text-secondary"
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {error ? (
        <div className="p-3 rounded-xl bg-danger-surface text-danger-text font-body text-body flex items-center gap-2">
          <Icon name="error" className="text-[20px]" />
          {error}
        </div>
      ) : null}

      {tab === "items" ? (
        items.length === 0 ? (
          <div className="clay-card p-8 flex flex-col items-center text-center gap-2">
            <Icon name="inventory_2" className="text-[40px] text-text-muted" />
            <p className="font-body text-body text-text-secondary">
              Belum ada item inventaris di cabang ini.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="clay-card p-3 flex flex-col gap-2">
              <div className="relative flex items-center">
                <div className="absolute left-3 flex items-center pointer-events-none text-text-muted">
                  <Icon name="search" className="text-[18px]" />
                </div>
                <input
                  value={cariItem}
                  onChange={(e) => setCariItem(e.target.value)}
                  type="search"
                  placeholder="Cari nama barang..."
                  className="w-full h-11 pl-10 pr-3 rounded-xl bg-surface-container-low font-body text-body text-text-primary outline-none focus:ring-2 focus:ring-brand-400"
                />
              </div>
              <div className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1">
                {["all", ..."ABCDEFGHIJKLMNOPQRSTUVWXYZ#".split("")].map((h) => (
                  <button
                    key={h}
                    type="button"
                    onClick={() => setHuruf(h)}
                    className={`min-w-9 h-9 shrink-0 rounded-lg font-caption text-caption flex items-center justify-center active:scale-95 transition-transform ${
                      huruf === h
                        ? "bg-brand-600 text-white"
                        : "bg-surface-container-low text-text-secondary"
                    }`}
                  >
                    {h === "all" ? "All" : h}
                  </button>
                ))}
              </div>
              <p className="font-micro-badge text-micro-badge text-text-muted">
                {itemsTerfilter.length} dari {items.length} barang
              </p>
              {/* Aksi stok masuk dan opname diletakkan tepat di bawah pencarian
                  dan filter huruf, karena keduanya dipakai setelah pengguna
                  decides barang yang dicari. */}
              {canManage ? (
                <div className="flex gap-2 pt-1 flex-wrap">
                  <button
                    type="button"
                    onClick={() => {
                      setInOpen(true);
                    }}
                    className="flex-1 min-h-11 rounded-xl bg-success-surface text-success-text font-caption text-caption flex items-center justify-center gap-1.5 active:scale-95 transition-transform"
                  >
                    <Icon name="move_to_inbox" className="text-[18px]" />
                    Tambah Stok Masuk
                  </button>
                  <button
                    type="button"
                    onClick={() => setNewItemOpen(true)}
                    className="flex-1 min-h-11 rounded-xl bg-brand-50 text-brand-700 font-caption text-caption flex items-center justify-center gap-1.5 active:scale-95 transition-transform"
                  >
                    <Icon name="add_circle" className="text-[18px]" />
                    Item Baru
                  </button>
                  <a
                    href="/stok/opname"
                    className="flex-1 min-h-11 rounded-xl bg-surface-container text-text-secondary font-caption text-caption flex items-center justify-center gap-1.5 active:scale-95 transition-transform"
                  >
                    <Icon name="fact_check" className="text-[18px]" />
                    Opname
                  </a>
                </div>
              ) : null}
            </div>

            {itemsTerfilter.length === 0 ? (
              <div className="clay-card p-6 flex flex-col items-center text-center gap-2">
                <Icon name="inventory_2" className="text-[32px] text-text-muted" />
                <p className="font-body text-body text-text-secondary">
                  Tidak ada barang yang cocok dengan filter ini.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2 lg:grid-cols-3 xl:grid-cols-4">
                {itemsTerfilter.map((item) => {
              const stock = Number(item.current_stock);
              const min = Number(item.min_stock_alert) || 1;
              const ratio = Math.max(
                0,
                Math.min(100, Math.round((stock / (min * 2)) * 100)),
              );
              const low = stock <= min;
              return (
                <div
                  key={item.id}
                  className="clay-card p-3 flex flex-col gap-2 min-w-0"
                >
                  <div className="flex items-start justify-between gap-1">
                    <div
                      className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                        low
                          ? "bg-danger-surface text-danger-text"
                          : "bg-brand-50 text-brand-600"
                      }`}
                    >
                      <Icon name="inventory_2" className="text-[18px]" />
                    </div>
                    <div className="flex flex-col items-end shrink-0">
                      <span
                        className={`font-headline-3 text-headline-3 ${
                          low ? "text-danger-text" : "text-text-primary"
                        }`}
                      >
                        {formatAngka(stock)}
                      </span>
                      <span className="font-micro-badge text-micro-badge text-text-muted">
                        {item.unit}
                      </span>
                    </div>
                  </div>
                  <span className="font-body-bold text-body-bold text-text-primary leading-tight">
                    {item.item_name}
                  </span>
                  {item.unit_cost !== null && item.unit_cost !== undefined ? (
                    <div className="flex flex-col gap-0.5">
                      <span className="font-caption text-caption text-brand-600 font-semibold">
                        Rp {formatAngka(Number(item.unit_cost))} / {item.unit}
                      </span>
                      {item.purchase_unit ? (
                        <span className="font-micro-badge text-[10px] text-text-muted">
                          Beli: {item.purchase_unit} @ {formatAngka(Number(item.purchase_content_qty || 1))} {item.unit}
                        </span>
                      ) : null}
                    </div>
                  ) : null}
                  <div className="w-full bg-surface-container rounded-full h-1.5 overflow-hidden">
                    <div
                      className={`h-1.5 rounded-full ${
                        low ? "bg-danger-base" : "bg-brand-500"
                      }`}
                      style={{ width: `${ratio}%` }}
                    />
                  </div>
                  <span
                    className={`font-micro-badge text-micro-badge ${
                      low ? "text-danger-text" : "text-text-muted"
                    }`}
                  >
                    Min. {formatAngka(min)} {item.unit}
                    {low ? " • Perlu restock" : ""}
                  </span>
                  <div className="flex gap-1.5 w-full mt-0.5">
                    <button
                      type="button"
                      onClick={() => openClaim(item)}
                      className="flex-1 min-h-10 rounded-xl bg-brand-50 text-brand-700 font-caption text-caption flex items-center justify-center gap-1 active:scale-95 transition-transform"
                    >
                      <Icon name="shopping_cart_checkout" className="text-[15px]" />
                      Klaim
                    </button>
                    {canManage ? (
                      <button
                        type="button"
                        onClick={() => openEditItem(item)}
                        className="px-2.5 min-h-10 rounded-xl bg-surface-container text-text-primary font-caption text-caption flex items-center justify-center gap-1 active:scale-95 transition-transform"
                        title="Edit Item"
                      >
                        <Icon name="edit" className="text-[15px]" />
                      </button>
                    ) : null}
                    {canManage ? (
                      <button
                        type="button"
                        onClick={() => { setDeleteTarget(item); setDeleteError(null); }}
                        className="px-2.5 min-h-10 rounded-xl bg-danger-surface text-danger-text font-caption text-caption flex items-center justify-center gap-1 active:scale-95 transition-transform"
                        title="Hapus Item"
                      >
                        <Icon name="delete" className="text-[15px]" />
                      </button>
                    ) : null}
                  </div>
                </div>
              );
            })}
              </div>
            )}
          </div>
        )
      ) : claims.length === 0 ? (
        <div className="clay-card p-8 flex flex-col items-center text-center gap-2">
          <Icon name="receipt_long" className="text-[40px] text-text-muted" />
          <p className="font-body text-body text-text-secondary">
            Belum ada riwayat klaim stok.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {claims.map((claim) => {
            const meta = CLAIM_STATUS[claim.status] ?? CLAIM_STATUS.pending;
            const busy = busyId === claim.id;
            const isExpanded = expandedClaimId === claim.id;
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
                      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl mt-0.5 ${meta.cls}`}
                    >
                      <Icon name={meta.icon} className="text-[18px]" />
                    </span>
                    <div className="flex flex-col min-w-0">
                      <span className="font-body-bold text-body-bold text-text-primary truncate">
                        {claim.item_name}
                      </span>
                      <span className="font-caption text-caption text-text-muted">
                        Jumlah: <span className="font-semibold text-text-primary">{formatAngka(claim.quantity)} {claim.unit}</span> • Oleh {claim.claimed_by_name}
                      </span>
                      {claim.order_label && (
                        <span className="inline-block w-fit text-[11px] font-medium text-brand-700 bg-brand-50 px-2 py-0.5 rounded-full border border-brand-200 mt-0.5">
                          Tautan: {claim.order_label}
                        </span>
                      )}
                      <span className="font-caption text-caption text-text-secondary mt-0.5">
                        {formatDateWib(claim.created_at)} pukul {formatTimeWib(claim.created_at)} WIB
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
                        <span className="text-[11px] text-text-muted">Barang Diminta</span>
                        <span className="font-bold text-text-primary mt-0.5">{claim.item_name}</span>
                      </div>
                      <div className="p-2.5 rounded-xl bg-surface-container-low border border-border-subtle/50 flex flex-col">
                        <span className="text-[11px] text-text-muted">Jumlah Pengambilan</span>
                        <span className="font-bold text-brand-600 mt-0.5">
                          {formatAngka(claim.quantity)} {claim.unit}
                        </span>
                      </div>
                      <div className="p-2.5 rounded-xl bg-surface-container-low border border-border-subtle/50 flex flex-col">
                        <span className="text-[11px] text-text-muted">Diajukan Oleh</span>
                        <span className="font-bold text-text-primary mt-0.5">{claim.claimed_by_name}</span>
                      </div>
                      <div className="p-2.5 rounded-xl bg-surface-container-low border border-border-subtle/50 flex flex-col">
                        <span className="text-[11px] text-text-muted">Status Pengajuan</span>
                        <span className={`font-bold mt-0.5 ${meta.cls.split(" ")[1]}`}>
                          {meta.label}
                        </span>
                      </div>
                    </div>

                    <div className="p-2.5 rounded-xl bg-surface-container-low/70 flex flex-col gap-1 text-[11px]">
                      <div className="flex items-center justify-between">
                        <span className="text-text-muted">Waktu Pengajuan:</span>
                        <span className="font-medium text-text-primary">
                          {formatDateWib(claim.created_at)}, {formatTimeWib(claim.created_at)} WIB
                        </span>
                      </div>
                      {claim.confirmed_at && (
                        <div className="flex items-center justify-between">
                          <span className="text-text-muted">Waktu Verifikasi:</span>
                          <span className="font-medium text-text-primary">
                            {formatDateWib(claim.confirmed_at)}, {formatTimeWib(claim.confirmed_at)} WIB
                          </span>
                        </div>
                      )}
                      {claim.confirmed_by_name && (
                        <div className="flex items-center justify-between">
                          <span className="text-text-muted">Petugas Verifikasi:</span>
                          <span className="font-medium text-text-primary">
                            {claim.confirmed_by_name}
                          </span>
                        </div>
                      )}
                      <div className="pt-1 border-t border-border-subtle/40 flex flex-col gap-0.5">
                        <span className="text-text-muted">Tautan Order / Keperluan:</span>
                        <span className="text-text-primary font-medium">
                          {claim.order_label ?? "Operasional Bengkel / Umum"}
                        </span>
                      </div>
                      <div className="pt-1 border-t border-border-subtle/40 flex flex-col gap-0.5">
                        <span className="text-text-muted">Catatan Keperluan:</span>
                        <span className="text-text-primary italic">
                          {claim.note ? `"${claim.note}"` : "Tidak ada catatan keperluan khusus."}
                        </span>
                      </div>
                    </div>

                    {canManage && claim.status === "pending" ? (
                      <div className="flex gap-2 pt-1">
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => confirmClaim(claim)}
                          className="flex-1 py-2.5 rounded-xl bg-success-surface text-success-text font-caption text-caption flex items-center justify-center gap-1 active:scale-95 transition-transform disabled:opacity-60"
                        >
                          <Icon name="check" className="text-[18px]" />
                          Setujui Pengambilan
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => rejectClaim(claim)}
                          className="flex-1 py-2.5 rounded-xl bg-danger-surface text-danger-text font-caption text-caption flex items-center justify-center gap-1 active:scale-95 transition-transform disabled:opacity-60"
                        >
                          <Icon name="close" className="text-[18px]" />
                          Tolak
                        </button>
                      </div>
                    ) : null}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {selected ? (
        <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/40 backdrop-blur-sm">
          <div className="w-full max-w-[480px] bg-surface rounded-t-[28px] p-5 pb-safe flex flex-col gap-4 shadow-[0_-8px_30px_rgba(0,0,0,0.15)]">
            <div className="flex items-center justify-between">
              <h3 className="font-headline-2 text-headline-2 text-text-primary">
                Klaim Stok
              </h3>
              <button
                type="button"
                onClick={() => setSelected(null)}
                aria-label="Tutup"
                className="w-9 h-9 rounded-xl bg-surface-container-low flex items-center justify-center text-text-secondary active:scale-95"
              >
                <Icon name="close" className="text-[20px]" />
              </button>
            </div>
            <div className="p-3 rounded-2xl bg-surface-container-low flex items-center justify-between">
              <span className="font-body-bold text-body-bold text-text-primary">
                {selected.item_name}
              </span>
              <span className="font-caption text-caption text-text-secondary">
                Sisa {formatAngka(selected.current_stock)} {selected.unit}
              </span>
            </div>
            <label className="flex flex-col gap-1">
              <span className="font-caption text-caption text-text-muted">
                Jumlah diambil ({selected.unit})
              </span>
              <input
                value={qty}
                onChange={(e) => setQty(e.target.value)}
                inputMode="decimal"
                className="h-12 px-3 rounded-xl bg-surface-container-low font-body text-body text-text-primary outline-none focus:ring-2 focus:ring-brand-400"
              />
            </label>
            {activeOrders && activeOrders.length > 0 && (
              <label className="flex flex-col gap-1">
                <span className="font-caption text-caption text-text-muted">
                  Keperluan / Tautkan ke Order (opsional)
                </span>
                <select
                  value={claimOrderId}
                  onChange={(e) => setClaimOrderId(e.target.value)}
                  className="h-12 px-3 rounded-xl bg-surface-container-low font-body text-body text-text-primary outline-none focus:ring-2 focus:ring-brand-400"
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
              </label>
            )}
            <label className="flex flex-col gap-1">
              <span className="font-caption text-caption text-text-muted">
                Catatan (opsional)
              </span>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={2}
                placeholder="Untuk order / keperluan..."
                className="p-3 rounded-xl bg-surface-container-low font-body text-body text-text-primary outline-none focus:ring-2 focus:ring-brand-400 resize-none"
              />
            </label>
            {error ? (
              <p className="font-caption text-caption text-danger-text">
                {error}
              </p>
            ) : null}
            <button
              type="button"
              disabled={submitting}
              onClick={submitClaim}
              className="w-full py-4 lg:py-2.5 rounded-2xl lg:rounded-xl bg-primary text-white font-body-bold text-body-bold flex items-center justify-center gap-2 active:scale-95 transition-transform disabled:opacity-60"
            >
              <Icon name={submitting ? "hourglass_top" : "send"} className="text-[22px]" />
              {submitting ? "Mengirim..." : "Ajukan Klaim"}
            </button>
          </div>
        </div>
      ) : null}

      {deleteTarget ? (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 backdrop-blur-sm px-4">
          <div className="w-full max-w-sm bg-surface rounded-[28px] p-6 flex flex-col gap-4 shadow-[0_8px_40px_rgba(0,0,0,0.2)]">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-2xl bg-danger-surface flex items-center justify-center shrink-0">
                <Icon name="delete_forever" className="text-[24px] text-danger-text" />
              </div>
              <div>
                <h3 className="font-headline-2 text-headline-2 text-text-primary">Hapus Item</h3>
                <p className="font-caption text-caption text-text-muted">Tindakan ini tidak bisa dibatalkan</p>
              </div>
            </div>
            <p className="font-body text-body text-text-secondary">
              Yakin ingin menghapus <span className="font-body-bold text-body-bold text-text-primary">{deleteTarget.item_name}</span>? Data tidak bisa dikembalikan.
            </p>
            {deleteError ? (
              <p className="font-caption text-caption text-danger-text bg-danger-surface rounded-xl p-2.5">{deleteError}</p>
            ) : null}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                disabled={deleteLoading}
                className="flex-1 py-3 rounded-2xl bg-surface-container text-text-secondary font-body-bold text-body-bold active:scale-95 transition-transform disabled:opacity-60"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={deleteItem}
                disabled={deleteLoading}
                className="flex-1 py-3 rounded-2xl bg-danger-base text-white font-body-bold text-body-bold flex items-center justify-center gap-2 active:scale-95 transition-transform disabled:opacity-60"
              >
                {deleteLoading ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <Icon name="delete" className="text-[18px]" />}
                {deleteLoading ? "Menghapus..." : "Hapus"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* ─── Modal Stok Masuk ─── */}
      {canManage ? (
        <Modal
          open={inOpen}
          onClose={() => {
            setInOpen(false);
            setInItemId("");
            setCariBarang("");
            setInQty("1");
            setInCost("");
            setInNote("");
          }}
          title="Tambah Stok Masuk"
        >
          <label className="flex flex-col gap-1">
            <span className="font-caption text-caption text-text-muted">
              Cari barang
            </span>
            <input
              value={cariBarang}
              onChange={(e) => setCariBarang(e.target.value)}
              type="search"
              placeholder="Ketik nama obat atau bahan..."
              className="h-11 px-3 rounded-xl bg-surface-container-low font-body text-body text-text-primary outline-none focus:ring-2 focus:ring-brand-400"
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="font-caption text-caption text-text-muted">
              Barang
            </span>
            <select
              value={inItemId}
              onChange={(e) => setInItemId(e.target.value)}
              size={barangTersaring.length > 6 ? 6 : undefined}
              className="h-12 px-3 rounded-xl bg-surface-container-low font-body text-body text-text-primary outline-none focus:ring-2 focus:ring-brand-400"
            >
              <option value="">Pilih barang...</option>
              {barangTersaring.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.item_name} (sisa {formatAngka(item.current_stock)} {item.unit})
                </option>
              ))}
            </select>
            {cariBarang.trim() !== "" && barangTersaring.length === 0 ? (
              <p className="font-micro-badge text-micro-badge text-danger-text">
                Tidak ada barang bernama {cariBarang.trim()}. Periksa ejaan atau hapus kata kunci.
              </p>
            ) : (
              <p className="font-micro-badge text-micro-badge text-text-muted">
                {barangTersaring.length} dari {items.length} barang ditampilkan
              </p>
            )}
          </label>

          {inItem ? (
            <>
              <div className="grid grid-cols-2 gap-2">
                <label className="flex flex-col gap-1">
                  <span className="font-micro-badge text-micro-badge text-text-muted">
                    Jumlah ({inItem.unit})
                  </span>
                  <input
                    value={inQty}
                    onChange={(e) => setInQty(e.target.value)}
                    inputMode="decimal"
                    className="h-11 px-3 rounded-xl bg-surface-container-low font-body text-body text-text-primary outline-none focus:ring-2 focus:ring-brand-400"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="font-micro-badge text-micro-badge text-text-muted">
                    Harga beli / {inItem.unit}
                  </span>
                  <input
                    value={inCost}
                    onChange={(e) => setInCost(e.target.value)}
                    inputMode="numeric"
                    placeholder="opsional"
                    className="h-11 px-3 rounded-xl bg-surface-container-low font-body-mono text-body text-text-primary outline-none focus:ring-2 focus:ring-brand-400"
                  />
                </label>
              </div>
              <input
                value={inNote}
                onChange={(e) => setInNote(e.target.value)}
                placeholder="Nama supplier / nomor nota"
                className="h-11 px-3 rounded-xl bg-surface-container-low font-body text-body text-text-primary outline-none focus:ring-2 focus:ring-brand-400"
              />
              {success ? (
                <p className="font-caption text-caption text-success-text">
                  {success}
                </p>
              ) : null}
              <SyaratBelumTerpenuhi
                syarat={[
                  {
                    terpenuhi: Boolean(inItem),
                    label: "Pilih barang lebih dulu pada kolom Barang",
                  },
                  {
                    terpenuhi: Number(inQty) > 0,
                    label: "Isi jumlah lebih dari 0",
                  },
                  {
                    terpenuhi:
                      inCost.trim() === "" ||
                      (Number.isFinite(Number(inCost)) && Number(inCost) >= 0),
                    label: "Harga beli harus angka nol atau lebih, boleh dikosongkan",
                  },
                ]}
                judul="Sisa langkah sebelum stok masuk bisa dicatat"
              />

              <button
                type="button"
                disabled={submitting}
                onClick={submitStockIn}
                className="w-full py-3 rounded-xl bg-success-base text-white font-body-bold text-body-bold flex items-center justify-center gap-2 active:scale-95 transition-transform disabled:opacity-60"
              >
                <Icon name={submitting ? "hourglass_top" : "inventory_2"} className="text-[20px]" />
                {submitting ? "Mencatat..." : "Catat Stok Masuk"}
              </button>
            </>
          ) : null}
        </Modal>
      ) : null}

      {/* ─── Modal Tambah Item Stok Baru ─── */}
      {newItemOpen && (
        <>
          <div className="fixed inset-0 z-[60] bg-black/50" onClick={() => setNewItemOpen(false)} />
          <div className="fixed inset-x-4 bottom-4 z-[61] bg-surface rounded-2xl p-5 shadow-xl max-w-md mx-auto flex flex-col gap-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="font-headline-2 text-headline-2 text-text-primary">Tambah Item Stok Baru</h3>
              <button type="button" onClick={() => setNewItemOpen(false)} className="w-9 h-9 rounded-xl bg-surface-container-low flex items-center justify-center text-text-secondary active:scale-95">
                <Icon name="close" className="text-[20px]" />
              </button>
            </div>
            <div className="flex flex-col gap-3">
              <label className="flex flex-col gap-1">
                <span className="font-caption text-caption text-text-secondary">Nama Item <span className="text-danger-text">*</span></span>
                <input value={newItemName} onChange={(e) => setNewItemName(e.target.value)}
                  placeholder="contoh: Nano Ceramic 10H / Cairan A" autoFocus
                  className="h-11 px-3 rounded-xl bg-surface-container-low font-body text-body text-text-primary outline-none focus:ring-2 focus:ring-brand-400" />
              </label>

              {/* Bagian Satuan Pemakaian Workshop */}
              <div className="grid grid-cols-2 gap-3">
                <label className="flex flex-col gap-1">
                  <span className="font-caption text-caption text-text-secondary">Satuan Pakai (Workshop) <span className="text-danger-text">*</span></span>
                  <input value={newItemUnit} onChange={(e) => setNewItemUnit(e.target.value)}
                    placeholder="ml / pcs / gram"
                    className="h-11 px-3 rounded-xl bg-surface-container-low font-body text-body text-text-primary outline-none focus:ring-2 focus:ring-brand-400" />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="font-caption text-caption text-text-secondary">Satuan Beli (Supplier)</span>
                  <input value={newItemPurchaseUnit} onChange={(e) => setNewItemPurchaseUnit(e.target.value)}
                    placeholder="Botol / Jerigen / Pcs"
                    className="h-11 px-3 rounded-xl bg-surface-container-low font-body text-body text-text-primary outline-none focus:ring-2 focus:ring-brand-400" />
                </label>
              </div>

              {/* Matematika Belanja & Kemasan */}
              <div className="p-3 rounded-xl bg-brand-50/60 border border-brand-100 flex flex-col gap-2">
                <span className="font-caption text-caption font-semibold text-brand-900">
                  Matematika Kemasan Belanja
                </span>
                <div className="grid grid-cols-2 gap-2">
                  <label className="flex flex-col gap-1">
                    <span className="font-micro-badge text-micro-badge text-text-secondary">Harga Beli Kemasan (Rp)</span>
                    <input value={newItemPurchasePrice} onChange={(e) => setNewItemPurchasePrice(e.target.value.replace(/\D/g,""))}
                      placeholder="cth: 100000" inputMode="numeric"
                      className="h-10 px-2.5 rounded-lg bg-surface font-body text-body text-text-primary outline-none focus:ring-2 focus:ring-brand-400" />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="font-micro-badge text-micro-badge text-text-secondary">Isi Bersih ({newItemUnit || "satuan"})</span>
                    <input value={newItemPurchaseContentQty} onChange={(e) => setNewItemPurchaseContentQty(e.target.value.replace(/\D/g,""))}
                      placeholder="cth: 800" inputMode="numeric"
                      className="h-10 px-2.5 rounded-lg bg-surface font-body text-body text-text-primary outline-none focus:ring-2 focus:ring-brand-400" />
                  </label>
                </div>

                {previewUnitCost > 0 ? (
                  <div className="flex items-center justify-between pt-1 border-t border-brand-100 text-xs text-brand-800">
                    <span>Biaya per {newItemUnit || "unit"}:</span>
                    <span className="font-bold text-brand-900">Rp {previewUnitCost.toLocaleString("id-ID")} / {newItemUnit || "unit"}</span>
                  </div>
                ) : null}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <label className="flex flex-col gap-1">
                  <span className="font-caption text-caption text-text-secondary">Stok Awal ({newItemUnit})</span>
                  <input value={newItemStock} onChange={(e) => setNewItemStock(e.target.value.replace(/\D/g,""))}
                    inputMode="numeric"
                    className="h-11 px-3 rounded-xl bg-surface-container-low font-body text-body text-text-primary outline-none focus:ring-2 focus:ring-brand-400" />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="font-caption text-caption text-text-secondary">Min. Alert ({newItemUnit})</span>
                  <input value={newItemMin} onChange={(e) => setNewItemMin(e.target.value.replace(/\D/g,""))}
                    inputMode="numeric"
                    className="h-11 px-3 rounded-xl bg-surface-container-low font-body text-body text-text-primary outline-none focus:ring-2 focus:ring-brand-400" />
                </label>
              </div>
            </div>
            {newItemError && <p className="font-caption text-caption text-danger-text">{newItemError}</p>}
            <div className="flex gap-3">
              <button type="button" onClick={() => setNewItemOpen(false)}
                className="flex-1 py-3 rounded-xl bg-surface-container-low text-text-secondary font-body-bold text-body-bold active:scale-95">
                Batal
              </button>
              <button type="button" onClick={submitNewItem} disabled={newItemLoading}
                className="flex-1 py-3 rounded-xl bg-primary text-white font-body-bold text-body-bold active:scale-95 disabled:opacity-60 flex items-center justify-center gap-2">
                {newItemLoading ? <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <Icon name="add_circle" className="text-[20px]" />}
                {newItemLoading ? "Menyimpan..." : "Tambah Item"}
              </button>
            </div>
          </div>
        </>
      )}

      {/* Modal Edit Item */}
      {editItemTarget && (
        <>
          <div className="fixed inset-0 z-modal-backdrop bg-scrim/40 backdrop-blur-sm" onClick={() => setEditItemTarget(null)} />
          <div className="fixed inset-x-4 top-1/2 -translate-y-1/2 z-modal max-w-lg mx-auto bg-surface rounded-2xl p-6 shadow-2xl border border-white/80 flex flex-col gap-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="p-2 rounded-xl bg-brand-50 text-brand-600">
                  <Icon name="edit" className="text-[20px]" />
                </span>
                <span className="font-headline-3 text-headline-3 text-text-primary">Edit Item Stok</span>
              </div>
              <button type="button" onClick={() => setEditItemTarget(null)} className="p-1.5 rounded-lg text-text-muted hover:bg-surface-container">
                <Icon name="close" className="text-[20px]" />
              </button>
            </div>

            <div className="flex flex-col gap-3">
              <label className="flex flex-col gap-1">
                <span className="font-caption text-caption text-text-secondary">Nama Item *</span>
                <input value={editItemName} onChange={(e) => setEditItemName(e.target.value)}
                  placeholder="Contoh: Shampoo Carwash"
                  className="h-11 px-3 rounded-xl bg-surface-container-low font-body text-body text-text-primary outline-none focus:ring-2 focus:ring-brand-400" />
              </label>

              <div className="grid grid-cols-2 gap-3">
                <label className="flex flex-col gap-1">
                  <span className="font-caption text-caption text-text-secondary">Satuan Pakai Workshop *</span>
                  <input value={editItemUnit} onChange={(e) => setEditItemUnit(e.target.value)}
                    placeholder="ml, pcs, gram..."
                    className="h-11 px-3 rounded-xl bg-surface-container-low font-body text-body text-text-primary outline-none focus:ring-2 focus:ring-brand-400" />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="font-caption text-caption text-text-secondary">Batas Min. Alert</span>
                  <input value={editItemMin} onChange={(e) => setEditItemMin(e.target.value.replace(/\D/g,""))}
                    inputMode="numeric"
                    className="h-11 px-3 rounded-xl bg-surface-container-low font-body text-body text-text-primary outline-none focus:ring-2 focus:ring-brand-400" />
                </label>
              </div>

              {/* Kemasan Belanja & Matematika HPP */}
              <div className="p-3.5 rounded-xl bg-brand-50/60 border border-brand-100 flex flex-col gap-2.5">
                <span className="text-xs font-bold text-brand-900 flex items-center gap-1.5">
                  <Icon name="shopping_bag" className="text-[16px] text-brand-600" />
                  Kemasan Saat Belanja (Update HPP Modal)
                </span>
                <div className="grid grid-cols-3 gap-2">
                  <label className="flex flex-col gap-0.5">
                    <span className="text-[10px] text-text-secondary">Satuan Beli</span>
                    <input value={editItemPurchaseUnit} onChange={(e) => setEditItemPurchaseUnit(e.target.value)}
                      placeholder="Jerigen, Dus..."
                      className="h-10 px-2.5 rounded-lg bg-surface text-xs text-text-primary outline-none focus:ring-2 focus:ring-brand-400" />
                  </label>
                  <label className="flex flex-col gap-0.5">
                    <span className="text-[10px] text-text-secondary">Harga per Kemasan</span>
                    <input value={editItemPurchasePrice} onChange={(e) => setEditItemPurchasePrice(e.target.value.replace(/\D/g,""))}
                      inputMode="numeric" placeholder="250000"
                      className="h-10 px-2.5 rounded-lg bg-surface text-xs text-text-primary outline-none focus:ring-2 focus:ring-brand-400" />
                  </label>
                  <label className="flex flex-col gap-0.5">
                    <span className="text-[10px] text-text-secondary">Isi ({editItemUnit || "satuan"})</span>
                    <input value={editItemPurchaseContentQty} onChange={(e) => setEditItemPurchaseContentQty(e.target.value.replace(/\D/g,""))}
                      inputMode="numeric" placeholder="5000"
                      className="h-10 px-2.5 rounded-lg bg-surface text-xs text-text-primary outline-none focus:ring-2 focus:ring-brand-400" />
                  </label>
                </div>
                {editPreviewUnitCost > 0 ? (
                  <div className="flex items-center justify-between text-xs pt-1 border-t border-brand-100">
                    <span className="text-text-muted">Biaya Modal Terhitung:</span>
                    <span className="font-bold text-brand-900">Rp {editPreviewUnitCost.toLocaleString("id-ID")} / {editItemUnit || "unit"}</span>
                  </div>
                ) : null}
              </div>

              {/* Koreksi Stok Saat Ini */}
              <label className="flex flex-col gap-1">
                <span className="font-caption text-caption text-text-secondary">Stok Fisik Saat Ini ({editItemUnit})</span>
                <input value={editItemStock} onChange={(e) => setEditItemStock(e.target.value.replace(/\D/g,""))}
                  inputMode="numeric"
                  placeholder="Saldo stok saat ini"
                  className="h-11 px-3 rounded-xl bg-surface-container-low font-body text-body text-text-primary outline-none focus:ring-2 focus:ring-brand-400" />
                <span className="text-[10px] text-text-muted">Bisa dikosongkan jika tidak ingin mengubah saldo stok.</span>
              </label>
            </div>

            {editItemError && <p className="font-caption text-caption text-danger-text">{editItemError}</p>}

            <div className="flex gap-3">
              <button type="button" onClick={() => setEditItemTarget(null)}
                className="flex-1 py-3 rounded-xl bg-surface-container-low text-text-secondary font-body-bold text-body-bold active:scale-95">
                Batal
              </button>
              <button type="button" onClick={submitEditItem} disabled={editItemLoading}
                className="flex-1 py-3 rounded-xl bg-primary text-white font-body-bold text-body-bold active:scale-95 disabled:opacity-60 flex items-center justify-center gap-2">
                {editItemLoading ? <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <Icon name="check_circle" className="text-[20px]" />}
                {editItemLoading ? "Menyimpan..." : "Simpan Perubahan"}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
