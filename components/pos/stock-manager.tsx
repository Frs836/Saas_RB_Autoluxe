"use client";

import { useMemo, useRef, useState } from "react";
import { useToast } from "@/components/toast";
import { SyaratBelumTerpenuhi } from "@/components/submit-requirements";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { formatTimeWib, formatDateWib } from "@/lib/format";
import { formatAngka } from "@/lib/pos";

export type InventoryItem = {
  id: string;
  item_name: string;
  current_stock: number;
  unit: string;
  min_stock_alert: number;
};

export type StockClaim = {
  id: string;
  item_id: string;
  item_name: string;
  quantity: number;
  unit: string;
  note: string | null;
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
  canManage,
}: {
  items: InventoryItem[];
  claims: StockClaim[];
  canManage: boolean;
}) {
  const router = useRouter();

const items = initialItems;
const claims = initialClaims;
const [tab, setTab] = useState<"items" | "claims">("items");
  const toast = useToast();
  const [selected, setSelected] = useState<InventoryItem | null>(null);
  const [qty, setQty] = useState("1");
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
  // Penahan sinkron untuk 防 double-klik. State submitting baru berlaku
  // setelah React selesai merender, jadi dua klik cepat bisa sama-sama lolos
  // sebelum tombol terlihat mati.
  const kirimSedangJalan = useRef(false);
  const [inQty, setInQty] = useState("1");
  const [inCost, setInCost] = useState("");
  const [inNote, setInNote] = useState("");

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
    setSubmitting(true);
    setError(null);
    const supabase = createClient();
    const { error: rpcError } = await supabase.rpc("create_stock_claim", {
      p_item_id: selected.id,
      p_quantity: quantity,
      p_note: note.trim() === "" ? null : note.trim(),
    });
    setSubmitting(false);
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    setSelected(null);
    router.refresh();
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
      const supabase = createClient();
      const { error: rpcError } = await supabase.rpc("record_stock_in", {
        p_item_id: inItem.id,
        p_quantity: quantity,
        p_unit_cost: cost,
        p_note: inNote.trim() === "" ? null : inNote.trim(),
      });

      if (rpcError) {
        toast.gagal(
          "Stok masuk gagal dicatat",
          `Penyebab: ${rpcError.message}. Data tidak tersimpan, periksa jumlah, harga, dan hak akses Anda lalu coba lagi.`,
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
    <div className="px-gutter py-4 pb-28 flex flex-col gap-4">
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
          <span className="material-symbols-outlined text-[20px]">error</span>
          {error}
        </div>
      ) : null}

      {tab === "items" ? (
        items.length === 0 ? (
          <div className="clay-card p-8 flex flex-col items-center text-center gap-2">
            <span className="material-symbols-outlined text-[40px] text-text-muted">
              inventory_2
            </span>
            <p className="font-body text-body text-text-secondary">
              Belum ada item inventaris di cabang ini.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {items.map((item) => {
              const stock = Number(item.current_stock);
              const min = Number(item.min_stock_alert) || 1;
              const ratio = Math.max(
                0,
                Math.min(100, Math.round((stock / (min * 2)) * 100)),
              );
              const low = stock <= min;
              return (
                <div key={item.id} className="clay-card p-4 flex flex-col gap-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <div
                        className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                          low
                            ? "bg-danger-surface text-danger-text"
                            : "bg-brand-50 text-brand-600"
                        }`}
                      >
                        <span className="material-symbols-outlined text-[22px]">
                          inventory_2
                        </span>
                      </div>
                      <div className="flex flex-col min-w-0">
                        <span className="font-body-bold text-body-bold text-text-primary truncate">
                          {item.item_name}
                        </span>
                        <span className="font-caption text-caption text-text-muted">
                          Min. {formatAngka(min)} {item.unit}
                        </span>
                      </div>
                    </div>
                    <div className="flex flex-col items-end shrink-0">
                      <span
                        className={`font-headline-2 text-headline-2 ${
                          low ? "text-danger-text" : "text-text-primary"
                        }`}
                      >
                        {formatAngka(stock)}
                      </span>
                      <span className="font-caption text-caption text-text-muted">
                        {item.unit}
                      </span>
                    </div>
                  </div>
                  <div className="w-full bg-surface-container rounded-full h-1.5 overflow-hidden">
                    <div
                      className={`h-1.5 rounded-full ${
                        low ? "bg-danger-base" : "bg-brand-500"
                      }`}
                      style={{ width: `${ratio}%` }}
                    />
                  </div>
                  <div className="flex items-center justify-between pt-1">
                    {low ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-danger-surface text-danger-text font-caption text-caption">
                        <span className="material-symbols-outlined text-[13px]">
                          warning
                        </span>
                        Perlu Restock
                      </span>
                    ) : (
                      <span className="font-caption text-caption text-text-muted">
                        Stok tersedia
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => openClaim(item)}
                      className="px-3 min-h-11 rounded-xl bg-brand-50 text-brand-700 font-caption text-caption flex items-center gap-1 active:scale-95 transition-transform"
                    >
                      <span className="material-symbols-outlined text-[16px]">
                        shopping_cart_checkout
                      </span>
                      Klaim Ambil
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )
      ) : claims.length === 0 ? (
        <div className="clay-card p-8 flex flex-col items-center text-center gap-2">
          <span className="material-symbols-outlined text-[40px] text-text-muted">
            receipt_long
          </span>
          <p className="font-body text-body text-text-secondary">
            Belum ada riwayat klaim stok.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {claims.map((claim) => {
            const meta = CLAIM_STATUS[claim.status] ?? CLAIM_STATUS.pending;
            const busy = busyId === claim.id;
            return (
              <div key={claim.id} className="clay-card p-4 flex flex-col gap-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex flex-col min-w-0">
                    <span className="font-body-bold text-body-bold text-text-primary truncate">
                      {claim.item_name}
                    </span>
                    <span className="font-caption text-caption text-text-muted">
                      {formatAngka(claim.quantity)} {claim.unit} •{" "}
                      {claim.claimed_by_name}
                    </span>
                  </div>
                  <span
                    className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full font-caption text-caption shrink-0 ${meta.cls}`}
                  >
                    <span className="material-symbols-outlined text-[14px]">
                      {meta.icon}
                    </span>
                    {meta.label}
                  </span>
                </div>
                {claim.note ? (
                  <p className="font-caption text-caption text-text-secondary">
                    Catatan: {claim.note}
                  </p>
                ) : null}
                <span className="font-caption text-caption text-text-muted">
                  {formatDateWib(claim.created_at)} •{" "}
                  {formatTimeWib(claim.created_at)} WIB
                  {claim.confirmed_by_name
                    ? ` • Diproses ${claim.confirmed_by_name}`
                    : ""}
                </span>
                {canManage && claim.status === "pending" ? (
                  <div className="flex gap-2 pt-1">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => confirmClaim(claim)}
                      className="flex-1 py-2.5 rounded-xl bg-success-surface text-success-text font-caption text-caption flex items-center justify-center gap-1 active:scale-95 transition-transform disabled:opacity-60"
                    >
                      <span className="material-symbols-outlined text-[18px]">
                        check
                      </span>
                      Setujui
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => rejectClaim(claim)}
                      className="flex-1 py-2.5 rounded-xl bg-danger-surface text-danger-text font-caption text-caption flex items-center justify-center gap-1 active:scale-95 transition-transform disabled:opacity-60"
                    >
                      <span className="material-symbols-outlined text-[18px]">
                        close
                      </span>
                      Tolak
                    </button>
                  </div>
                ) : null}
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
                <span className="material-symbols-outlined text-[20px]">
                  close
                </span>
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
              className="w-full py-4 rounded-2xl bg-primary text-white font-body-bold text-body-bold flex items-center justify-center gap-2 active:scale-95 transition-transform disabled:opacity-60"
            >
              <span className="material-symbols-outlined text-[22px]">
                {submitting ? "hourglass_top" : "send"}
              </span>
              {submitting ? "Mengirim..." : "Ajukan Klaim"}
            </button>
          </div>
        </div>
      ) : null}

      {/* Stok masuk dari supplier */}
      {canManage ? (
        <section className="px-gutter pt-4">
          <button
            type="button"
            onClick={() => setInOpen((v) => !v)}
            className="w-full h-11 rounded-2xl bg-success-surface text-success-text font-caption text-caption flex items-center justify-center gap-1.5 active:scale-95 transition-transform"
          >
            <span className="material-symbols-outlined text-[18px]">move_to_inbox</span>
            {inOpen ? "Tutup formulir stok masuk" : "Catat stok masuk supplier"}
          </button>

          {inOpen ? (
            <div className="mt-2 rounded-2xl bg-surface-container-low p-3 flex flex-col gap-2">
              <label className="flex flex-col gap-1">
                <span className="font-caption text-caption text-text-muted">
                  Cari barang
                </span>
                <input
                  value={cariBarang}
                  onChange={(e) => setCariBarang(e.target.value)}
                  type="search"
                  placeholder="Ketik nama obat atau bahan..."
                  className="h-11 px-3 rounded-xl bg-surface font-body text-body text-text-primary outline-none focus:ring-2 focus:ring-brand-400"
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
                  className="h-12 px-3 rounded-xl bg-surface font-body text-body text-text-primary outline-none focus:ring-2 focus:ring-brand-400"
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
                    Tidak ada barang bernama {cariBarang.trim()}. Periksa ejaan atau
                    hapus kata kunci.
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
                        className="h-11 px-3 rounded-xl bg-surface font-body text-body text-text-primary outline-none focus:ring-2 focus:ring-brand-400"
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
                        className="h-11 px-3 rounded-xl bg-surface font-body-mono text-body text-text-primary outline-none focus:ring-2 focus:ring-brand-400"
                      />
                    </label>
                  </div>
                  <input
                    value={inNote}
                    onChange={(e) => setInNote(e.target.value)}
                    placeholder="Nama supplier / nomor nota"
                    className="h-11 px-3 rounded-xl bg-surface font-body text-body text-text-primary outline-none focus:ring-2 focus:ring-brand-400"
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
                    <span className="material-symbols-outlined text-[20px]">
                      {submitting ? "hourglass_top" : "inventory_2"}
                    </span>
                    {submitting ? "Mencatat..." : "Catat Stok Masuk"}
                  </button>
                </>
              ) : null}
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
