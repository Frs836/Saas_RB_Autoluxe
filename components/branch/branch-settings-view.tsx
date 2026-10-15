"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { saveBranchSettings } from "@/app/actions/branch-settings";
import { CreateBranchPanel } from "@/components/branch/create-branch-panel";
import {
  crossesDateLine,
  formatCoordinate,
  googleMapsLink,
  isValidLatitude,
  isValidLongitude,
  parseCoordinateInput,
  toTimeInput,
  type BranchRecord,
} from "@/lib/branch";

type Props = {
  branches: BranchRecord[];
  activeBranchId: string | null;
};

type FormState = {
  branchName: string;
  address: string;
  latitude: string;
  longitude: string;
  radius: string;
  openTime: string;
  closeTime: string;
  isActive: boolean;
  setCoordinates: boolean;
};

function toForm(branch: BranchRecord): FormState {
  return {
    branchName: branch.name,
    address: branch.address,
    latitude: branch.latitude === null ? "" : String(branch.latitude),
    longitude: branch.longitude === null ? "" : String(branch.longitude),
    radius: String(branch.radiusMeters),
    openTime: toTimeInput(branch.openTime),
    closeTime: toTimeInput(branch.closeTime),
    isActive: branch.isActive,
    setCoordinates: branch.latitude !== null && branch.longitude !== null,
  };
}

/** Nilai awal saat daftar cabang kosong, dipakai sekali lalu tidak lagi. */
const FORM_KOSONG: BranchRecord = {
  id: "",
  name: "",
  address: "",
  latitude: null,
  longitude: null,
  radiusMeters: 30,
  openTime: "07:30:00",
  closeTime: "21:00:00",
  staffCount: 0,
  isActive: true,
};

export function BranchSettingsView({ branches, activeBranchId }: Props) {
  const router = useRouter();
  const initial =
    branches.find((b) => b.id === activeBranchId) ?? branches[0] ?? null;

  const [selectedId, setSelectedId] = useState<string>(initial?.id ?? "");
  const [form, setForm] = useState<FormState>(initial ? toForm(initial) : toForm({
    id: "",
    name: "",
    address: "",
    latitude: null,
    longitude: null,
    radiusMeters: 30,
    openTime: "07:30:00",
    closeTime: "21:00:00",
    staffCount: 0,
    isActive: true,
  }));

  const [coordinateInput, setCoordinateInput] = useState("");
  const [coordinateMessage, setCoordinateMessage] = useState<{
    tone: "ok" | "error";
    text: string;
  } | null>(null);

  const [busy, setBusy] = useState(false);

  const [feedback, setFeedback] = useState<{
    tone: "ok" | "error";
    text: string;
  } | null>(null);

  const selected = useMemo(
    () => branches.find((b) => b.id === selectedId) ?? null,
    [branches, selectedId],
  );

  /*
   * Setelah simpan berhasil, router.refresh() mengambil data cabang terbaru
   * dari server dan initial berubah. Isian form diselaraskan saat render,
   * bukan di dalam efek.
   *
   * Pola adjusting state saat properti berubah inilah yang Recomendasi React
   * sendiri: SetState di dalam efek memaksa render kedua, sedangkan
   * penyelarasan ini hanya terjadi pada render yang memang sudah berjalan.
   */
  const [terakhir, setTerakhir] = useState<BranchRecord | null>(initial);
  if (initial !== terakhir) {
    setTerakhir(initial);
    setForm(initial ? toForm(initial) : toForm(FORM_KOSONG));
  }

  const latitude = form.latitude.trim() === "" ? null : Number(form.latitude);
  const longitude = form.longitude.trim() === "" ? null : Number(form.longitude);
  const radius = Number(form.radius);

  const mapLink = useMemo(() => {
    if (!form.setCoordinates) return null;
    return googleMapsLink(latitude, longitude, form.branchName || null);
  }, [form.branchName, form.setCoordinates, latitude, longitude]);

  function pickBranch(id: string) {
    const branch = branches.find((b) => b.id === id);
    if (!branch) return;
    setSelectedId(id);
    setForm(toForm(branch));
    setCoordinateInput("");
    setCoordinateMessage(null);
    setFeedback(null);
  }

  function applyCoordinateInput() {
    const result = parseCoordinateInput(coordinateInput);
    if (!result.ok) {
      setCoordinateMessage({ tone: "error", text: result.message ?? "Koordinat tidak valid." });
      return;
    }
    setForm((prev) => ({
      ...prev,
      latitude: String(result.latitude),
      longitude: String(result.longitude),
      setCoordinates: true,
    }));
    setCoordinateMessage({
      tone: "ok",
      text: `Koordinat diterapkan: ${result.latitude}, ${result.longitude}`,
    });
  }

  function useDeviceLocation() {
    setCoordinateMessage({ tone: "error", text: "Membaca lokasi perangkat..." });
    if (!navigator.geolocation) {
      setCoordinateMessage({
        tone: "error",
        text: "Perangkat ini tidak mendukung pembacaan lokasi.",
      });
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude: lat, longitude: lng } = position.coords;
        setForm((prev) => ({
          ...prev,
          latitude: lat.toFixed(6),
          longitude: lng.toFixed(6),
          setCoordinates: true,
        }));
        setCoordinateMessage({
          tone: "ok",
          text: `Lokasi perangkat diterapkan dengan ketepatan ${Math.round(position.coords.accuracy)} meter.`,
        });
      },
      () => {
        setCoordinateMessage({
          tone: "error",
          text:
            "Gagal membaca lokasi perangkat. Gunakan tempelan koordinat dari Google Maps sebagai gantinya.",
        });
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }

  const validation = (() => {
    if (!form.branchName.trim()) return "Nama cabang wajib diisi.";
    if (!form.openTime || !form.closeTime) return "Jam buka dan tutup wajib diisi.";
    if (form.closeTime <= form.openTime)
      return "Jam tutup harus lebih besar dari jam buka.";
    if (!Number.isFinite(radius) || radius < 5 || radius > 5000)
      return "Radius geofence harus antara 5 sampai 5000 meter.";
    if (form.setCoordinates) {
      if (latitude === null || longitude === null)
        return "Isi latitude dan longitude, atau matikan geofence.";
      if (!isValidLatitude(latitude)) return "Latitude harus antara -90 sampai 90.";
      if (!isValidLongitude(longitude))
        return "Longitude harus antara -180 sampai 180.";
      if (latitude === 0 && longitude === 0)
        return "Koordinat 0,0 adalah lokasi DEFAULT, bukan lokasi workshop.";
    }
    return null;
  })();

  /**
   * Sakelar status aktif memanggil fungsi sendiri, bukan ikut dalam simpanan
   * konfigurasi. Pemeriksaan staf aktif hanya berlaku di sini, jadi nama,
   * deskripsi, koordinat, dan jam tidak ikut gagal karena masih ada staf.
   */
  async function ubahStatusCabang(id: string, aktif: boolean) {
    const supabase = createClient();
    const { error } = await supabase.rpc("set_branch_active", {
      p_branch_id: id,
      p_active: aktif,
    });
    if (error) return { ok: false as const, message: error.message };
    return { ok: true as const, message: aktif ? "Cabang diaktifkan." : "Cabang dinonaktifkan." };
  }

  async function submit() {
    if (validation) {
      setFeedback({ tone: "error", text: validation });
      return;
    }

    setBusy(true);
    try {
      const result = await saveBranchSettings({
        branchId: selectedId,
        branchName: form.branchName.trim(),
        address: form.address.trim(),
        latitude: form.setCoordinates ? latitude : null,
        longitude: form.setCoordinates ? longitude : null,
        radiusMeters: Number.isFinite(radius) ? radius : null,
        openTime: form.openTime,
        closeTime: form.closeTime,
        setCoordinates: form.setCoordinates,
        // Sakelar aktif punya syarat sendiri, jadi tidak dikirim bersama
        // data lainnya. Sebelumnya ikut dikirim, dan kalau dimatikan sementara
        // masih ada staf, seluruh permintaan ditolak termasuk nama, deskripsi,
        // dan koordinat yang tidak ada hubungannya dengan staffing.
        isActive: null,
      });

      if (!result.ok) {
        setFeedback({ tone: "error", text: result.message });
        return;
      }

      // Status aktif dicoba setelah data lain tersimpan, supaya kegagalan di
      // sini tidak membatalkan simpanan tadi.
      if (form.isActive !== selected?.isActive) {
        const status = await ubahStatusCabang(selectedId, form.isActive);
        if (!status.ok) {
          setFeedback({ tone: "error", text: status.message });
          router.refresh();
          return;
        }
      }

      setFeedback({ tone: "ok", text: result.message });
      router.refresh();
    } catch {
      setFeedback({ tone: "error", text: "Gagal menyimpan konfigurasi." });
    } finally {
      setBusy(false);
    }
  }

  if (branches.length === 0) {
    return (
      <div className="px-gutter py-6">
        <div className="clay-card p-6 flex flex-col items-center gap-3 text-center">
          <span className="material-symbols-outlined text-[40px] text-warning-base">
            store
          </span>
          <h2 className="font-headline-2 text-headline-2 text-text-primary">
            Belum ada Cabang
          </h2>
          <p className="font-caption text-caption text-text-secondary">
            Cabang hanya dapat dibuat oleh Maintainer.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="px-gutter py-4 pb-28 flex flex-col gap-4">
      <section className="clay-card p-4 flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h1 className="font-headline-2 text-headline-2 text-text-primary">
            Pengaturan Cabang
          </h1>
          <span className="px-2 py-0.5 rounded-full bg-brand-50 text-brand-600 font-micro-badge text-micro-badge">
            {branches.length} cabang
          </span>
        </div>

        <div className="flex gap-2 overflow-x-auto pb-1">
          {branches.map((branch) => (
            <button
              key={branch.id}
              type="button"
              onClick={() => pickBranch(branch.id)}
              className={`px-3 py-2 rounded-xl font-caption text-caption whitespace-nowrap flex items-center gap-1 ${
                branch.id === selectedId
                  ? "bg-brand-50 text-brand-700"
                  : "bg-surface-container-low text-text-secondary"
              }`}
            >
              <span className="material-symbols-outlined text-[15px]">storefront</span>
              {branch.name}
            </button>
          ))}
        </div>

        {selected ? (
          <div className="flex flex-wrap gap-2">
            <span className="px-2 py-1 rounded-full bg-surface-container text-text-secondary font-micro-badge text-micro-badge">
              {selected.staffCount} staf terdaftar
            </span>
            <span className="px-2 py-1 rounded-full bg-surface-container text-text-secondary font-micro-badge text-micro-badge">
              {selected.isActive ? "Aktif" : "Nonaktif"}
            </span>
            {selected.latitude === null ? (
              <span className="px-2 py-1 rounded-full bg-warning-surface text-warning-text font-micro-badge text-micro-badge">
                Geofence belum dipasang
              </span>
            ) : null}
          </div>
        ) : null}
      </section>

      <section className="clay-card p-4 flex flex-col gap-3">
        <h2 className="font-body-bold text-body-bold text-text-primary flex items-center gap-2">
          <span className="material-symbols-outlined text-[20px] text-brand-600">
            info
          </span>
          Identitas Cabang
        </h2>

        <label className="flex flex-col gap-1">
          <span className="font-caption text-caption text-text-muted">Nama Cabang</span>
          <input
            value={form.branchName}
            onChange={(e) => setForm((f) => ({ ...f, branchName: e.target.value }))}
            placeholder="Contoh: RB Autoluxe Depok"
            className="h-12 px-3 rounded-xl bg-surface-container-low font-body text-body text-text-primary outline-none focus:ring-2 focus:ring-brand-400"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="font-caption text-caption text-text-muted">Alamat</span>
          <textarea
            value={form.address}
            onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
            rows={2}
            placeholder="Alamat lengkap workshop"
            className="rounded-xl bg-surface-container-low px-3 py-2 font-body text-body text-text-primary outline-none focus:ring-2 focus:ring-brand-400"
          />
        </label>
      </section>

      <section className="clay-card p-4 flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="font-body-bold text-body-bold text-text-primary flex items-center gap-2">
            <span className="material-symbols-outlined text-[20px] text-brand-600">
              my_location
            </span>
            Titik GPS dan Geofence
          </h2>
          <button
            type="button"
            role="switch"
            aria-checked={form.setCoordinates}
            onClick={() => setForm((f) => ({ ...f, setCoordinates: !f.setCoordinates }))}
            className={`h-8 px-3 rounded-full font-caption text-caption flex items-center gap-1 ${
              form.setCoordinates
                ? "bg-success-surface text-success-text"
                : "bg-surface-container text-text-secondary"
            }`}
          >
            <span className="material-symbols-outlined text-[15px]">
              {form.setCoordinates ? "check_circle" : "cancel"}
            </span>
            {form.setCoordinates ? "Aktif" : "Nonaktif"}
          </button>
        </div>

        <p className="font-caption text-caption text-text-muted">
          Geofence menolak absensi di luar radius ini. Bila sensor GPS perangkat
          tidak andal di dalam gedung, salin koordinat secara manual dari Google
          Maps.
        </p>

        {form.setCoordinates ? (
          <>
            <div className="rounded-xl bg-brand-50 p-3 flex flex-col gap-2">
              <span className="font-caption text-caption text-brand-700 font-semibold">
                Tempel koordinat dari Google Maps
              </span>
              <input
                value={coordinateInput}
                onChange={(e) => setCoordinateInput(e.target.value)}
                placeholder="-6.175392, 106.827153 atau tautan Google Maps"
                className="h-11 px-3 rounded-lg bg-surface font-body text-body text-text-primary outline-none"
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={applyCoordinateInput}
                  className="h-10 px-3 rounded-lg bg-brand-500 text-white font-caption text-caption flex items-center gap-1 active:scale-95 transition-transform"
                >
                  <span className="material-symbols-outlined text-[15px]">content_paste</span>
                  Terapkan
                </button>
                <button
                  type="button"
                  onClick={useDeviceLocation}
                  className="h-10 px-3 rounded-lg bg-surface text-text-secondary font-caption text-caption flex items-center gap-1 active:scale-95 transition-transform"
                >
                  <span className="material-symbols-outlined text-[15px]">gps_fixed</span>
                  Baca GPS Perangkat
                </button>
              </div>
              <p className="font-micro-badge text-micro-badge text-brand-700/80">
                Buka Google Maps, tekan titik lokasi workshop, lalu salin angka
                pada kotak pencarian yang muncul di sisi bawah.
              </p>
            </div>

            {coordinateMessage ? (
              <p
                className={`font-caption text-caption ${
                  coordinateMessage.tone === "ok" ? "text-success-text" : "text-danger-text"
                }`}
              >
                {coordinateMessage.text}
              </p>
            ) : null}

            <div className="grid grid-cols-2 gap-3">
              <label className="flex flex-col gap-1">
                <span className="font-caption text-caption text-text-muted">Latitude</span>
                <input
                  value={form.latitude}
                  onChange={(e) => setForm((f) => ({ ...f, latitude: e.target.value }))}
                  inputMode="decimal"
                  placeholder="-6.175392"
                  className="h-12 px-3 rounded-xl bg-surface-container-low font-body-mono text-body text-text-primary outline-none focus:ring-2 focus:ring-brand-400"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="font-caption text-caption text-text-muted">Longitude</span>
                <input
                  value={form.longitude}
                  onChange={(e) => setForm((f) => ({ ...f, longitude: e.target.value }))}
                  inputMode="decimal"
                  placeholder="106.827153"
                  className="h-12 px-3 rounded-xl bg-surface-container-low font-body-mono text-body text-text-primary outline-none focus:ring-2 focus:ring-brand-400"
                />
              </label>
            </div>

            <label className="flex flex-col gap-1">
              <span className="font-caption text-caption text-text-muted">
                Radius toleransi (meter)
              </span>
              <input
                value={form.radius}
                onChange={(e) => setForm((f) => ({ ...f, radius: e.target.value }))}
                inputMode="numeric"
                className="h-12 px-3 rounded-xl bg-surface-container-low font-body-mono text-body text-text-primary outline-none focus:ring-2 focus:ring-brand-400"
              />
              <span className="font-micro-badge text-micro-badge text-text-muted">
                Rentang yang diperbolehkan 5 sampai 5000 meter
              </span>
            </label>

            <div className="rounded-xl bg-surface-container-low px-3 py-2.5 flex flex-col gap-1">
              <div className="flex items-center justify-between gap-2">
                <span className="font-caption text-caption text-text-secondary">
                  Koordinat tersimpan
                </span>
                <span className="font-caption text-caption font-mono text-text-primary">
                  {formatCoordinate(latitude)}, {formatCoordinate(longitude)}
                </span>
              </div>
              {latitude !== null && longitude !== null ? (
                <div className="flex items-center justify-between gap-2">
                  <span className="font-caption text-caption text-text-secondary">
                    Zona waktu lokal
                  </span>
                  <span className="font-caption text-caption text-text-primary">
                    {crossesDateLine(latitude, longitude) ? "Melewati meridian 180" : "WIB"}
                  </span>
                </div>
              ) : null}
              {mapLink ? (
                <a
                  href={mapLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="self-start mt-1 font-caption text-caption text-brand-600 flex items-center gap-1"
                >
                  <span className="material-symbols-outlined text-[15px]">map</span>
                  Buka di Google Maps
                </a>
              ) : null}
            </div>
          </>
        ) : (
          <p className="font-caption text-caption text-warning-text">
            Geofence dimatikan. Absensi tidak akan memeriksa jarak lokasi untuk
            cabang ini.
          </p>
        )}
      </section>

      <section className="clay-card p-4 flex flex-col gap-3">
        <h2 className="font-body-bold text-body-bold text-text-primary flex items-center gap-2">
          <span className="material-symbols-outlined text-[20px] text-brand-600">
            schedule
          </span>
          Jam Operasional
        </h2>

        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1">
            <span className="font-caption text-caption text-text-muted">Jam buka</span>
            <input
              type="time"
              value={form.openTime}
              onChange={(e) => setForm((f) => ({ ...f, openTime: e.target.value }))}
              className="h-12 px-3 rounded-xl bg-surface-container-low font-body-mono text-body text-text-primary outline-none focus:ring-2 focus:ring-brand-400"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-caption text-caption text-text-muted">Jam tutup</span>
            <input
              type="time"
              value={form.closeTime}
              onChange={(e) => setForm((f) => ({ ...f, closeTime: e.target.value }))}
              className="h-12 px-3 rounded-xl bg-surface-container-low font-body-mono text-body text-text-primary outline-none focus:ring-2 focus:ring-brand-400"
            />
          </label>
        </div>

        <p className="font-micro-badge text-micro-badge text-text-muted">
          Absensi setelah jam tutup akan dihitung terlambat oleh sistem.
        </p>
      </section>

      <section className="clay-card p-4 flex flex-col gap-2">
        <button
          type="button"
          role="switch"
          aria-checked={form.isActive}
          onClick={() => setForm((f) => ({ ...f, isActive: !f.isActive }))}
          className={`h-12 px-3 rounded-xl flex items-center justify-between gap-3 ${
            form.isActive
              ? "bg-success-surface text-success-text"
              : "bg-surface-container text-text-secondary"
          }`}
        >
          <span className="flex items-center gap-2 font-body text-body">
            <span className="material-symbols-outlined text-[18px]">
              {form.isActive ? "toggle_on" : "toggle_off"}
            </span>
            {form.isActive ? "Cabang aktif" : "Cabang nonaktif"}
          </span>
        </button>

        {form.isActive ? (
          <p className="font-micro-badge text-micro-badge text-text-muted">
            Menonaktifkan cabang hanya bisa dilakukan bila seluruh stafnya sudah
            dipindahkan.
          </p>
        ) : null}
      </section>

      {/*
       * Bilah ini pernah memakai bottom-0 dengan z-40, sementara navigasi
       * bawah memakai z-50. Tombol simpannya berada di dalam area yang
       * sama dengan navigasi sehingga tertutup dan tidak bisa diklik.
       * Sekarang posisinya di atas navigasi dengan z yang lebih rendah
       * supaya navigasi tetap di atas dan tidak pernah menutupinya.
       */}
      <div className="fixed bottom-nav-offset left-0 right-0 z-action-bar px-gutter pb-3 pt-3">
        {feedback ? (
          <p
            className={`mb-2 p-2 rounded-xl font-caption text-caption ${
              feedback.tone === "ok"
                ? "bg-success-surface text-success-text"
                : "bg-danger-surface text-danger-text"
            }`}
          >
            {feedback.text}
          </p>
        ) : null}

        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={submit}
            disabled={busy || Boolean(validation)}
            className="w-full py-3.5 rounded-full primary-gradient text-on-primary font-body-bold text-body-bold flex items-center justify-center gap-2 clay-fab active:scale-95 transition-transform disabled:opacity-50"
          >
            <span className="material-symbols-outlined text-[20px]">save</span>
            {busy ? "Menyimpan..." : "Simpan Konfigurasi"}
          </button>

          {/*
            Pembuatan cabang punya formularnya sendiri karena butuh nilai yang
            tidak ada di cabang mana pun: nama, alamat, titik, dan jam. Ditaruh
            di luar bilah simpan supaya tidak bersaing dengan perubahan
            cabang yang sedang dipilih.
          */}
          <CreateBranchPanel />
        </div>
      </div>
    </div>
  );
}