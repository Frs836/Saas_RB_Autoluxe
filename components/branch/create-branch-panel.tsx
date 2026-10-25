"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { isValidLatitude, isValidLongitude, parseCoordinateInput } from "@/lib/branch";
import { useToast } from "@/components/toast";
import { Icon } from "@/components/ui/icon";

/**
 * Formulir pembuatan cabang.
 *
 * Sebelumnya tidak ada jalur sama sekali untuk membuat cabang. Hanya ada
 * fungsi untuk mengubah cabang yang sudah ada, sehingga tidak ada tombol
 * tambah cabang di antarmuka dan cabang kedua tidak pernah bisa dibuat.
 *
 * Kolom yang diisi di sini sama persis dengan yang bisa diubah nanti di
 * pengaturan cabang, jadi cabang baru tidak perlu diisi ulang setelah dibuat.
 */
export function CreateBranchPanel() {
  const router = useRouter();
  const toast = useToast();
  const [buka, setBuka] = useState(false);
  const [sibuk, setSibuk] = useState(false);
  const [galat, setGalat] = useState<string | null>(null);

  const [nama, setNama] = useState("");
  const [alamat, setAlamat] = useState("");
  const [koordinat, setKoordinat] = useState("");
  const [radius, setRadius] = useState("30");
  const [lapanganMasuk, setLapanganMasuk] = useState("07:30");
  const [lapanganPulang, setLapanganPulang] = useState("21:00");
  const [kantorMasuk, setKantorMasuk] = useState("10:00");
  const [kantorPulang, setKantorPulang] = useState("18:00");
  const [pakaiTitik, setPakaiTitik] = useState(true);

  const titik = parseCoordinateInput(koordinat);
  const latitude = typeof titik.latitude === "number" ? titik.latitude : null;
  const longitude = typeof titik.longitude === "number" ? titik.longitude : null;
  const radiusAngka = Number(radius);

  const masalah = (() => {
    if (!nama.trim()) return "Nama cabang wajib diisi.";
    if (lapanganPulang <= lapanganMasuk) return "Jam tutup lapangan harus lebih besar dari jam buka.";
    if (kantorPulang <= kantorMasuk) return "Jam pulang kantor harus lebih besar dari jam masuk kantor.";
    if (!Number.isFinite(radiusAngka) || radiusAngka < 5 || radiusAngka > 5000)
      return "Radius geofence harus antara 5 sampai 5000 meter.";
    if (pakaiTitik) {
      if (latitude === null || longitude === null)
        return "Isi titik koordinat, atau matikan geofence untuk cabang ini.";
      if (!isValidLatitude(latitude)) return "Latitude harus antara -90 sampai 90.";
      if (!isValidLongitude(longitude)) return "Longitude harus antara -180 sampai 180.";
      if (latitude === 0 && longitude === 0) return "Koordinat 0,0 bukan lokasi workshop.";
    }
    return null;
  })();

  async function kirim() {
    if (masalah) {
      setGalat(masalah);
      return;
    }
    setGalat(null);
    setSibuk(true);
    try {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("create_branch", {
        p_branch_name: nama.trim(),
        p_address: alamat.trim(),
        p_latitude: pakaiTitik ? (latitude ?? undefined) : undefined,
        p_longitude: pakaiTitik ? (longitude ?? undefined) : undefined,
        p_radius_meters: radiusAngka,
        p_open_time: lapanganMasuk + ":00",
        p_close_time: lapanganPulang + ":00",
        p_office_open_time: kantorMasuk + ":00",
        p_office_close_time: kantorPulang + ":00",
      });
      if (error) throw new Error(error.message);

      const dibuat = data as { id: string; branch_name: string } | null;
      toast.sukses(`Cabang ${dibuat?.branch_name ?? nama.trim()} dibuat.`);
      setNama("");
      setAlamat("");
      setKoordinat("");
      setBuka(false);
      router.refresh();
    } catch (e) {
      const pesan = e instanceof Error ? e.message : "Gagal membuat cabang.";
      setGalat(pesan);
      toast.gagal("Cabang gagal dibuat.", pesan);
    } finally {
      setSibuk(false);
    }
  }

  if (!buka) {
    return (
      <button
        type="button"
        onClick={() => setBuka(true)}
        className="w-full h-12 px-4 rounded-xl primary-gradient text-on-primary font-body-bold text-body-bold flex items-center justify-center gap-2 clay-fab active:scale-[0.98] transition-transform"
      >
        <Icon name="add_business" className="text-[20px]" />
        Tambah Cabang
      </button>
    );
  }

  const kelas = "w-full h-12 px-3 rounded-xl bg-surface-container-low font-body text-body text-text-primary outline-none focus:ring-2 focus:ring-brand-400";

  return (
    <div className="clay-card bg-surface p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h3 className="font-headline-3 text-headline-3 text-text-primary">
          Cabang Baru
        </h3>
        <button
          type="button"
          onClick={() => setBuka(false)}
          aria-label="Batal membuat cabang"
          className="w-11 h-11 rounded-xl bg-danger-surface flex items-center justify-center text-white active:scale-95 transition-transform"
        >
          <Icon name="close" className="text-[20px]" />
        </button>
      </div>

      <label className="flex flex-col gap-1">
        <span className="font-caption text-caption text-text-muted">Nama cabang</span>
        <input
          value={nama}
          onChange={(e) => setNama(e.target.value)}
          placeholder="Cabang Cikarang"
          className={kelas}
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="font-caption text-caption text-text-muted">Alamat</span>
        <input
          value={alamat}
          onChange={(e) => setAlamat(e.target.value)}
          placeholder="Jalan Cikarang 12"
          className={kelas}
        />
      </label>

      <button
        type="button"
        role="switch"
        aria-checked={pakaiTitik}
        onClick={() => setPakaiTitik((v) => !v)}
        className={`h-12 px-3 rounded-xl flex items-center justify-between gap-3 ${
          pakaiTitik
            ? "bg-success-surface text-success-text"
            : "primary-gradient text-white"
        }`}
      >
        <span className="flex items-center gap-2 font-body text-body">
          <Icon name="gps_fixed" className="text-[18px]" />
          Pakai geofence
        </span>
        <span
          className={`w-10 h-6 rounded-full relative transition-colors ${
            pakaiTitik ? "bg-success-base" : "bg-outline-variant"
          }`}
        >
          <span
            className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-transform ${
              pakaiTitik ? "translate-x-[18px]" : "translate-x-0.5"
            }`}
          />
        </span>
      </button>

      {pakaiTitik ? (
        <>
          <label className="flex flex-col gap-1">
            <span className="font-caption text-caption text-text-muted">
              Titik koordinat
            </span>
            <input
              value={koordinat}
              onChange={(e) => setKoordinat(e.target.value)}
              placeholder="-6.2000000, 106.8166660"
              inputMode="decimal"
              className={kelas}
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="font-caption text-caption text-text-muted">
              Radius toleransi (meter)
            </span>
            <input
              value={radius}
              onChange={(e) => setRadius(e.target.value)}
              inputMode="numeric"
              className={kelas}
            />
          </label>
        </>
      ) : null}

      <div>
        <p className="font-caption text-caption text-text-muted mb-1">
          Jam lapangan
        </p>
        <div className="grid grid-cols-2 gap-3">
          <input
            type="time"
            value={lapanganMasuk}
            onChange={(e) => setLapanganMasuk(e.target.value)}
            aria-label="Jam masuk lapangan"
            className={kelas}
          />
          <input
            type="time"
            value={lapanganPulang}
            onChange={(e) => setLapanganPulang(e.target.value)}
            aria-label="Jam pulang lapangan"
            className={kelas}
          />
        </div>
      </div>

      <div>
        <p className="font-caption text-caption text-text-muted mb-1">
          Jam kantor
        </p>
        <div className="grid grid-cols-2 gap-3">
          <input
            type="time"
            value={kantorMasuk}
            onChange={(e) => setKantorMasuk(e.target.value)}
            aria-label="Jam masuk kantor"
            className={kelas}
          />
          <input
            type="time"
            value={kantorPulang}
            onChange={(e) => setKantorPulang(e.target.value)}
            aria-label="Jam pulang kantor"
            className={kelas}
          />
        </div>
      </div>

      {galat ? (
        <p
          role="alert"
          className="bg-danger-surface text-danger-text rounded-xl px-3 py-2 font-caption text-caption"
        >
          {galat}
        </p>
      ) : null}

      <button
        type="button"
        onClick={() => void kirim()}
        disabled={sibuk || Boolean(masalah)}
        className="w-full h-12 rounded-full primary-gradient text-white font-body-bold text-body-bold flex items-center justify-center gap-2 clay-fab active:scale-[0.98] transition-transform disabled:opacity-50"
      >
        <Icon name={sibuk ? "hourglass_top" : "add_business"} className="text-[20px]" />
        {sibuk ? "Membuat..." : "Buat Cabang"}
      </button>
    </div>
  );
}
