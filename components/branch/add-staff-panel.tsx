"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createStaffProfile } from "@/app/actions/staff";
import { useToast } from "@/components/ui/toast";
import { Icon } from "@/components/ui/icon";

/**
 * Pembuatan akun staf oleh owner atau maintainer.
 *
 * Pendaftaran mandiri selalu mengirim email konfirmasi, dan Supabase membatasi
 * jumlah email menjadi sedikit per jam. Setelah satu atau dua staf didaftarkan,
 * permintaan berikutnya ditolak dengan "Email rate limit exceeded" yang
 * membuat orang mengira formulirnya yang bermasalah.
 *
 * Jalur ini membuat akun tanpa mengirim email sama sekali. Staf menerima
 * kredensialnya dari maintainer, lalu bisa menggantinya sendiri setelah masuk.
 */
export function AddStaffPanel({
  branchId,
  branchName,
  bisaBuatMaintainer,
}: {
  branchId: string | null;
  branchName: string;
  bisaBuatMaintainer: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();

  const [buka, setBuka] = useState(false);
  const [sibuk, setSibuk] = useState(false);
  const [galat, setGalat] = useState<string | null>(null);

  const [nama, setNama] = useState("");
  const [email, setEmail] = useState("");
  const [sandi, setSandi] = useState("");
  const [peran, setPeran] = useState<"karyawan" | "admin_kasir" | "maintainer">(
    "karyawan",
  );
  const [jadwal, setJadwal] = useState<"field" | "office">("field");

  const masalah = (() => {
    if (!branchId) return `Pilih cabang ${branchName} lebih dulu.`;
    if (!nama.trim()) return "Nama lengkap wajib diisi.";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()))
      return "Format email tidak valid.";
    if (sandi.length < 8) return "Kata sandi minimal 8 karakter.";
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
      const hasil = await createStaffProfile({
        fullName: nama.trim(),
        email: email.trim(),
        password: sandi,
        role: peran,
        branchId: branchId as string,
        workSchedule: jadwal,
      });
      if (!hasil.ok) {
        setGalat(hasil.message);
        toast({ variant: "destructive", title: "Error", description: hasil.message });
        return;
      }
      toast({ variant: "success", title: "Sukses", description: "Staf berhasil ditambahkan" });
      setNama("");
      setEmail("");
      setSandi("");
      setBuka(false);
      router.refresh();
    } catch (e) {
      const pesan = e instanceof Error ? e.message : "Gagal membuat akun.";
      setGalat(pesan);
      toast({ variant: "destructive", title: "Error", description: "Akun staf gagal dibuat. " + pesan });
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
        <Icon name="person_add" className="text-[20px]" />
        Tambah Staf
      </button>
    );
  }

  const kelas =
    "w-full h-12 px-3 rounded-xl bg-surface-container-low font-body text-body text-text-primary outline-none focus:ring-2 focus:ring-brand-400";

  return (
    <div className="clay-card bg-surface p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h3 className="font-headline-3 text-headline-3 text-text-primary">
          Akun Staf Baru
        </h3>
        <button
          type="button"
          onClick={() => setBuka(false)}
          aria-label="Batal menambah staf"
          className="w-11 h-11 rounded-xl bg-clay-overlay flex items-center justify-center text-text-secondary active:scale-95 transition-transform"
        >
          <Icon name="close" className="text-[20px]" />
        </button>
      </div>

      <p className="font-caption text-caption text-text-secondary leading-relaxed">
        Tidak ada email yang dikirim. Beri kata sandi ini kepada yang bersangkutan
        supaya mereka bisa masuk, lalu mengaturnya sendiri dari halaman profil.
      </p>

      <label className="flex flex-col gap-1">
        <span className="font-caption text-caption text-text-muted">Nama lengkap</span>
        <input
          value={nama}
          onChange={(e) => setNama(e.target.value)}
          placeholder="Budi Santoso"
          className={kelas}
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="font-caption text-caption text-text-muted">Email</span>
        <input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          inputMode="email"
          autoComplete="off"
          placeholder="budi@rbautoluxe.test"
          className={kelas}
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="font-caption text-caption text-text-muted">Kata sandi sementara</span>
        <input
          type="text"
          value={sandi}
          onChange={(e) => setSandi(e.target.value)}
          autoComplete="off"
          placeholder="Minimal 8 karakter"
          className={kelas}
        />
      </label>

      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1">
          <span className="font-caption text-caption text-text-muted">Peran</span>
          <select
            value={peran}
            onChange={(e) =>
              setPeran(e.target.value as "karyawan" | "admin_kasir" | "maintainer")
            }
            className={kelas}
          >
            <option value="karyawan">Karyawan</option>
            <option value="admin_kasir">Admin Kasir</option>
            {bisaBuatMaintainer ? (
              <option value="maintainer">Maintainer</option>
            ) : null}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="font-caption text-caption text-text-muted">Jadwal kerja</span>
          <select
            value={jadwal}
            onChange={(e) => setJadwal(e.target.value as "field" | "office")}
            className={kelas}
          >
            <option value="field">Lapangan 07:30-21:00</option>
            <option value="office">Kantor 10:00-18:00</option>
          </select>
        </label>
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
        <Icon name={sibuk ? "hourglass_top" : "person_add"} className="text-[20px]" />
        {sibuk ? "Membuat..." : "Buat Akun"}
      </button>
    </div>
  );
}
