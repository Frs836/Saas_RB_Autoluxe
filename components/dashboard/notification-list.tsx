"use client";

import Link from "next/link";
import { useCallback, useMemo, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/toast";
import { Icon } from "@/components/ui/icon";
import { Modal } from "@/components/ui/modal";

export type BarisNotifikasi = {
  id: string;
  title: string;
  body: string | null;
  category: string | null;
  is_read: boolean | null;
  payload: Record<string, unknown> | null;
  created_at: string;
};

type Saring = "semua" | "belum" | "sudah";

const IKON_KATEGORI: Record<string, string> = {
  order: "car_repair",
  stock: "inventory_2",
  shift: "schedule",
  cash: "payments",
  face: "face",
  account: "person",
  time_off: "event_busy",
};

const LABEL_KATEGORI: Record<string, string> = {
  order: "Order",
  stock: "Stok",
  shift: "Shift",
  cash: "Kas",
  face: "Wajah",
  account: "Akun",
  time_off: "Izin",
};

/** Mengubah waktu ISO menjadi keterangan relatif, hanya untuk sisi klien. */
function waktuPendek(iso: string): string {
  const d = new Date(iso);
  const selisih = Date.now() - d.getTime();
  const menit = Math.floor(selisih / 60_000);
  if (menit < 1) return "Baru saja";
  if (menit < 60) return `${menit} menit lalu`;
  const jam = Math.floor(menit / 60);
  if (jam < 24) return `${jam} jam lalu`;
  return d.toLocaleDateString("id-ID", { day: "2-digit", month: "short" });
}

/*
 * Waktu relatif memakai useSyncExternalStore, bukan useEffect.
 *
 * Nilai "3 menit lalu" bergantung pada jam sekarang. Kalau dihitung saat
 * render biasa, server memakai jam server dan browser memakai jam perangkat.
 * Selisih beberapa detik sudah cukup untuk membuat teks berganti dari
 * "Baru saja" jadi "1 menit lalu", sehingga pohon hasil render server tidak
 * sama dengan yang diharap React dan muncul galat hidrasi.
 *
 * useSyncExternalStore memang dirancang untuk kasus ini: snapshot di server
 * dikembalikan kosong, snapshot di browser mengembalikan waktu sebenarnya.
 * React memakai nilai server untuk render pertama lalu menukarnya setelah
 * menempel, tanpa perlu setState di dalam efek.
 */
const SNAPSHOT_KOSONG = () => "";
const TANPA_LANGGANAN = () => () => {};

function WaktuRelatif({ iso }: { iso: string }) {
  const snapshot = useCallback(() => waktuPendek(iso), [iso]);
  const teks = useSyncExternalStore(TANPA_LANGGANAN, snapshot, SNAPSHOT_KOSONG);
  return <>{teks}</>;
}

/**
 * Halaman notifikasi penuh.
 *
 * Sebelumnya notifikasi hanya muncul sebagai panel yang menutupi header saat
 * ikon lonceng ditekan. Isinya tidak lengkap, tidak ada pencarian, dan tidak
 * ada tempat untuk menjalankan tindakan yang perlu notifikasi.
 */
export function NotificationList({
  awal,
  bisaTandaiSemua,
}: {
  awal: BarisNotifikasi[];
  bisaTandaiSemua: boolean;
  role: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const [baris, setBaris] = useState<BarisNotifikasi[]>(awal);
  const [saring, setSaring] = useState<Saring>("semua");
  const [cari, setCari] = useState("");
  const [terbuka, setTerbuka] = useState<string | null>(null);
  const [sibuk, setSibuk] = useState(false);

  const belumDibaca = useMemo(() => baris.filter((b) => !b.is_read).length, [baris]);

  const terlihat = useMemo(() => {
    const q = cari.trim().toLowerCase();
    return baris.filter((b) => {
      if (saring === "belum" && b.is_read) return false;
      if (saring === "sudah" && !b.is_read) return false;
      if (!q) return true;
      return `${b.title} ${b.body ?? ""}`.toLowerCase().includes(q);
    });
  }, [baris, saring, cari]);

  const detail = baris.find((b) => b.id === terbuka) ?? null;

  const tandaiDibaca = useCallback(
    async (id: string) => {
      setBaris((prev) => prev.map((b) => (b.id === id ? { ...b, is_read: true } : b)));
      const supabase = createClient();
      const { error } = await supabase.from("notifications").update({ is_read: true }).eq("id", id);
      if (error) {
        toast.gagal("Notifikasi gagal ditandai", `Penyebab: ${error.message}`);
        setBaris((prev) => prev.map((b) => (b.id === id ? { ...b, is_read: false } : b)));
      }
      router.refresh();
    },
    [router, toast],
  );

  const tandaiSemua = useCallback(async () => {
    if (sibuk) return;
    setSibuk(true);
    toast.info("Menandai semua notifikasi", "Menyimpan perubahan.");
    try {
      const supabase = createClient();
      const belum = baris.filter((b) => !b.is_read).map((b) => b.id);
      if (belum.length === 0) {
        toast.info("Tidak ada yang perlu ditandai", "Semua notifikasi sudah dibaca.");
        return;
      }
      const { error } = await supabase
        .from("notifications")
        .update({ is_read: true })
        .in("id", belum);
      if (error) throw new Error(error.message);
      setBaris((prev) => prev.map((b) => ({ ...b, is_read: true })));
      toast.sukses("Semua notifikasi ditandai dibaca", `${belum.length} pesan diperbarui.`);
      router.refresh();
    } catch (e) {
      toast.gagal(
        "Penandaan gagal",
        `Penyebab: ${e instanceof Error ? e.message : "koneksi terputus"}. Tidak ada perubahan yang disimpan.`,
      );
    } finally {
      setSibuk(false);
    }
  }, [baris, router, sibuk, toast]);

  return (
    <div className="px-gutter lg:px-6 pt-4 lg:pt-6 pb-nav-plain lg:pb-8 flex flex-col gap-3">
      <header className="flex items-start justify-between gap-2">
        <div>
          <h1 className="font-headline-1 text-headline-1 text-text-primary">Notifikasi</h1>
          <p className="font-caption text-caption text-text-secondary">
            {belumDibaca > 0 ? `${belumDibaca} belum dibaca` : "Semua sudah dibaca"}
          </p>
        </div>
        {bisaTandaiSemua && belumDibaca > 0 ? (
          <button
            type="button"
            onClick={tandaiSemua}
            disabled={sibuk}
            className="h-11 px-3.5 rounded-[8px] border border-border bg-surface text-text-secondary font-caption text-caption hover:bg-surface-container transition-colors disabled:opacity-60"
          >
            {sibuk ? "Menyimpan..." : "Tandai semua"}
          </button>
        ) : null}
      </header>

      <input
        type="search"
        value={cari}
        onChange={(e) => setCari(e.target.value)}
        placeholder="Cari notifikasi..."
        className="h-11 px-3.5 rounded-[8px] border border-border bg-surface font-body text-body text-text-primary outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
      />

      <div className="flex gap-2">
        {(
          [
            ["semua", `Semua ${baris.length}`],
            ["belum", `Belum dibaca ${belumDibaca}`],
            ["sudah", "Sudah dibaca"],
          ] as [Saring, string][]
        ).map(([nilai, label]) => (
          <button
            key={nilai}
            type="button"
            onClick={() => setSaring(nilai)}
            className={`px-3.5 h-10 rounded-[8px] font-caption text-caption transition-colors ${
              saring === nilai
                ? "primary-gradient clay-glow text-white"
                : "border border-border bg-surface text-text-secondary hover:bg-surface-container"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {terlihat.length === 0 ? (
        <p className="rounded-[10px] clay-card p-6 text-center font-caption text-caption text-text-secondary">
          {cari.trim() !== ""
            ? `Tidak ada notifikasi yang cocok dengan ${cari.trim()}.`
            : "Belum ada notifikasi pada filter ini."}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {terlihat.map((b) => (
            <li key={b.id}>
              <button
                type="button"
                onClick={() => {
                  setTerbuka(b.id);
                  if (!b.is_read) void tandaiDibaca(b.id);
                }}
                className={`w-full text-left rounded-[10px] clay-card p-3.5 flex items-start gap-3 hover:bg-surface-container transition-colors ${
                  b.is_read ? "opacity-75" : ""
                }`}
              >
                {!b.is_read ? (
                  <span
                    aria-label="Belum dibaca"
                    className="mt-1 w-2.5 h-2.5 rounded-full bg-brand-500 shrink-0 shadow-sm"
                  />
                ) : (
                  <span className="mt-1 w-2.5 h-2.5 shrink-0" />
                )}
                <span className="flex-1 min-w-0 flex flex-col gap-0.5">
                  <span className="flex items-center gap-1.5">
                    <Icon name={IKON_KATEGORI[b.category ?? ""] ?? "notifications"} className="text-[16px] text-text-muted" />
                    <span className="font-micro-badge text-micro-badge text-text-muted">
                      {LABEL_KATEGORI[b.category ?? ""] ?? "Umum"}
                    </span>
                  </span>
                  <span className="font-body-bold text-body-bold text-text-primary">
                    {b.title}
                  </span>
                  {b.body ? (
                    <span className="font-caption text-caption text-text-secondary line-clamp-2">
                      {b.body}
                    </span>
                  ) : null}
                  <span className="font-micro-badge text-micro-badge text-text-muted">
                    {<WaktuRelatif iso={b.created_at} />}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {detail ? <DetailNotifikasi baris={detail} onTutup={() => setTerbuka(null)} /> : null}
    </div>
  );
}

/**
 * Detail notifikasi dengan tombol eksekusi.
 *
 * Sebagian notifikasi menuntut tindakan, misalnya unit baru masuk workshop tapi
 * belum dikerjakan. Menampilkan isi pesan saja membuat orang mencari-cari di
 * halaman lain. Di sini pesan dibuka penuh dan tindakan yang relevan
 * sebagai tombol.
 */
function DetailNotifikasi({
  baris,
  onTutup,
}: {
  baris: BarisNotifikasi;
  onTutup: () => void;
}) {
  const router = useRouter();
  const toast = useToast();
  const [sibuk, setSibuk] = useState(false);
  const payload = baris.payload ?? {};
  const orderId = typeof payload.order_id === "string" ? payload.order_id : null;
  const statusOrder = typeof payload.order_status === "string" ? payload.order_status : null;

  // Order yang belum dikerjakan bisa langsung dimulai dari sini.
  const bisaMulai = Boolean(orderId) && (statusOrder === "queued" || statusOrder === null);

  async function mulaiPengerjaan() {
    if (!orderId || sibuk) return;
    setSibuk(true);
    toast.info("Memulai pengerjaan", "Mengirim permintaan ke server.");
    try {
      const supabase = createClient();
      const { error } = await supabase.rpc("start_order_work", { p_order_id: orderId });
      if (error) {
        toast.gagal(
          "Pengerjaan gagal dimulai",
          `Penyebab: ${error.message}. Order tetap berstatus ${statusOrder ?? "antre"}.`,
        );
        return;
      }
      toast.sukses("Pengerjaan dimulai", "Order sudah masuk antrean pengerjaan dan tercatat di laporan.");
      onTutup();
      router.push(`/pos/orders/${orderId}`);
      router.refresh();
    } catch (e) {
      toast.gagal(
        "Pengerjaan gagal dikirim",
        `Penyebab: ${e instanceof Error ? e.message : "koneksi terputus"}.`,
      );
    } finally {
      setSibuk(false);
    }
  }

  return (
    <Modal open={true} onClose={onTutup} title={baris.title}>
      <div
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Escape") onTutup();
        }}
        className="w-full sm:max-w-lg bg-surface rounded-t-[10px] sm:rounded-[10px] border border-border shadow-2xl p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] flex flex-col gap-3 max-h-[85vh] overflow-y-auto"
      >
        <div className="flex items-start justify-between gap-2">
          <div className="flex flex-col gap-1">
            <span className="font-micro-badge text-micro-badge text-text-muted">
              {LABEL_KATEGORI[baris.category ?? ""] ?? "Umum"} - <WaktuRelatif iso={baris.created_at} />
            </span>
            <h2 className="font-headline-2 text-headline-2 text-text-primary">{baris.title}</h2>
          </div>
          <button
            type="button"
            onClick={onTutup}
            aria-label="Tutup"
            className="grid place-items-center w-10 h-10 rounded-[8px] border border-border bg-surface text-text-secondary hover:bg-surface-container transition-colors"
          >
            <Icon name="close" className="text-[20px]" />
          </button>
        </div>

        <p className="font-body text-body text-text-secondary whitespace-pre-wrap">
          {baris.body ?? "Tidak ada keterangan tambahan."}
        </p>

        <div className="flex flex-col gap-2">
          {orderId ? (
            <Link
              href={`/pos/orders/${orderId}`}
              onClick={onTutup}
              className="h-11 rounded-[8px] border border-border bg-surface text-text-primary font-caption text-caption flex items-center justify-center gap-2 hover:bg-surface-container transition-colors"
            >
              <Icon name="receipt_long" className="text-[18px]" />
              Buka detail order
            </Link>
          ) : null}

          {bisaMulai ? (
            <button
              type="button"
              onClick={mulaiPengerjaan}
              disabled={sibuk}
              className="h-11 rounded-[8px] primary-gradient clay-glow text-white font-body-bold text-body-bold flex items-center justify-center gap-2 hover:opacity-90 transition-opacity disabled:opacity-60"
            >
              <Icon name={sibuk ? "hourglass_top" : "play_arrow"} className="text-[18px]" />
              {sibuk ? "Mengirim..." : "Kerjakan sekarang"}
            </button>
          ) : null}

          {!bisaMulai && !orderId ? (
            <p className="font-caption text-caption text-text-muted text-center">
              Notifikasi ini hanya perlu dibaca, tidak ada tindakan yang perlu
              dijalankan.
            </p>
          ) : null}
        </div>
      </div>
    </Modal>
  );
}