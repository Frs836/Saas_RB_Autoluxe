"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/ui/icon";

const UKURAN = 512;
const SISI_BINGKAI = 260;

/**
 * Penentu bingkai foto profil.
 *
 * Versi sebelumnya memotong dari tengah secara otomatis, jadi wajah orang
 * yang tidak persis di tengah terpotong dahi atau dagunya tanpa ada cara
 * memperbaikinya. Di sini gambar bisa digeser dan diperbesar, dan hanya
 * bagian yang berada di dalam bingkai yang ikut tersimpan.
 *
 * Gambar selalu menutupi bingkai saat pertama dibuka. Pengguna boleh
 * memperkecil sampai seluruh gambar terlihat di dalam bingkai, tetapi tidak
 * boleh memperkecil lebih kecil dari itu karena hasilnya akan berlubang.
 */
export function AvatarCropper({
  berkas,
  onBatal,
  onSimpan,
}: {
  berkas: File;
  onBatal: () => void;
  onSimpan: (hasil: Blob) => void;
}) {
  const kanvasRef = useRef<HTMLCanvasElement>(null);
  const gambarRef = useRef<HTMLImageElement | null>(null);
  const geserRef = useRef<{ x: number; y: number } | null>(null);

  const [gambar, setGambar] = useState<{ src: string; width: number; height: number } | null>(
    null,
  );
  const [skalaAwal, setSkalaAwal] = useState(1);
  const [skala, setSkala] = useState(1);
  const [geser, setGeser] = useState({ x: 0, y: 0 });
  const [offsetAwal, setOffsetAwal] = useState({ x: 0, y: 0 });
  const [siap, setSiap] = useState(false);
  const [sibuk, setSibuk] = useState(false);
  const [galat, setGalat] = useState<string | null>(null);

  useEffect(() => {
    let hidup = true;
    const url = URL.createObjectURL(berkas);
    const img = new Image();

    img.onload = () => {
      if (!hidup) return;
      gambarRef.current = img;
      // Skala dasar dipilih agar sisi terpanjang menutupi bingkai.
      const dasar = Math.max(SISI_BINGKAI / img.width, SISI_BINGKAI / img.height);
      setSkalaAwal(dasar);
      setSkala(dasar);
      // Gambar selalu terpusat di dalam bingkai saat pertama dibuka.
      setGeser({
        x: (SISI_BINGKAI - img.width * dasar) / 2,
        y: (SISI_BINGKAI - img.height * dasar) / 2,
      });
      setGambar({ src: img.src, width: img.width, height: img.height });
      setSiap(true);
    };
    img.onerror = () => {
      if (hidup) setGalat("Gambar tidak bisa dibaca.");
    };
    img.src = url;

    return () => {
      hidup = false;
      URL.revokeObjectURL(url);
    };
  }, [berkas]);

  const mulaiGeser = (e: React.PointerEvent) => {
    if (!siap) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    geserRef.current = { x: e.clientX, y: e.clientY };
    setOffsetAwal(geser);
  };

  const geserGambar = (e: React.PointerEvent) => {
    const awal = geserRef.current;
    if (!awal) return;
    setGeser({
      x: offsetAwal.x + (e.clientX - awal.x),
      y: offsetAwal.y + (e.clientY - awal.y),
    });
  };

  const lepasGeser = () => {
    geserRef.current = null;
  };

  const simpan = async () => {
    const img = gambarRef.current;
    const kanvas = kanvasRef.current;
    if (!img || !kanvas) return;

    setSibuk(true);
    kanvas.width = UKURAN;
    kanvas.height = UKURAN;
    const k = kanvas.getContext("2d");
    if (k) {
      k.imageSmoothingQuality = "high";
      k.drawImage(
        img,
        geser.x,
        geser.y,
        img.width * skala,
        img.height * skala,
        0,
        0,
        UKURAN,
        UKURAN,
      );
    }

    const blob = await new Promise<Blob | null>((selesai) =>
      kanvas.toBlob(selesai, "image/webp", 0.85),
    );
    setSibuk(false);
    if (blob) onSimpan(blob);
    else setGalat("Gagal memproses gambar.");
  };

  const persen = Math.round((skala / skalaAwal) * 100);

  return (
    <div className="fixed inset-0 z-[70] bg-black/90 flex flex-col items-center justify-center gap-3.5 p-gutter">
      <p className="font-body-bold text-body-bold text-white">Atur Bingkai Foto</p>
      <p className="font-caption text-caption text-white/70 text-center">
        Geser foto supaya wajah berada tepat di dalam bingkai.
      </p>

      {galat ? (
        <p className="font-caption text-caption text-danger-text">{galat}</p>
      ) : null}

      <div
        className="relative overflow-hidden rounded-[20px] border-2 border-white/80 touch-none select-none"
        style={{
          width: SISI_BINGKAI,
          height: SISI_BINGKAI,
          cursor: siap ? "grab" : "wait",
        }}
        onPointerDown={mulaiGeser}
        onPointerMove={geserGambar}
        onPointerUp={lepasGeser}
        onPointerCancel={lepasGeser}
      >
        {siap && gambar ? (
          <img
            src={gambar.src}
            alt=""
            draggable={false}
            className="pointer-events-none absolute max-w-none select-none"
            style={{
              width: gambar.width * skala,
              height: gambar.height * skala,
              left: geser.x,
              top: geser.y,
            }}
          />
        ) : null}
      </div>

      <canvas ref={kanvasRef} className="hidden" />

      <div className="w-full max-w-[340px] flex flex-col gap-1.5">
        <div className="flex items-center gap-3">
          <Icon name="zoom_out" className="text-white/70 text-[18px] shrink-0" />
          <input
            type="range"
            min={100}
            max={260}
            value={persen}
            onChange={(e) => setSkala((skalaAwal * Number(e.target.value)) / 100)}
            className="flex-1 accent-white"
            aria-label="Tingkat pembesaran foto"
          />
          <Icon name="zoom_in" className="text-white/70 text-[18px] shrink-0" />
        </div>
        <span className="font-caption text-caption text-white/60 text-center">
          Pembesaran {persen}%
        </span>
      </div>

      <div className="flex gap-3 w-full max-w-[340px]">
        <button
          type="button"
          onClick={onBatal}
          className="flex-1 h-12 rounded-full bg-white/15 text-white font-body-bold text-body-bold"
        >
          Batal
        </button>
        <button
          type="button"
          disabled={!siap || sibuk}
          onClick={() => void simpan()}
          className="flex-1 h-12 rounded-full bg-brand-600 text-white font-body-bold text-body-bold disabled:opacity-60"
        >
          {sibuk ? "Memproses..." : "Pakai Foto"}
        </button>
      </div>
    </div>
  );
}
