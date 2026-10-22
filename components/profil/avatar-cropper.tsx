"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/ui/icon";

const UKURAN_OUTPUT = 512;
const SISI_BINGKAI = 200;
const PREVIEW_SIZE = 80;

/**
 * Penentu bingkai foto profil.
 *
 * Frame cropper 200×200px (nyaman edit mobile), preview live 80×80px
 * persis mirip avatar holder: rounded-[20px], border 1px, aspect 1:1.
 * Hasil crop 512×512px WebP 0.85 quality.
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
      // Skala dasar: sisi terpanjang menutupi frame 200px
      const dasar = Math.max(SISI_BINGKAI / img.width, SISI_BINGKAI / img.height);
      setSkalaAwal(dasar);
      setSkala(dasar);
      // Gambar terpusat di frame saat pertama dibuka
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
    kanvas.width = UKURAN_OUTPUT;
    kanvas.height = UKURAN_OUTPUT;
    const k = kanvas.getContext("2d");
    if (k) {
      k.imageSmoothingQuality = "high";
      // Koordinat sumber dalam ruang gambar asli:
      // geser adalah kiri-atas gambar dalam ruang frame (200px).
      // Frame 0,0 = -geser di ruang tampilan; bagi skala untuk ruang asli.
      const sx = -geser.x / skala;
      const sy = -geser.y / skala;
      const sWidth = SISI_BINGKAI / skala;
      const sHeight = SISI_BINGKAI / skala;
      k.imageSmoothingQuality = "high";
      k.drawImage(
        img,
        sx, sy, sWidth, sHeight,
        0, 0, UKURAN_OUTPUT, UKURAN_OUTPUT,
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
        Geser & zoom foto supaya wajah berada tepat di dalam bingkai.
      </p>

      {galat ? (
        <p className="font-caption text-caption text-danger-text">{galat}</p>
      ) : null}

      <div className="flex flex-col md:flex-row items-center justify-center gap-4">
        {/* Frame Cropper 200×200px */}
        <div
          className="relative overflow-hidden rounded-[20px] border border-white/80 touch-none select-none"
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

        {/* Preview Live 80×80px — mirip avatar holder */}
        <div className="flex flex-col items-center gap-2">
          <span className="font-caption text-caption text-white/70">Preview (80×80)</span>
          <div className="relative overflow-hidden rounded-[20px] border border-white/80">
            {siap && gambar ? (
              <img
                src={gambar.src}
                alt="Preview avatar"
                className="pointer-events-none select-none"
                style={{
                  width: gambar.width * skala,
                  height: gambar.height * skala,
                  left: geser.x,
                  top: geser.y,
                  position: "absolute",
                }}
              />
            ) : null}
          </div>
          <span className="font-caption text-caption text-white/60">80×80 • radius 20px</span>
        </div>
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