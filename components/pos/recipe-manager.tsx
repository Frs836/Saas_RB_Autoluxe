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
  unit_cost?: number | null;
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

export type BundleRecipeItem = {
  id: string;        // bundle_items.id
  bundle_name: string;
  unit: string;
  current_stock?: number;
  unit_cost?: number | null;
};

export type BundleRecipeRow = {
  service_id: string;
  bundle_item_id: string;
  qty_s?: number;
  qty_m?: number;
  qty_l?: number;
  qty_xl?: number;
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

function emptyFormQty(): Record<SizeKey, string> {
  return {
    qty_s: "",
    qty_m: "",
    qty_l: "",
    qty_xl: "",
    qty_motor_s: "",
    qty_motor_m: "",
    qty_motor_l: "",
    qty_motor_xl: "",
  };
}

/**
 * Pengaturan bahan yang terpakai per layanan, per ukuran kendaraan.
 *
 * Resep disimpan per cabang karena stok juga per cabang. Penulisan lewat RPC
 * set_service_recipe (stok biasa) dan set_service_bundle_recipe (racikan)
 * supaya validasi cabang dan peran tetap di server.
 *
 * Setiap ukuran (S/M/L/XL + Motor S/M/L/XL) punya quantity sendiri.
 * Kosong = size tersebut tidak memakai bahan ini (stok tidak terpotong).
 */
export function RecipeManager({
  branchId,
  services,
  items,
  initialRecipes,
  bundles,
  initialBundleRecipes,
}: {
  branchId: string;
  services: RecipeService[];
  items: RecipeItem[];
  initialRecipes: RecipeRow[];
  bundles: BundleRecipeItem[];
  initialBundleRecipes: BundleRecipeRow[];
}) {
  const supabase = useMemo(() => createClient(), []);

  // ── Shared state ──────────────────────────────────────────────────────────
  const [serviceId, setServiceId] = useState(services[0]?.id ?? "");
  const [sibuk, setSibuk] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sukses, setSukses] = useState<string | null>(null);

  // ── Stok biasa ───────────────────────────────────────────────────────────
  const [recipes, setRecipes] = useState<RecipeRow[]>(initialRecipes);
  const [itemId, setItemId] = useState(items[0]?.id ?? "");
  const [activeTab, setActiveTab] = useState<"mobil" | "motor">("mobil");
  const [formQty, setFormQty] = useState<Record<SizeKey, string>>(emptyFormQty());

  // ── Bahan Racikan ────────────────────────────────────────────────────────
  const [bundleRecipes, setBundleRecipes] = useState<BundleRecipeRow[]>(initialBundleRecipes);
  const [bundleId, setBundleId] = useState(bundles[0]?.id ?? "");
  const [bundleActiveTab, setBundleActiveTab] = useState<"mobil" | "motor">("mobil");
  const [bundleFormQty, setBundleFormQty] = useState<Record<SizeKey, string>>(emptyFormQty());

  // ── Derived maps ─────────────────────────────────────────────────────────
  const itemById = useMemo(
    () => Object.fromEntries(items.map((item) => [item.id, item])),
    [items],
  );
  const bundleById = useMemo(
    () => Object.fromEntries(bundles.map((b) => [b.id, b])),
    [bundles],
  );

  const service = services.find((row) => row.id === serviceId) ?? null;

  // Resep stok biasa untuk jasa yang dipilih
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

  // Resep racikan untuk jasa yang dipilih
  const bundleRows = useMemo(
    () =>
      bundleRecipes
        .filter((row) => row.service_id === serviceId)
        .flatMap((row) => {
          const bundle = bundleById[row.bundle_item_id];
          return bundle ? [{ ...row, bundle }] : [];
        })
        .sort((a, b) => a.bundle.bundle_name.localeCompare(b.bundle.bundle_name, "id")),
    [bundleRecipes, serviceId, bundleById],
  );

  const costPerSize = useMemo(() => {
    const totals: Record<SizeKey, number> = {
      qty_s: 0,
      qty_m: 0,
      qty_l: 0,
      qty_xl: 0,
      qty_motor_s: 0,
      qty_motor_m: 0,
      qty_motor_l: 0,
      qty_motor_xl: 0,
    };
    // Akumulasi bahan gudang reguler
    for (const r of rows) {
      const uCost = Number(r.item.unit_cost ?? 0);
      for (const k of ALL_SIZE_KEYS) {
        const q = Number(r[k] ?? 0);
        if (q > 0 && uCost > 0) {
          totals[k] += q * uCost;
        }
      }
    }
    // Akumulasi bahan racikan
    for (const br of bundleRows) {
      const uCost = Number(br.bundle.unit_cost ?? 0);
      for (const k of ALL_SIZE_KEYS) {
        const q = Number(br[k] ?? 0);
        if (q > 0 && uCost > 0) {
          totals[k] += q * uCost;
        }
      }
    }
    return totals;
  }, [rows, bundleRows]);

  const selectedItem = itemById[itemId] ?? null;
  const selectedBundle = bundleById[bundleId] ?? null;

  // ── Helpers ───────────────────────────────────────────────────────────────
  const isiFormDariRow = (row: RecipeRow) => {
    const newForm: Record<SizeKey, string> = emptyFormQty();
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

  const isiFormBundleDariRow = (row: BundleRecipeRow) => {
    const newForm: Record<SizeKey, string> = emptyFormQty();
    (ALL_SIZE_KEYS as SizeKey[]).forEach((key) => {
      const val = row[key];
      if (val !== undefined && val !== null && val > 0) {
        newForm[key] = String(val);
      }
    });
    setBundleFormQty(newForm);
    setBundleId(row.bundle_item_id);
    setError(null);
    setSukses(null);
  };

  const resetForm = () => {
    setFormQty(emptyFormQty());
    setError(null);
    setSukses(null);
  };

  const resetBundleForm = () => {
    setBundleFormQty(emptyFormQty());
    setError(null);
    setSukses(null);
  };

  // ── Simpan stok biasa ─────────────────────────────────────────────────────
  async function kirim(remove: boolean) {
    if (sibuk || !serviceId || !itemId) return;

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

    setRecipes((prev) => {
      const tanpaItem = prev.filter(
        (row) => !(row.service_id === serviceId && row.item_id === itemId),
      );
      if (remove) return tanpaItem;

      const saved = (Array.isArray(data) ? data[0] : data) as Partial<RecipeRow> | null;
      const newRow: RecipeRow = { service_id: serviceId, item_id: itemId };

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

  // ── Simpan racikan ────────────────────────────────────────────────────────
  async function kirimBundle(remove: boolean) {
    if (sibuk || !serviceId || !bundleId) return;

    const hasValue = ALL_SIZE_KEYS.some((key) => {
      const val = Number(bundleFormQty[key].replace(",", "."));
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
      p_bundle_item_id: bundleId,
      p_remove: remove,
    };

    if (!remove) {
      (ALL_SIZE_KEYS as SizeKey[]).forEach((key) => {
        const val = bundleFormQty[key].trim();
        if (val !== "") {
          const num = Number(val.replace(",", "."));
          if (Number.isFinite(num) && num > 0) {
            payload[`p_${key}`] = num;
          }
        }
      });
    }

    const { data, error: rpcError } = await (supabase as any).rpc("set_service_bundle_recipe", payload as never);

    setSibuk(false);

    if (rpcError) {
      setError(rpcError.message);
      return;
    }

    setBundleRecipes((prev) => {
      const tanpaBundle = prev.filter(
        (row) => !(row.service_id === serviceId && row.bundle_item_id === bundleId),
      );
      if (remove) return tanpaBundle;

      const saved = (Array.isArray(data) ? data[0] : data) as Partial<BundleRecipeRow> | null;
      const newRow: BundleRecipeRow = { service_id: serviceId, bundle_item_id: bundleId };

      (ALL_SIZE_KEYS as SizeKey[]).forEach((key) => {
        if (saved && saved[key] !== undefined && saved[key] !== null) {
          newRow[key] = Number(saved[key]);
        } else {
          const formVal = bundleFormQty[key].trim();
          if (formVal !== "") {
            const num = Number(formVal.replace(",", "."));
            if (Number.isFinite(num) && num > 0) {
              newRow[key] = num;
            }
          }
        }
      });

      return [...tanpaBundle, newRow];
    });

    setSukses(
      remove
        ? "Bahan racikan dihapus dari resep."
        : `Resep racikan disimpan: ${bundleById[bundleId]?.bundle_name ?? "racikan"} untuk ${Object.entries(bundleFormQty).filter(([, v]) => v.trim() !== "").length} ukuran.`,
    );
    resetBundleForm();
  }

  // ── Render helpers ────────────────────────────────────────────────────────
  const renderSizeInputs = (
    group: "mobil" | "motor",
    disabled: boolean,
    qty: Record<SizeKey, string>,
    setQty: (q: Record<SizeKey, string>) => void,
  ) => {
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
              value={qty[key]}
              onChange={(e) => setQty({ ...qty, [key]: e.target.value })}
              disabled={disabled || sibuk}
              className="h-11 rounded-[8px] border border-border bg-surface px-3 font-body text-body text-text-primary text-center outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
              placeholder="-"
              aria-label={SIZE_LABELS[key].label}
            />
          </label>
        ))}
      </div>
    );
  };

  const totalBahan = rows.length + bundleRows.length;

  return (
    <main className="flex-1 px-gutter pt-4 pb-nav-plain lg:pb-8 flex flex-col gap-3 lg:grid lg:grid-cols-3 lg:gap-6 lg:px-6 lg:py-6 lg:items-start">
      {error ? (
        <p className="clay-card rounded-[10px] p-3 font-body text-body text-danger-text lg:col-span-3 border border-red-200 bg-red-50">{error}</p>
      ) : null}
      {sukses ? (
        <p className="clay-card rounded-[10px] p-3 font-body text-body text-success-text lg:col-span-3 border border-emerald-200 bg-emerald-50">{sukses}</p>
      ) : null}

      {/* Left column */}
      <div className="lg:col-span-1 flex flex-col gap-3">
        <label className="flex flex-col gap-1.5">
          <span className="font-body-bold text-body-bold text-text-primary">Pilih jasa</span>
          <select
            value={serviceId}
            onChange={(e) => {
              setServiceId(e.target.value);
              setError(null);
              setSukses(null);
              resetForm();
              resetBundleForm();
            }}
            className="h-11 px-3.5 rounded-[8px] border border-border bg-surface font-body text-body text-text-primary outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
          >
            {services.map((row) => (
              <option key={row.id} value={row.id}>
                {row.name}
              </option>
            ))}
          </select>
        </label>

        <section className="clay-card rounded-[10px] p-4 flex flex-col gap-3">
          <div className="flex items-start justify-between gap-2">
            <div>
              <h2 className="font-headline-3 text-headline-3 text-text-primary">
                Bahan terpakai
              </h2>
              <p className="font-caption text-caption text-text-muted">
                {service ? service.name : "Belum ada jasa dipilih"}
              </p>
            </div>
            <span className="shrink-0 rounded-[6px] border border-brand-200 bg-brand-50 px-2.5 py-0.5 font-micro-badge text-micro-badge text-brand-700">
              {totalBahan} bahan
            </span>
          </div>

          {totalBahan === 0 ? (
            <p className="font-body text-body text-text-secondary">
              Belum ada bahan. Tambahkan bahan di bawah supaya stok gudang otomatis
              terpotong saat jasa ini di-checkout sesuai ukuran kendaraan.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {/* Stok biasa */}
              {rows.map((row) => (
                <li
                  key={`item-${row.item_id}`}
                  className="flex items-center gap-3 rounded-[8px] border border-border bg-surface p-3"
                >
                  <span className="flex h-10 w-10 items-center justify-center rounded-[8px] border border-brand-200 bg-brand-50 text-brand-600">
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
                    className="min-h-10 rounded-[8px] px-2.5 font-caption text-caption text-brand-600 hover:bg-brand-50 transition-colors disabled:opacity-50"
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
                    className="flex h-10 w-10 items-center justify-center rounded-[8px] text-red-600 hover:bg-red-50 transition-colors disabled:opacity-50"
                    aria-label={`Hapus ${row.item.item_name} dari resep`}
                  >
                    <Icon name="delete" className="text-[20px]" />
                  </button>
                </li>
              ))}

              {/* Racikan */}
              {bundleRows.map((row) => (
                <li
                  key={`bundle-${row.bundle_item_id}`}
                  className="flex items-center gap-3 rounded-[8px] border border-border bg-surface p-3"
                >
                  <span className="flex h-10 w-10 items-center justify-center rounded-[8px] border border-purple-200 bg-purple-50 text-purple-600">
                    <Icon name="science" className="text-[20px]" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="truncate font-body-bold text-body-bold text-text-primary">
                        {row.bundle.bundle_name}
                      </p>
                      <span className="shrink-0 rounded-[6px] border border-purple-200 bg-purple-100 px-2 py-0.5 font-micro-badge text-micro-badge text-purple-700">
                        Racikan
                      </span>
                    </div>
                    <p className="font-caption text-caption text-text-muted">
                      {(() => {
                        const parts: string[] = [];
                        (ALL_SIZE_KEYS as SizeKey[]).forEach((key) => {
                          const val = row[key];
                          if (val !== undefined && val !== null && val > 0) {
                            parts.push(`${SIZE_LABELS[key].label}: ${formatAngka(val)} ${row.bundle.unit}`);
                          }
                        });
                        return parts.length > 0 ? parts.join(" • ") : "Belum ada ukuran diisi";
                      })()}
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={sibuk}
                    onClick={() => isiFormBundleDariRow(row)}
                    className="min-h-10 rounded-[8px] px-2.5 font-caption text-caption text-brand-600 hover:bg-brand-50 transition-colors disabled:opacity-50"
                  >
                    Ubah
                  </button>
                  <button
                    type="button"
                    disabled={sibuk}
                    onClick={() => {
                      setBundleId(row.bundle_item_id);
                      void kirimBundle(true);
                    }}
                    className="flex h-10 w-10 items-center justify-center rounded-[8px] text-red-600 hover:bg-red-50 transition-colors disabled:opacity-50"
                    aria-label={`Hapus ${row.bundle.bundle_name} dari resep`}
                  >
                    <Icon name="delete" className="text-[20px]" />
                  </button>
                </li>
              ))}
            </ul>
          )}

          {rows.length > 0 ? (
            <div className="p-3.5 rounded-[8px] bg-brand-50 border border-brand-200 flex flex-col gap-2 mt-2">
              <div className="flex items-center gap-1.5 text-brand-900 font-headline-3 text-caption font-bold">
                <Icon name="paid" className="text-[18px] text-brand-600" />
                <span>Estimasi Modal Bahan (HPP) per Ukuran</span>
              </div>
              <div className="grid grid-cols-4 gap-1.5 text-center">
                {SIZE_KEYS_MOBIL.map((k) => (
                  <div key={k} className="p-2 rounded-[6px] bg-surface border border-brand-200 shadow-sm">
                    <div className="text-[10px] text-text-muted font-medium">{SIZE_LABELS[k].label}</div>
                    <div className="font-bold text-xs text-brand-700 mt-0.5 tabular-nums">
                      Rp {costPerSize[k].toLocaleString("id-ID")}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </section>
      </div>

      {/* Right col-span-2: add/edit forms */}
      <div className="lg:col-span-2 flex flex-col gap-3">
        {/* Section stok biasa */}
        {items.length > 0 && (
          <section className="clay-card rounded-[10px] p-4 flex flex-col gap-3">
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
                className="h-11 px-3.5 rounded-[8px] border border-border bg-surface font-body text-body text-text-primary outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
              >
                {items.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.item_name} - stok {formatAngka(item.current_stock)} {item.unit}
                  </option>
                ))}
              </select>
            </label>

            {/* Tabs Mobil / Motor */}
            <div className="flex gap-1 bg-surface-container-low border border-border rounded-[8px] p-1">
              <button
                type="button"
                onClick={() => setActiveTab("mobil")}
                className={`flex-1 h-9 rounded-[6px] font-body-bold text-caption transition-colors ${
                  activeTab === "mobil"
                    ? "primary-gradient clay-glow text-white"
                    : "text-text-secondary hover:bg-surface-container"
                }`}
              >
                Mobil (S, M, L, XL)
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("motor")}
                className={`flex-1 h-9 rounded-[6px] font-body-bold text-caption transition-colors ${
                  activeTab === "motor"
                    ? "primary-gradient clay-glow text-white"
                    : "text-text-secondary hover:bg-surface-container"
                }`}
              >
                Motor (S, M, L, XL)
              </button>
            </div>

            <div className="flex flex-col gap-2">
              {renderSizeInputs(activeTab, false, formQty, setFormQty)}

              <p className="font-caption text-caption text-text-muted text-center">
                Isi dalam satuan stok bahan
                {selectedItem ? ` (${selectedItem.unit})` : ""}.
                Kosong = size tersebut tidak memakai bahan ini.
              </p>

              <button
                type="button"
                disabled={sibuk || !serviceId || !itemId}
                onClick={() => void kirim(false)}
                className="flex h-11 items-center justify-center gap-2 rounded-[8px] primary-gradient clay-glow px-4 font-body-bold text-body-bold text-white hover:opacity-90 transition-opacity disabled:opacity-50"
              >
                <Icon name="add" className="text-[20px]" />
                {sibuk ? "Menyimpan..." : "Simpan bahan"}
              </button>
            </div>
          </section>
        )}

        {/* Section bahan racikan */}
        {bundles.length > 0 && (
          <section className="clay-card rounded-[10px] p-4 flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-[8px] border border-purple-200 bg-purple-50 text-purple-600">
                <Icon name="science" className="text-[18px]" />
              </span>
              <h2 className="font-headline-3 text-headline-3 text-text-primary">
                Bahan Racikan
              </h2>
            </div>

            <label className="flex flex-col gap-1.5">
              <span className="font-body-bold text-body-bold text-text-primary">Pilih racikan</span>
              <select
                value={bundleId}
                onChange={(e) => {
                  setBundleId(e.target.value);
                  resetBundleForm();
                }}
                className="h-11 px-3.5 rounded-[8px] border border-border bg-surface font-body text-body text-text-primary outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
              >
                {bundles.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.bundle_name} - stok {b.current_stock ?? 0} {b.unit}
                    {b.unit_cost && b.unit_cost > 0
                      ? ` (@${formatAngka(Math.round(b.unit_cost))}/${b.unit})`
                      : ""}
                  </option>
                ))}
              </select>
            </label>

            {/* Tabs Mobil / Motor untuk racikan */}
            <div className="flex gap-1 bg-surface-container-low border border-border rounded-[8px] p-1">
              <button
                type="button"
                onClick={() => setBundleActiveTab("mobil")}
                className={`flex-1 h-9 rounded-[6px] font-body-bold text-caption transition-colors ${
                  bundleActiveTab === "mobil"
                    ? "bg-purple-600 text-white shadow-sm"
                    : "text-text-secondary hover:bg-surface-container"
                }`}
              >
                Mobil (S, M, L, XL)
              </button>
              <button
                type="button"
                onClick={() => setBundleActiveTab("motor")}
                className={`flex-1 h-9 rounded-[6px] font-body-bold text-caption transition-colors ${
                  bundleActiveTab === "motor"
                    ? "bg-purple-600 text-white shadow-sm"
                    : "text-text-secondary hover:bg-surface-container"
                }`}
              >
                Motor (S, M, L, XL)
              </button>
            </div>

            <div className="flex flex-col gap-2">
              {renderSizeInputs(bundleActiveTab, false, bundleFormQty, setBundleFormQty)}

              <p className="font-caption text-caption text-text-muted text-center">
                Isi dalam satuan racikan
                {selectedBundle ? ` (${selectedBundle.unit})` : ""}.
                Kosong = size tersebut tidak memakai racikan ini.
              </p>

              <button
                type="button"
                disabled={sibuk || !serviceId || !bundleId}
                onClick={() => void kirimBundle(false)}
                className="flex h-11 items-center justify-center gap-2 rounded-[8px] bg-purple-600 hover:bg-purple-700 px-4 font-body-bold text-body-bold text-white transition-colors disabled:opacity-50 shadow-sm"
              >
                <Icon name="science" className="text-[20px]" />
                {sibuk ? "Menyimpan..." : "Simpan bahan racikan"}
              </button>
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
