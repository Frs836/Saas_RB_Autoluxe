"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { initials } from "@/lib/format";
import { Icon } from "@/components/ui/icon";

export type ManagedStaff = {
  id: string;
  fullName: string;
  role: string;
  roleLabel: string;
  branchId: string | null;
  branchName: string;
  workSchedule: "field" | "office";
  isActive: boolean;
  defaultOffDay: number | null;
  facePhotoUrl: string | null;
  faceStatus: string;
};

const JABATAN: { value: string; label: string }[] = [
  { value: "karyawan", label: "Karyawan" },
  { value: "admin_kasir", label: "Admin Kasir" },
  { value: "maintainer", label: "Maintainer" },
];

const HARI: { value: number; label: string }[] = [
  { value: 0, label: "Minggu" },
  { value: 1, label: "Senin" },
  { value: 2, label: "Selasa" },
  { value: 3, label: "Rabu" },
  { value: 4, label: "Kamis" },
  { value: 5, label: "Jumat" },
  { value: 6, label: "Sabtu" },
];

function hariLabel(nilai: number): string {
  return HARI.find((h) => h.value === nilai)?.label ?? "Tidak diketahui";
}

/* Nilai select harus berupa string; hari yang belum ada disiarkan kosong. */
function hariLiburAktif(s: ManagedStaff): string {
  return s.defaultOffDay === null ? "" : String(s.defaultOffDay);
}

/**
 * Daftar staf yang bisa ditata: status aktif, jabatan, jadwal kerja, dan
 * cabang.
 *
 * Foto yang dipakai adalah sampel wajah hasil pendaftaran Face ID, karena itu
 * satu-satunya foto staf yang sudah pasti milik orang yang dimaksud. Tanpa
 * foto, kartu memakai inisial supaya tetap terbaca.
 */
export function StaffManagement({
  staff,
  branches,
  bisaUbahJabatan,
}: {
  staff: ManagedStaff[];
  branches: { id: string; name: string }[];
  bisaUbahJabatan: boolean;
}) {
  const router = useRouter();
  const [terbuka, setTerbuka] = useState<string | null>(null);
  const [sibuk, setSibuk] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sukses, setSukses] = useState<string | null>(null);

  /**
   * Menyimpan perubahan staf.
   *
   * Setiap perubahan selalu menghasilkan umpan balik. Sebelumnya select hari
   * libur memanggil fungsi ini tanpa pesan apa pun, sehingga ketika gagal
   * tidak ada yang bergerak dan tidak ada yang tahu alasannya. Sekarang nama
   * field diterjemahkan jadi kalimat, dan hasilnya ditulis baik saat berhasil
   * maupun saat gagal.
   */
  async function simpan(
    profileId: string,
    perubahan: Record<string, unknown>,
    keterangan: string,
  ) {
    setSibuk(profileId);
    setError(null);
    setSukses(null);
    console.log("[StaffManagement] Saving changes:", { profileId, perubahan, keterangan });
    const supabase = createClient();
    const { error: rpcError } = await supabase.rpc("update_staff_profile", {
      p_profile_id: profileId,
      ...perubahan,
    });
    setSibuk(null);
    if (rpcError) {
      console.error("[StaffManagement] RPC error:", rpcError);
      // Tangani error khusus "User not allowed" / hak akses
      if (rpcError.message.includes("tidak bisa") || rpcError.message.includes("hanya bisa") || rpcError.message.includes("User not allowed") || rpcError.message.includes("hanya owner")) {
        setError(`${keterangan} gagal: Anda tidak memiliki hak akses untuk melakukan perubahan ini.`);
      } else {
        setError(`${keterangan} gagal: ${rpcError.message}`);
      }
      return;
    }
    console.log("[StaffManagement] Save successful:", keterangan);
    setSukses(`${keterangan} tersimpan.`);
    router.refresh();
  }

  return (
    <section className="px-gutter pt-4 flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <h2 className="font-headline-3 text-headline-3 text-text-primary">
          Kelola Staf
        </h2>
        <span className="font-caption text-caption text-text-muted">
          {staff.filter((s) => s.isActive).length} aktif
        </span>
      </div>

      {error ? (
        <div className="p-3 rounded-xl bg-danger-surface text-danger-text font-caption text-caption flex items-center gap-2">
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

      {staff.map((s) => {
        const buka = terbuka === s.id;
        const sibukBaris = sibuk === s.id;
        return (
          <article key={s.id} className="clay-card p-4 flex flex-col gap-2">
            <div className="flex items-start gap-3">
              {s.facePhotoUrl ? (
                <img
                  src={s.facePhotoUrl}
                  alt={s.fullName}
                  className="w-12 h-12 rounded-xl object-cover shrink-0"
                />
              ) : (
                <span className="w-12 h-12 rounded-xl bg-brand-50 text-brand-700 font-headline-2 text-headline-2 flex items-center justify-center shrink-0">
                  {initials(s.fullName)}
                </span>
              )}
              <div className="min-w-0 flex-1">
                <p className="font-body-bold text-body-bold text-text-primary truncate">
                  {s.fullName}
                </p>
                <p className="font-caption text-caption text-text-muted truncate">
                  {s.roleLabel} · {s.branchName}
                </p>
                <div className="flex flex-wrap gap-1.5 mt-1">
                  <span
                    className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-micro-badge text-micro-badge ${
                      s.isActive
                        ? "bg-success-surface text-success-text"
                        : "bg-surface-container text-text-muted"
                    }`}
                  >
                    <Icon
                      name={s.isActive ? "task_alt" : "block"}
                      className="text-[13px]"
                    />
                    {s.isActive ? "Aktif" : "Nonaktif"}
                  </span>
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-surface-container font-micro-badge text-micro-badge text-text-secondary">
                    {s.workSchedule === "office" ? "Kantor" : "Lapangan"}
                  </span>
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-surface-container font-micro-badge text-micro-badge text-text-secondary">
                    <Icon name="face_retouching_natural" className="text-[13px]" />
                    {s.faceStatus}
                  </span>
                </div>
              </div>
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setTerbuka(buka ? null : s.id)}
                className="flex-1 min-h-11 rounded-xl bg-surface-container text-text-secondary font-caption text-caption flex items-center justify-center gap-1.5 active:scale-95 transition-transform"
              >
                <Icon name="tune" className="text-[18px]" />
                {buka ? "Tutup" : "Atur"}
              </button>
              <button
                type="button"
                disabled={sibukBaris}
                onClick={() =>
                  simpan(
                    s.id,
                    { p_is_active: !s.isActive },
                    s.isActive ? "Penonaktifan staf" : "Pengaktifan staf",
                  )
                }
                className={`flex-1 min-h-11 rounded-xl font-caption text-caption flex items-center justify-center gap-1.5 active:scale-95 transition-transform disabled:opacity-60 ${
                  s.isActive
                    ? "bg-danger-surface text-danger-text"
                    : "bg-success-surface text-success-text"
                }`}
              >
                <Icon
                  name={sibukBaris ? "hourglass_top" : s.isActive ? "block" : "restart_alt"}
                  className="text-[18px]"
                />
                {s.isActive ? "Nonaktifkan" : "Aktifkan"}
              </button>
            </div>

            {buka ? (
              <div className="pt-3 mt-1 border-t border-outline-variant/40 flex flex-col gap-3">
                <label className="flex flex-col gap-1">
                  <span className="font-micro-badge text-micro-badge text-text-muted">
                    Jabatan
                  </span>
                  <select
                    defaultValue={s.role}
                    disabled={!bisaUbahJabatan || sibukBaris}
                    onChange={(e) =>
                      simpan(
                        s.id,
                        { p_role: e.target.value },
                        "Perubahan jabatan",
                      )
                    }
                    className="h-11 px-3 rounded-xl bg-surface-container font-body text-body text-text-primary outline-none focus:ring-2 focus:ring-brand-400 disabled:opacity-60"
                  >
                    {JABATAN.map((j) => (
                      <option key={j.value} value={j.value}>
                        {j.label}
                      </option>
                    ))}
                  </select>
                  {!bisaUbahJabatan ? (
                    <span className="font-micro-badge text-micro-badge text-text-muted">
                      Hanya owner yang bisa mengubah jabatan.
                    </span>
                  ) : null}
                </label>

                <label className="flex flex-col gap-1">
                  <span className="font-micro-badge text-micro-badge text-text-muted">
                    Jadwal Kerja
                  </span>
                  <select
                    defaultValue={s.workSchedule}
                    disabled={sibukBaris}
                    onChange={(e) =>
                      simpan(
                        s.id,
                        { p_work_schedule: e.target.value },
                        "Perubahan jadwal kerja",
                      )
                    }
                    className="h-11 px-3 rounded-xl bg-surface-container font-body text-body text-text-primary outline-none focus:ring-2 focus:ring-brand-400 disabled:opacity-60"
                  >
                    <option value="field">Lapangan</option>
                    <option value="office">Kantor</option>
                  </select>
                </label>

                <label className="flex flex-col gap-1">
                  <span className="font-micro-badge text-micro-badge text-text-muted">
                    Cabang
                  </span>
                  <select
                    defaultValue={s.branchId ?? ""}
                    disabled={sibukBaris}
                    onChange={(e) =>
                      simpan(
                        s.id,
                        { p_branch_id: e.target.value },
                        "Pemindahan cabang",
                      )
                    }
                    className="h-11 px-3 rounded-xl bg-surface-container font-body text-body text-text-primary outline-none focus:ring-2 focus:ring-brand-400 disabled:opacity-60"
                  >
                    {branches.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="flex flex-col gap-1">
                  <span className="font-micro-badge text-micro-badge text-text-muted">
                    Hari Libur Rutin
                  </span>
                  {/*
                    Select ini menampilkan hari yang sedang berlaku, bukan
                    selalu "Pilih hari". Kalau selalu kosong, pengelola tidak
                    pernah bisa memastikan hari libur yang lalu benar-benar
                    tersimpan, dan select yang kembali kosong membuat perubahan
                    terasa tidak terjadi sama sekali.
                  */}
                  <select
                    value={hariLiburAktif(s)}
                    disabled={sibukBaris}
                    onChange={(e) => {
                      if (e.target.value === "") return;
                      const terpilih = HARI.find(
                        (h) => h.value === Number(e.target.value),
                      );
                      simpan(
                        s.id,
                        { p_default_off_day: Number(e.target.value) },
                        `Setelan hari libur ${terpilih?.label ?? ""}`.trim(),
                      );
                    }}
                    className="h-11 px-3 rounded-xl bg-surface-container font-body text-body text-text-primary outline-none focus:ring-2 focus:ring-brand-400 disabled:opacity-60"
                  >
                    <option value="">Pilih hari...</option>
                    {HARI.map((h) => (
                      <option key={h.value} value={h.value}>
                        {h.label}
                      </option>
                    ))}
                  </select>
                  <span className="font-micro-badge text-micro-badge text-text-muted">
                    {s.defaultOffDay === null
                      ? "Belum ada hari libur rutin."
                      : `Setiap ${hariLabel(s.defaultOffDay)}, sistem menandai kehadiran sebagai libur shift.`}
                  </span>
                </label>
              </div>
            ) : null}
          </article>
        );
      })}
    </section>
  );
}