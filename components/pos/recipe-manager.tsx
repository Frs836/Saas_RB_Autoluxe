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

/**
 * Resep per ukuran kendaraan.
 * Kosong (undefined/null) = size itu tidak memakai bahan ini.
 */
export type RecipeRow = {
  service_id: string;
  item_id: string;
  // Mobil
  qty_s?: number;
  qty_m?: number;
  qty_l?: number;
  qty_xl?: number;
  // Motor
  qty_motor_s?: number;
  qty_motor_m?: number;
  qty_motor_l?: number;
  qty_motor_xl?: number;
};

type SizeKey = "qty_s" | "qty_m" | "qty_l" | "qty_xl" | "qty_motor_s" | "qty_motor_m" | "qty_motor_l" | "qty_motor_xl";

const SIZE_LABELS: Record<SizeKey, { label: string; group: "mobil" | "motor" }> = {
  qty_s: { label: "Mobil S", group: "mobil" },
  qty_m: { label: "Mobil M", group: "mobil" },
  qty_l: { label: "Mobil L", group: "mobil" },
  qty_xl: { label: "Mobil XL", group: "mobil" },
  qty_motor_s: { label: "Motor S", group: "motor" },
  qty_motor_m: { label: "Motor M", group: "motor" },
  qty_motor_l: { label: "Motor L", group: "motor" },
  qty_motor_xl: { label: "Motor XL", group: "motor" },
};

const SIZE_KEYS_MOBIL: SizeKey[] = ["qty_s", "qty_m", "qty_l", "qty_xl"];
const SIZE_KEYS_MOTOR: SizeKey[] = ["qty_motor_s", "qty_motor_m", "qty_motor_l", "qty_motor_xl"];
const ALL_SIZE_KEYS: SizeKey[] = [...SIZE_KEYS_MOBIL, ...SIZE_KEYS_MOTOR];

/**
 * Pengaturan bahan yang terpakai per layanan, per ukuran kendaraan.
 *
 * Resep disimpan per cabang karena stok juga per cabang. Penulisan lewat RPC
 * set_service_recipe supaya validasi cabang dan peran tetap di server.
 *
 * Setiap ukuran (S/M/L/XL + Motor S/M/L/XL) punya quantity sendiri.
 * Kosong = size tersebut tidak memakai bahan ini (stok tidak terpotong).
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
  const [sibuk, setSibuk] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sukses, setSukses] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"mobil" | "motor">("mobil");

  // Form input untuk tambah/ubah
  const [formQty, setFormQty] = useState<Record<SizeKey, string>>({
    qty_s: "",
    qty_m: "",
    qty_l: "",
    qty_xl: "",
    qty_motor_s: "",
    qty_motor_m: "",
    qty_motor_l: "",
    qty_motor_xl: "",
  });

  const itemById = useMemo(
    () => Object.fromEntries(items.map((item) => [item.id, item])),
    [items],
  );

  const service = services.find((row) => row.id === serviceId) ?? null;

  // Resep untuk jasa yang dipilih, di-flatten dengan info item
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

  // Ambil nilai qty untuk size tertentu dari row
  const getRowQty = (row: RecipeRow, key: SizeKey): number | undefined => row[key];

  // Set formQty dari row yang diklik "Ubah"
  const isiFormDariRow = (row: RecipeRow) => {
    const newForm: Record<SizeKey, string> = {
      qty_s: "",
      qty_m: "",
      qty_l: "",
      qty_xl: "",
      qty_motor_s: "",
      qty_motor_m: "",
      qty_motor_l: "",
      qty_motor_xl: "",
    };
    (ALL_SIZE_KEYS as SizeKey[]).forEach((key) => {
      const val = row[key];
      if (val !== undefined && val !== null && val > 0) {
        newForm[key] = String(val);
      }
    });
    setFormQty(newForm);
    setItemId(row.item_id);
    setError(null);
    setSukses(null);
  };

  // Kosongkan form
  const resetForm = () => {
    setFormQty({
      qty_s: "",
      qty_m: "",
      qty_l: "",
      qty_xl: "",
      qty_motor_s: "",
      qty_motor_m: "",
      qty_motor_l: "",
      qty_motor_xl: "",
    });
    setError(null);
    setSukses(null);
  };

  async function kirim(remove: boolean) {
    if (sibuk || !serviceId || !itemId) return;

    // Validasi: minimal satu size diisi
    const hasValue = ALL_SIZE_KEYS.some((key) => {
      const val = Number(formQty[key].replace(",", "."));
      return !remove && Number.isFinite(val) && val > 0;
    });
    if (!remove && !hasValue) {
      setError("Minimal satu ukuran harus diisi (angka > 0).");
      return;
    }

    setSibuk(true);
    setError(null);
    setSukses(null);

    const payload: Record<string, unknown> = {
      p_branch_id: branchId,
      p_service_id: serviceId,
      p_item_id: itemId,
      p_remove: remove,
    };

    if (!remove) {
      (ALL_SIZE_KEYS as SizeKey[]).forEach((key) => {
        const val = formQty[key].trim();
        if (val !== "") {
          const num = Number(val.replace(",", "."));
          if (Number.isFinite(num) && num > 0) {
            payload[`p_${key}`] = num;
          }
        }
      });
    }

    const { data, error: rpcError } = await supabase.rpc("set_service_recipe", payload as never);

    setSibuk(false);

    if (rpcError) {
      setError(rpcError.message);
      return;
    }

    // Update local state
    setRecipes((prev) => {
      const tanpaItem = prev.filter(
        (row) => !(row.service_id === serviceId && row.item_id === itemId),
      );
      if (remove) return tanpaItem;

      const saved = (Array.isArray(data) ? data[0] : data) as Partial<RecipeRow> | null;

      const newRow: RecipeRow = {
        service_id: serviceId,
        item_id: itemId,
      };

      (ALL_SIZE_KEYS as SizeKey[]).forEach((key) => {
        if (saved && saved[key] !== undefined && saved[key] !== null) {
          newRow[key] = Number(saved[key]);
        } else {
          const formVal = formQty[key].trim();
          if (formVal !== "") {
            const num = Number(formVal.replace(",", "."));
            if (Number.isFinite(num) && num > 0) {
              newRow[key] = num;
            }
          }
        }
      });

      return [...tanpaItem, newRow];
    });

    setSukses(
      remove
        ? "Bahan dihapus dari resep."
        : `Resep disimpan: ${itemById[itemId]?.item_name ?? "bahan"} untuk ${Object.entries(formQty).filter(([, v]) => v.trim() !== "").length} ukuran.`,
    );
    resetForm();
  }

  // Render input grid untuk tab Mobil atau Motor
  const renderSizeInputs = (group: "mobil" | "motor", disabled: boolean) => {
    const keys = group === "mobil" ? SIZE_KEYS_MOBIL : SIZE_KEYS_MOTOR;
    return (
      <div className="grid grid-cols-4 gap-2">
        {keys.map((key) => (
          <label key={key} className="flex flex-col gap-1">
            <span className="font-caption text-caption text-text-secondary text-center">
              {SIZE_LABELS[key].label}
            </span>
            <input
              type="number"
              inputMode="decimal"
              min="0"
              step="0.01"
              value={formQty[key]}
              onChange={(e) => setFormQty({ ...formQty, [key]: e.target.value })}
              disabled={disabled || sibuk}
              className="h-11 rounded-2xl bg-surface px-3 font-body text-body text-text-primary text-center outline-none focus:ring-2 focus:ring-brand-400"
              placeholder="—"
              aria-label={SIZE_LABELS[key].label}
            />
          </label>
        ))}
      </div>
    );
  };

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
            resetForm();
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
            terpotong saat jasa ini di-checkout sesuai ukuran kendaraan.
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
                    {(() => {
                      const parts: string[] = [];
                      (ALL_SIZE_KEYS as SizeKey[]).forEach((key) => {
                        const val = row[key];
                        if (val !== undefined && val !== null && val > 0) {
                          parts.push(`${SIZE_LABELS[key].label}: ${formatAngka(val)} ${row.item.unit}`);
                        }
                      });
                      return parts.length > 0 ? parts.join(" • ") : "Belum ada ukuran diisi";
                    })()}
                    · stok {formatAngka(row.item.current_stock)} {row.item.unit}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={sibuk}
                  onClick={() => isiFormDariRow(row)}
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
              resetForm();
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

        {/* Tabs Mobil / Motor */}
        <div className="flex gap-1 bg-surface rounded-xl p-1">
          <button
            type="button"
            onClick={() => setActiveTab("mobil")}
            className={`flex-1 h-10 rounded-lg font-body-bold text-body-bold transition-colors ${
              activeTab === "mobil"
                ? "bg-brand-600 text-white"
                : "text-text-secondary hover:bg-brand-50"
            }`}
          >
            Mobil (S, M, L, XL)
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("motor")}
            className={`flex-1 h-10 rounded-lg font-body-bold text-body-bold transition-colors ${
              activeTab === "motor"
                ? "bg-brand-600 text-white"
                : "text-text-secondary hover:bg-brand-50"
            }`}
          >
            Motor (S, M, L, XL)
          </button>
        </div>

        <div className="flex flex-col gap-2">
          {renderSizeInputs(activeTab, false)}

          <p className="font-caption text-caption text-text-muted text-center">
            Isi dalam satuan stok bahan
            {selectedItem ? ` (${selectedItem.unit})` : ""}.
            Kosong = size tersebut tidak memakai bahan ini.
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
        </div>
      </section>
    </main>
  );
}