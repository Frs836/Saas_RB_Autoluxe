"use client";

import { useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Icon } from "@/components/ui/icon";
import { formatAngka } from "@/lib/pos";

export type RecipeService = {
  id: string;
  name: string;
};

export type RecipeItem = {
  id: string;
  item_name: string;
  current_stock: number;
  unit: string;
};

export type RecipeRow = {
  service_id: string;
  item_id: string;
  quantity: number;
};

/**
 * Pengaturan bahan yang terpakai per layanan.
 *
 * Resep disimpan per cabang karena stok juga per cabang. Penulisan lewat RPC
 * set_service_recipe supaya validasi cabang dan peran tetap di server.
 */
export function RecipeManager({
  branchId,
  services,
  items,
  initialRecipes,
}: {
  branchId: string;
  services: RecipeService[];
  items: RecipeItem[];
  initialRecipes: RecipeRow[];
}) {
  const supabase = useMemo(() => createClient(), []);
  const [recipes, setRecipes] = useState<RecipeRow[]>(initialRecipes);
  const [serviceId, setServiceId] = useState(services[0]?.id ?? "");
  const [itemId, setItemId] = useState(items[0]?.id ?? "");
  const [qty, setQty] = useState("1");
  const [sibuk, setSibuk] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sukses, setSukses] = useState<string | null>(null);

  const itemById = useMemo(
    () => Object.fromEntries(items.map((item) => [item.id, item])),
    [items],
  );

  const service = services.find((row) => row.id === serviceId) ?? null;

  const rows = useMemo(
    () =>
      recipes
        .filter((row) => row.service_id === serviceId)
        .flatMap((row) => {
          const item = itemById[row.item_id];
          return item ? [{ ...row, item }] : [];
        })
        .sort((a, b) => a.item.item_name.localeCompare(b.item.item_name, "id")),
    [recipes, serviceId, itemById],
  );

  const selectedItem = itemById[itemId] ?? null;

  async function kirim(remove: boolean) {
    if (sibuk || !serviceId || !itemId) return;

    const jumlah = Number(qty.replace(",", "."));
    if (!remove && (!Number.isFinite(jumlah) || jumlah <= 0)) {
      setError("Jumlah pemakaian harus lebih dari nol.");
      return;
    }

    setSibuk(true);
    setError(null);
    setSukses(null);

    const { data, error: rpcError } = await supabase.rpc("set_service_recipe", {
      p_branch_id: branchId,
      p_service_id: serviceId,
      p_item_id: itemId,
      p_quantity: remove ? 1 : jumlah,
      p_remove: remove,
    });

    setSibuk(false);

    if (rpcError) {
      setError(rpcError.message);
      return;
    }

    setRecipes((prev) => {
      const tanpaItem = prev.filter(
        (row) => !(row.service_id === serviceId && row.item_id === itemId),
      );
      if (remove) return tanpaItem;
      const saved = (Array.isArray(data) ? data[0] : data) as
        | { quantity: number | string }
        | null;
      return [
        ...tanpaItem,
        {
          service_id: serviceId,
          item_id: itemId,
          quantity: Number(saved?.quantity ?? jumlah),
        },
      ];
    });

    setSukses(
      remove
        ? "Bahan dihapus dari resep."
        : `Resep disimpan: ${itemById[itemId]?.item_name ?? "bahan"} ${formatAngka(jumlah)} ${itemById[itemId]?.unit ?? ""}.`,
    );
    if (!remove) setQty("1");
  }

  return (
    <main className="flex-1 px-gutter pt-4 pb-nav-plain flex flex-col gap-3">
      {error ? (
        <p className="clay-card p-3 font-body text-body text-danger-text">{error}</p>
      ) : null}
      {sukses ? (
        <p className="clay-card p-3 font-body text-body text-success-text">{sukses}</p>
      ) : null}

      <label className="flex flex-col gap-1.5">
        <span className="font-body-bold text-body-bold text-text-primary">Pilih jasa</span>
        <select
          value={serviceId}
          onChange={(e) => {
            setServiceId(e.target.value);
            setError(null);
            setSukses(null);
          }}
          className="h-12 rounded-2xl bg-surface px-3 font-body text-body text-text-primary outline-none focus:ring-2 focus:ring-brand-400"
        >
          {services.map((row) => (
            <option key={row.id} value={row.id}>
              {row.name}
            </option>
          ))}
        </select>
      </label>

      <section className="clay-card p-4 flex flex-col gap-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h2 className="font-headline-3 text-headline-3 text-text-primary">
              Bahan terpakai
            </h2>
            <p className="font-caption text-caption text-text-muted">
              {service ? service.name : "Belum ada jasa dipilih"}
            </p>
          </div>
          <span className="shrink-0 rounded-full bg-brand-50 px-3 py-1 font-caption text-caption text-brand-700">
            {rows.length} bahan
          </span>
        </div>

        {rows.length === 0 ? (
          <p className="font-body text-body text-text-secondary">
            Belum ada bahan. Tambahkan bahan di bawah supaya stok gudang otomatis
            terpotong saat jasa ini di-checkout.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {rows.map((row) => (
              <li
                key={row.item_id}
                className="flex items-center gap-3 rounded-2xl bg-surface p-3"
              >
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
                  <Icon name="inventory_2" className="text-[20px]" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-body-bold text-body-bold text-text-primary">
                    {row.item.item_name}
                  </p>
                  <p className="font-caption text-caption text-text-muted">
                    {formatAngka(row.quantity)} {row.item.unit} per unit jasa · stok{" "}
                    {formatAngka(row.item.current_stock)} {row.item.unit}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={sibuk}
                  onClick={() => {
                    setItemId(row.item_id);
                    setQty(String(row.quantity));
                  }}
                  className="min-h-10 rounded-xl px-2 font-caption text-caption text-brand-600 disabled:opacity-50"
                >
                  Ubah
                </button>
                <button
                  type="button"
                  disabled={sibuk}
                  onClick={() => {
                    setItemId(row.item_id);
                    void kirim(true);
                  }}
                  className="flex h-10 w-10 items-center justify-center rounded-xl text-danger-text disabled:opacity-50"
                  aria-label={`Hapus ${row.item.item_name} dari resep`}
                >
                  <Icon name="delete" className="text-[20px]" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="clay-card p-4 flex flex-col gap-3">
        <h2 className="font-headline-3 text-headline-3 text-text-primary">
          Tambah / ubah bahan
        </h2>

        <label className="flex flex-col gap-1.5">
          <span className="font-body-bold text-body-bold text-text-primary">Bahan gudang</span>
          <select
            value={itemId}
            onChange={(e) => {
              setItemId(e.target.value);
              setError(null);
              setSukses(null);
            }}
            className="h-12 rounded-2xl bg-surface px-3 font-body text-body text-text-primary outline-none focus:ring-2 focus:ring-brand-400"
          >
            {items.map((item) => (
              <option key={item.id} value={item.id}>
                {item.item_name} — stok {formatAngka(item.current_stock)} {item.unit}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="font-body-bold text-body-bold text-text-primary">
            Pemakaian per unit jasa
          </span>
          <div className="flex items-center gap-2">
            <input
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              inputMode="decimal"
              type="number"
              min="0.01"
              step="0.01"
              className="h-12 min-w-0 flex-1 rounded-2xl bg-surface px-3 font-body text-body text-text-primary outline-none focus:ring-2 focus:ring-brand-400"
            />
            <span className="font-body text-body text-text-secondary">
              {selectedItem?.unit ?? "satuan"}
            </span>
          </div>
        </label>

        <p className="font-caption text-caption text-text-muted">
          Isi dalam satuan stok bahan
          {selectedItem ? ` (${selectedItem.unit})` : ""}. Contoh: 15 ml = 0,015
          liter, dan pembelian 2 jasa memotong dua kali lipat.
        </p>

        <button
          type="button"
          disabled={sibuk || !serviceId || !itemId}
          onClick={() => void kirim(false)}
          className="flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-brand-600 px-4 font-body-bold text-body-bold text-white active:scale-[0.99] disabled:opacity-50"
        >
          <Icon name="add" className="text-[20px]" />
          {sibuk ? "Menyimpan..." : "Simpan bahan"}
        </button>
      </section>
    </main>
  );
}
