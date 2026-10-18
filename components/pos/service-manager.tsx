"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { CATEGORY_ICONS, CATEGORY_LABELS } from "@/lib/pos";
import { formatRupiah } from "@/lib/format";
import { Icon } from "@/components/ui/icon";

export type ServiceRow = {
  id: string;
  name: string;
  category: string;
  priceS: number;
  priceM: number;
  priceL: number;
  priceXL: number;
  priceMotor: number;
  priceMotorS: number;
  priceMotorM: number;
  priceMotorL: number;
  priceMotorXL: number;
  isAddon: boolean;
  isActive: boolean;
};

type Draft = Omit<ServiceRow, "id">;

const KOSONG: Draft = {
  name: "",
  category: "wash",
  priceS: 0,
  priceM: 0,
  priceL: 0,
  priceXL: 0,
  priceMotor: 0,
  priceMotorS: 0,
  priceMotorM: 0,
  priceMotorL: 0,
  priceMotorXL: 0,
  isAddon: false,
  isActive: true,
};

/* Kolom harga sesuai urutan tampil di POS: mobil S/M/L/XL lalu motor S/M/L/XL. */
const HARGA: { key: keyof Draft; label: string; grup: string }[] = [
  { key: "priceS", label: "Mobil S", grup: "mobil" },
  { key: "priceM", label: "Mobil M", grup: "mobil" },
  { key: "priceL", label: "Mobil L", grup: "mobil" },
  { key: "priceXL", label: "Mobil XL", grup: "mobil" },
  { key: "priceMotorS", label: "Motor S", grup: "motor" },
  { key: "priceMotorM", label: "Motor M", grup: "motor" },
  { key: "priceMotorL", label: "Motor L", grup: "motor" },
  { key: "priceMotorXL", label: "Motor XL", grup: "motor" },
];

/**
 * Manajemen jasa POS: tambah, ubah nama, harga per ukuran, dan status aktif.
 *
 * Daftar disiarkan realtime lewat kanal services. Kalau kasir lain mengubah
 * harga, barisnya ikut berubah di layar ini tanpa perlu refresh. Penulisannya
 * lewat RPC set_service dan delete_service supaya validasi harga dan jejak
 * audit berada di server, bukan bisa dilewati dari browser.
 */
export function ServiceManager({
  initialServices,
}: {
  initialServices: ServiceRow[];
}) {
  const supabase = useMemo(() => createClient(), []);
  const [services, setServices] = useState<ServiceRow[]>(initialServices);
  const [cari, setCari] = useState("");
  const [kategori, setKategori] = useState("all");
  const [saringAktif, setSaringAktif] = useState<"all" | "active" | "inactive">("all");
  const [sunting, setSunting] = useState<ServiceRow | null>(null);
  const [draft, setDraft] = useState<Draft>(KOSONG);
  const [buatBaru, setBuatBaru] = useState(false);
  const [sibuk, setSibuk] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sukses, setSukses] = useState<string | null>(null);

  // Realtime: kanal services perubahan katalog, termasuk yang ditulis dari
  // perangkat lain. Payload dipetakan ulang karena bentuknya sama dengan baris
  // tabel, sedangkan state memakai angka untuk perhitungan.
  useEffect(() => {
    const kanal = supabase
      .channel("katalog-jasa")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "services" },
        (payload) => {
          const next = payload.new as Record<string, unknown>;
          const baru: ServiceRow = {
            id: next.id as string,
            name: (next.name as string) ?? "",
            category: (next.category as string) ?? "wash",
            priceS: Number(next.price_s ?? 0),
            priceM: Number(next.price_m ?? 0),
            priceL: Number(next.price_l ?? 0),
            priceXL: Number(next.price_xl ?? 0),
            priceMotor: Number(next.price_motor ?? 0),
            priceMotorS: Number(next.price_motor_s ?? 0),
            priceMotorM: Number(next.price_motor_m ?? 0),
            priceMotorL: Number(next.price_motor_l ?? 0),
            priceMotorXL: Number(next.price_motor_xl ?? 0),
            isAddon: Boolean(next.is_addon),
            isActive: Boolean(next.is_active),
          };
          setServices((prev) => {
            const ada = prev.some((s) => s.id === baru.id);
            const hasil = ada
              ? prev.map((s) => (s.id === baru.id ? baru : s))
              : [...prev, baru];
            return hasil.sort((a, b) =>
              a.category === b.category
                ? a.name.localeCompare(b.name, "id")
                : a.category.localeCompare(b.category, "id"),
            );
          });
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(kanal);
    };
  }, [supabase]);

  const tersaring = useMemo(() => {
    const q = cari.trim().toLowerCase();
    return services.filter((s) => {
      if (kategori !== "all" && s.category !== kategori) return false;
      if (saringAktif === "active" && !s.isActive) return false;
      if (saringAktif === "inactive" && s.isActive) return false;
      if (!q) return true;
      return s.name.toLowerCase().includes(q);
    });
  }, [services, cari, kategori, saringAktif]);

  const jumlahHarga = useMemo(
    () =>
      tersaring.reduce(
        (total, s) => total + HARGA.reduce((j, h) => j + (s[h.key] as number), 0),
        0,
      ),
    [tersaring],
  );

  function bukaSunting(row: ServiceRow) {
    setBuatBaru(false);
    setSunting(row);
    setDraft({
      name: row.name,
      category: row.category,
      priceS: row.priceS,
      priceM: row.priceM,
      priceL: row.priceL,
      priceXL: row.priceXL,
      priceMotor: row.priceMotor,
      priceMotorS: row.priceMotorS,
      priceMotorM: row.priceMotorM,
      priceMotorL: row.priceMotorL,
      priceMotorXL: row.priceMotorXL,
      isAddon: row.isAddon,
      isActive: row.isActive,
    });
    setError(null);
    setSukses(null);
  }

  function bukaBaru() {
    setSunting(null);
    setBuatBaru(true);
    setDraft({ ...KOSONG });
    setError(null);
    setSukses(null);
  }

  function tutup() {
    setSunting(null);
    setBuatBaru(false);
    setError(null);
  }

  async function simpan() {
    if (sibuk) return;
    if (draft.name.trim().length < 3) {
      setError("Nama jasa minimal 3 karakter.");
      return;
    }

    setSibuk(true);
    setError(null);
    setSukses(null);

    const { error: rpcError } = await supabase.rpc("set_service", {
      p_service_id: sunting?.id ?? null,
      p_name: draft.name.trim(),
      p_category: draft.category,
      p_price_s: draft.priceS,
      p_price_m: draft.priceM,
      p_price_l: draft.priceL,
      p_price_xl: draft.priceXL,
      p_price_motor: draft.priceMotor,
      p_price_motor_s: draft.priceMotorS,
      p_price_motor_m: draft.priceMotorM,
      p_price_motor_l: draft.priceMotorL,
      p_price_motor_xl: draft.priceMotorXL,
      p_is_addon: draft.isAddon,
      p_is_active: draft.isActive,
    });

    setSibuk(false);

    if (rpcError) {
      setError(rpcError.message);
      return;
    }

    // Daftar tidak di optimasi manual supaya nilainya sama persis dengan yang
    // disimpan server, termasuk harga motor yang dihitung ulang dari harga
    // lama saat kolom per ukurannya masih nol.
    const { data } = await supabase
      .from("services")
      .select(
        "id, name, category, price_s, price_m, price_l, price_xl, price_motor, price_motor_s, price_motor_m, price_motor_l, price_motor_xl, is_addon, is_active",
      )
      .order("category", { ascending: true })
      .order("name", { ascending: true });

    setServices(
      (data ?? []).map((row) => ({
        id: row.id as string,
        name: (row.name as string) ?? "",
        category: (row.category as string) ?? "wash",
        priceS: Number(row.price_s ?? 0),
        priceM: Number(row.price_m ?? 0),
        priceL: Number(row.price_l ?? 0),
        priceXL: Number(row.price_xl ?? 0),
        priceMotor: Number(row.price_motor ?? 0),
        priceMotorS: Number(row.price_motor_s ?? 0),
        priceMotorM: Number(row.price_motor_m ?? 0),
        priceMotorL: Number(row.price_motor_l ?? 0),
        priceMotorXL: Number(row.price_motor_xl ?? 0),
        isAddon: Boolean(row.is_addon),
        isActive: Boolean(row.is_active),
      })),
    );

    setSukses(
      sunting ? "Jasa diperbarui." : "Jasa baru ditambahkan dan langsung tampil di POS.",
    );
    setSunting(null);
    setBuatBaru(false);
  }

  async function ubahAktif(row: ServiceRow) {
    if (sibuk) return;
    setSibuk(true);
    setError(null);
    const { error: rpcError } = await supabase.rpc("set_service", {
      p_service_id: row.id,
      p_name: row.name,
      p_category: row.category,
      p_price_s: row.priceS,
      p_price_m: row.priceM,
      p_price_l: row.priceL,
      p_price_xl: row.priceXL,
      p_price_motor: row.priceMotor,
      p_price_motor_s: row.priceMotorS,
      p_price_motor_m: row.priceMotorM,
      p_price_motor_l: row.priceMotorL,
      p_price_motor_xl: row.priceMotorXL,
      p_is_addon: row.isAddon,
      p_is_active: !row.isActive,
    });
    setSibuk(false);
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    setSukses(row.isActive ? "Jasa dinonaktifkan." : "Jasa diaktifkan kembali.");
  }

  async function hapus(row: ServiceRow) {
    if (sibuk) return;
    const ya = window.confirm(
      `Hapus jasa "${row.name}"? Jasa ini hilang dari katalog POS. Order yang sudah terlanjur memakai jasa ini tetap menyimpan nama dan harga saat pembelian.`,
    );
    if (!ya) return;

    setSibuk(true);
    setError(null);
    const { error: rpcError } = await supabase.rpc("delete_service", {
      p_service_id: row.id,
    });
    setSibuk(false);
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    setServices((prev) => prev.filter((s) => s.id !== row.id));
    setSukses(`Jasa "${row.name}" dihapus dari katalog.`);
  }

  const bukaPanel = sunting !== null || buatBaru;

  return (
    <main className="flex-1 px-gutter pt-4 pb-nav flex flex-col gap-3">
      <div className="grid grid-cols-3 gap-2">
        <div className="clay-card p-3 flex flex-col items-center gap-0.5">
          <span className="font-headline-2 text-headline-2 text-text-primary">
            {tersaring.length}
          </span>
          <span className="font-caption text-caption text-text-muted">Jasa</span>
        </div>
        <div className="clay-card p-3 flex flex-col items-center gap-0.5">
          <span className="font-headline-2 text-headline-2 text-success-text">
            {tersaring.filter((s) => s.isActive).length}
          </span>
          <span className="font-caption text-caption text-text-muted">Aktif</span>
        </div>
        <div className="clay-card p-3 flex flex-col items-center gap-0.5">
          <span className="font-headline-2 text-headline-2 text-brand-600">
            {formatRupiah(jumlahHarga)}
          </span>
          <span className="font-caption text-caption text-text-muted">
            Total Harga
          </span>
        </div>
      </div>

      <div className="relative">
        <Icon
          name="search"
          className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted text-[20px]"
        />
        <input
          value={cari}
          onChange={(e) => setCari(e.target.value)}
          type="search"
          placeholder="Cari nama jasa..."
          className="w-full h-12 pl-11 pr-4 rounded-2xl bg-surface text-body text-text-primary outline-none focus:ring-2 focus:ring-brand-400"
        />
      </div>

      <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
        <button
          type="button"
          onClick={() => setKategori("all")}
          className={`shrink-0 min-h-10 px-3.5 rounded-full font-body-bold text-body-bold active:scale-95 transition-transform ${
            kategori === "all"
              ? "bg-brand-600 text-white"
              : "bg-surface text-text-secondary"
          }`}
        >
          Semua
        </button>
        {Object.keys(CATEGORY_LABELS).map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => setKategori(key)}
            className={`shrink-0 min-h-10 px-3.5 rounded-full font-body-bold text-body-bold active:scale-95 transition-transform ${
              kategori === key
                ? "bg-brand-600 text-white"
                : "bg-surface text-text-secondary"
            }`}
          >
            {CATEGORY_LABELS[key]}
          </button>
        ))}
      </div>

      <div className="flex gap-2">
        {(
          [
            { key: "all", label: "Semua Status" },
            { key: "active", label: "Aktif" },
            { key: "inactive", label: "Nonaktif" },
          ] as const
        ).map((s) => (
          <button
            key={s.key}
            type="button"
            onClick={() => setSaringAktif(s.key)}
            className={`flex-1 min-h-10 rounded-xl font-caption text-caption active:scale-95 transition-transform ${
              saringAktif === s.key
                ? "bg-brand-50 text-brand-700"
                : "bg-surface-container text-text-secondary"
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      {error ? (
        <div className="p-3 rounded-xl bg-danger-surface text-danger-text font-caption text-caption flex items-start gap-2">
          <Icon name="error" className="text-[18px] shrink-0" />
          <span className="flex-1">{error}</span>
        </div>
      ) : null}

      {sukses ? (
        <div className="p-3 rounded-xl bg-success-surface text-success-text font-caption text-caption flex items-center gap-2">
          <Icon name="check_circle" className="text-[18px] shrink-0" />
          <span className="flex-1">{sukses}</span>
        </div>
      ) : null}

      {tersaring.length === 0 ? (
        <div className="clay-card p-6 flex flex-col items-center text-center gap-2">
          <Icon name="inventory_2" className="text-[32px] text-text-muted" />
          <p className="font-body text-body text-text-secondary">
            Tidak ada jasa yang cocok dengan filter ini.
          </p>
        </div>
      ) : null}

      {tersaring.map((row) => (
        <article key={row.id} className="clay-card p-4 flex flex-col gap-2">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <p className="font-body-bold text-body-bold text-text-primary">
                {row.name}
              </p>
              <p className="font-caption text-caption text-text-muted">
                {CATEGORY_LABELS[row.category] ?? row.category}
                {row.isAddon ? " • Tambahan" : ""}
              </p>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <Icon
                name={CATEGORY_ICONS[row.category] ?? "build"}
                className="text-brand-600 text-[20px]"
              />
              <span
                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-micro-badge text-micro-badge ${
                  row.isActive
                    ? "bg-success-surface text-success-text"
                    : "bg-surface-container text-text-muted"
                }`}
              >
                {row.isActive ? "Aktif" : "Nonaktif"}
              </span>
            </div>
          </div>

          {/* Harga per ukuran ditampilkan ringkas supaya kasir bisa
              Membandingkan tanpa membuka form. */}
          <div className="flex flex-wrap gap-1.5">
            {HARGA.map((h) => {
              const nilai = row[h.key] as number;
              return (
                <span
                  key={String(h.key)}
                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-lg font-micro-badge text-micro-badge ${
                    nilai > 0
                      ? "bg-surface-container text-text-secondary"
                      : "bg-surface-container/50 text-text-muted line-through"
                  }`}
                >
                  {h.label}
                  <span className="font-body-mono">
                    {nilai > 0 ? formatRupiah(nilai) : "0"}
                  </span>
                </span>
              );
            })}
          </div>

          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={() => bukaSunting(row)}
              className="flex-1 min-h-11 rounded-xl bg-brand-50 text-brand-700 font-caption text-caption flex items-center justify-center gap-1.5 active:scale-95 transition-transform"
            >
              <Icon name="edit_note" className="text-[18px]" />
              Ubah
            </button>
            <button
              type="button"
              disabled={sibuk}
              onClick={() => void ubahAktif(row)}
              className={`flex-1 min-h-11 rounded-xl font-caption text-caption flex items-center justify-center gap-1.5 active:scale-95 transition-transform disabled:opacity-60 ${
                row.isActive
                  ? "bg-surface-container text-text-secondary"
                  : "bg-success-surface text-success-text"
              }`}
            >
              <Icon
                name={row.isActive ? "block" : "task_alt"}
                className="text-[18px]"
              />
              {row.isActive ? "Nonaktifkan" : "Aktifkan"}
            </button>
            <button
              type="button"
              disabled={sibuk}
              onClick={() => void hapus(row)}
              className="min-w-11 px-3 min-h-11 rounded-xl bg-danger-surface text-danger-text font-caption text-caption flex items-center justify-center gap-1.5 active:scale-95 transition-transform disabled:opacity-60"
            >
              <Icon name="delete" className="text-[18px]" />
            </button>
          </div>
        </article>
      ))}

      <div className="h-1" />

      {/* Panel tambah dan ubah berbagi satu formulir supaya aturan validasi
          hanya ada di satu tempat. */}
      {!bukaPanel ? (
        <button
          type="button"
          onClick={bukaBaru}
          className="w-full h-12 rounded-2xl primary-gradient text-white font-body-bold text-body-bold flex items-center justify-center gap-2 clay-glow active:scale-[0.98] transition-transform"
        >
          <Icon name="add" className="text-[20px]" />
          Tambah Jasa Baru
        </button>
      ) : null}

      {bukaPanel ? (
        <section className="clay-card p-4 flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h2 className="font-headline-3 text-headline-3 text-text-primary">
              {sunting ? "Ubah Jasa" : "Jasa Baru"}
            </h2>
            <button
              type="button"
              onClick={tutup}
              aria-label="Tutup"
              className="w-9 h-9 rounded-xl bg-surface-container-low flex items-center justify-center text-text-secondary active:scale-95"
            >
              <Icon name="close" className="text-[20px]" />
            </button>
          </div>

          <label className="flex flex-col gap-1">
            <span className="font-micro-badge text-micro-badge text-text-muted">
              Nama Jasa
            </span>
            <input
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              placeholder="Contoh: Coating Paket C - 5 Layers"
              className="h-12 px-3 rounded-xl bg-surface-container font-body text-body text-text-primary outline-none focus:ring-2 focus:ring-brand-400"
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="font-micro-badge text-micro-badge text-text-muted">
              Kategori
            </span>
            <select
              value={draft.category}
              onChange={(e) => setDraft({ ...draft, category: e.target.value })}
              className="h-12 px-3 rounded-xl bg-surface-container font-body text-body text-text-primary outline-none focus:ring-2 focus:ring-brand-400"
            >
              {Object.keys(CATEGORY_LABELS).map((key) => (
                <option key={key} value={key}>
                  {CATEGORY_LABELS[key]}
                </option>
              ))}
            </select>
          </label>

          {/* Harga per ukuran. Nol berarti layanan tidak tersedia untuk
              ukuran itu, jadi kosong lebih mudah daripada mengetik nol. */}
          <div className="flex flex-col gap-2">
            <p className="font-body-bold text-caption text-text-secondary">
              Harga per Ukuran
            </p>
            <div className="grid grid-cols-2 gap-2">
              {HARGA.map((h) => (
                <label key={String(h.key)} className="flex flex-col gap-1">
                  <span className="font-micro-badge text-micro-badge text-text-muted">
                    {h.label}
                  </span>
                  <input
                    value={
                      (draft[h.key] as number) === 0
                        ? ""
                        : String(draft[h.key])
                    }
                    onChange={(e) => {
                      const v = e.target.value.replace(/\D/g, "");
                      setDraft({
                        ...draft,
                        [h.key]: v === "" ? 0 : Math.min(Number(v), 100000000),
                      });
                    }}
                    inputMode="numeric"
                    placeholder="0"
                    className="h-11 px-3 rounded-xl bg-surface-container font-body-mono text-body text-text-primary outline-none focus:ring-2 focus:ring-brand-400"
                  />
                </label>
              ))}
            </div>
            <p className="font-micro-badge text-micro-badge text-text-muted">
              Kosong berarti 0, layanan tidak dijual untuk ukuran tersebut.
            </p>
          </div>

          <div className="flex gap-2">
            <label className="flex-1 flex items-center gap-2 px-3 py-2.5 rounded-xl bg-surface-container">
              <input
                type="checkbox"
                checked={draft.isAddon}
                onChange={(e) =>
                  setDraft({ ...draft, isAddon: e.target.checked })
                }
                className="w-5 h-5 accent-[#1D4ED8]"
              />
              <span className="font-caption text-caption text-text-secondary">
                Layanan tambahan
              </span>
            </label>
            <label className="flex-1 flex items-center gap-2 px-3 py-2.5 rounded-xl bg-surface-container">
              <input
                type="checkbox"
                checked={draft.isActive}
                onChange={(e) =>
                  setDraft({ ...draft, isActive: e.target.checked })
                }
                className="w-5 h-5 accent-[#1D4ED8]"
              />
              <span className="font-caption text-caption text-text-secondary">
                Aktif di POS
              </span>
            </label>
          </div>

          <button
            type="button"
            disabled={sibuk}
            onClick={() => void simpan()}
            className="w-full h-12 rounded-2xl primary-gradient text-white font-body-bold text-body-bold flex items-center justify-center gap-2 clay-glow active:scale-[0.98] transition-transform disabled:opacity-60"
          >
            <Icon name={sibuk ? "hourglass_top" : "task_alt"} className="text-[20px]" />
            {sibuk ? "Menyimpan..." : sunting ? "Simpan Perubahan" : "Simpan Jasa"}
          </button>
        </section>
      ) : null}
    </main>
  );
}