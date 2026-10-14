"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

/*
 * Notifikasi mengambang di bagian atas layar.
 *
 * Sebelumnya pesan muncul sebagai bar di dalam halaman, di bawah form atau di
 * bawah daftar. Posisi itu mudah terlewat: orang sudah mengisi data, menekan
 * tombol, lalu tidak melihat pesannya karena harus menggulir ke bawah atau
 * tidak terlihat.
 *
 * Toast muncul di atas, tidak menutupi navigasi bawah, dan hilang sendiri.
 * Kesalahan penting tidak hilang sendiri, melainkan menetap sampai ditutup.
 */

export type ToastTone = "sukses" | "gagal" | "info" | "ingat";

export type Toast = {
  id: number;
  tone: ToastTone;
  judul: string;
  detail?: string;
  /** Berapa lama tampil sebelum hilang sendiri. */
  ms: number;
};

type ToastApi = {
  sukses: (judul: string, detail?: string) => void;
  gagal: (judul: string, detail?: string) => void;
  info: (judul: string, detail?: string) => void;
  ingat: (judul: string, detail?: string) => void;
  tutup: (id: number) => void;
};

const Konteks = createContext<ToastApi | null>(null);

const GAYA: Record<ToastTone, { kelas: string; ikon: string }> = {
  sukses: {
    kelas: "bg-success-surface text-success-text border-success-base/30",
    ikon: "check_circle",
  },
  gagal: {
    kelas: "bg-danger-surface text-danger-text border-danger-base/40",
    ikon: "error",
  },
  info: {
    kelas: "bg-surface-container-high text-text-primary border-outline-variant",
    ikon: "info",
  },
  ingat: {
    kelas: "bg-warning-surface text-warning-text border-warning-base/40",
    ikon: "warning",
  },
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const tutup = useCallback((id: number) => {
    setToasts((t) => t.filter((x) => x.id !== id));
  }, []);

  const tambah = useCallback(
    (tone: ToastTone, judul: string, detail?: string) => {
      const id = Date.now() + Math.random();
      // Kesalahan tidak hilang sendiri. Kalau hilang begitu saja, orang tidak
      // sempat membaca penyebabnya dan cuma melihat form yang tidak berubah.
      const ms = tone === "gagal" || tone === "ingat" ? 12_000 : 4_500;
      setToasts((t) => [...t.slice(-3), { id, tone, judul, detail, ms }]);
    },
    [],
  );

  const api = useMemo<ToastApi>(
    () => ({
      sukses: (j, d) => tambah("sukses", j, d),
      gagal: (j, d) => tambah("gagal", j, d),
      info: (j, d) => tambah("info", j, d),
      ingat: (j, d) => tambah("ingat", j, d),
      tutup,
    }),
    [tambah, tutup],
  );

  return (
    <Konteks.Provider value={api}>
      {children}
      <Toaster toasts={toasts} onTutup={tutup} />
    </Konteks.Provider>
  );
}

function Toaster({
  toasts,
  onTutup,
}: {
  toasts: Toast[];
  onTutup: (id: number) => void;
}) {
  return (
    <div
      aria-live="polite"
      aria-atomic="false"
      className="fixed top-0 left-0 right-0 z-[100] pointer-events-none flex flex-col gap-2 px-3 pt-[calc(env(safe-area-inset-top)+8px)] items-center"
    >
      {toasts.map((t) => (
        <ToastBar key={t.id} toast={t} onTutup={onTutup} />
      ))}
    </div>
  );
}

function ToastBar({ toast, onTutup }: { toast: Toast; onTutup: (id: number) => void }) {
  useEffect(() => {
    if (toast.tone === "gagal" || toast.tone === "ingat") return;
    const id = window.setTimeout(() => onTutup(toast.id), toast.ms);
    return () => window.clearTimeout(id);
  }, [toast, onTutup]);

  const gaya = GAYA[toast.tone];

  return (
    <div
      role="alert"
      className={`pointer-events-auto w-full max-w-md rounded-2xl border px-3.5 py-3 shadow-lg flex items-start gap-2.5 ${gaya.kelas}`}
    >
      <span className="material-symbols-outlined text-[20px] shrink-0 mt-0.5">
        {gaya.ikon}
      </span>
      <div className="flex-1 min-w-0">
        <p className="font-body-bold text-body-bold">{toast.judul}</p>
        {toast.detail ? (
          <p className="font-caption text-caption mt-0.5 break-words">{toast.detail}</p>
        ) : null}
      </div>
      <button
        type="button"
        onClick={() => onTutup(toast.id)}
        aria-label="Tutup notifikasi"
        className="shrink-0 grid place-items-center w-8 h-8 -m-1 rounded-full"
      >
        <span className="material-symbols-outlined text-[18px]">close</span>
      </button>
    </div>
  );
}

export function useToast(): ToastApi {
  const api = useContext(Konteks);
  if (!api) {
    // Halaman yang belum dibungkus ToastProvider tetap bisa memanggilnya tanpa
    // gagal diam-diam. Pesan hilang, tapi aplikasi tidak ikut rusak.
    return {
      sukses: () => undefined,
      gagal: () => undefined,
      info: () => undefined,
      ingat: () => undefined,
      tutup: () => undefined,
    };
  }
  return api;
}