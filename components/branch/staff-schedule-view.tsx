"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { ATTENDANCE_ROLE_LABELS } from "@/lib/attendance";
import { initials } from "@/lib/format";
import { useToast } from "@/components/toast";
import { Icon } from "@/components/ui/icon";

export type StaffSchedule = {
  id: string;
  fullName: string;
  role: string;
  branchName: string | null;
  workSchedule: "field" | "office";
  isActive: boolean;
};

export type JamKerja = {
  lapanganMasuk: string;
  lapanganPulang: string;
  kantorMasuk: string;
  kantorPulang: string;
};

const LABEL_JADWAL: Record<"field" | "office", { nama: string; ikon: string }> = {
  field: { nama: "Lapangan", ikon: "construction" },
  office: { nama: "Kantor", ikon: "desk" },
};

/** Menampilkan HH:MM:SS sebagai HH:MM tanpa mengubah zona waktu. */
function jamPendek(v: string): string {
  return v ? v.slice(0, 5) : "-";
}

export function StaffScheduleView({
  staff,
  jam,
  bisaUbah,
}: {
  staff: StaffSchedule[];
  jam: JamKerja;
  bisaUbah: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [sibuk, setSibuk] = useState<string | null>(null);
  const [jamKantor, setJamKantor] = useState({
    masuk: jam.kantorMasuk.slice(0, 5),
    pulang: jam.kantorPulang.slice(0, 5),
  });
  const [jamBerubah, setJamBerubah] = useState(false);

  const ubahJadwal = useCallback(
    async (orang: StaffSchedule, jadwal: "field" | "office") => {
      if (sibuk) return;
      if (orang.workSchedule === jadwal) return;
      setSibuk(orang.id);
      try {
        const supabase = createClient();
        const { error: err } = await supabase.rpc("set_work_schedule", {
          p_profile_id: orang.id,
          p_schedule: jadwal,
          p_note: "Diubah dari pengaturan staf",
        });
        if (err) throw new Error(err.message);
        toast.sukses(
          `${orang.fullName} sekarang dijadwalkan ${LABEL_JADWAL[jadwal].nama.toLowerCase()}.`,
        );
        router.refresh();
      } catch (e) {
        toast.gagal(
          e instanceof Error
            ? `Jadwal ${orang.fullName} gagal diubah: ${e.message}`
            : `Jadwal ${orang.fullName} gagal diubah. Coba lagi.`,
        );
      } finally {
        setSibuk(null);
      }
    },
    [router, toast],
  );

  const simpanJamKantor = useCallback(async () => {
    if (sibuk) return;
    setSibuk("jam");
    try {
      const supabase = createClient();
      const { error: err } = await supabase.rpc("update_branch_office_hours", {
        p_open_time: jamKantor.masuk + ":00",
        p_close_time: jamKantor.pulang + ":00",
      });
      if (err) throw new Error(err.message);
      setJamBerubah(false);
      toast.sukses("Jam kerja kantor disimpan.");
      router.refresh();
    } catch (e) {
      toast.gagal(
        e instanceof Error
          ? `Jam kantor gagal disimpan: ${e.message}`
          : "Jam kantor gagal disimpan. Coba lagi.",
      );
    } finally {
      setSibuk(null);
    }
  }, [jamKantor, router, toast]);

  return (
    <div className="px-gutter py-4 flex flex-col gap-4 pb-nav-plain">
      {/* Dua pasang jam yang menjadi acuan penilaian keterlambatan */}
      <section className="bg-surface rounded-[20px] clay-card p-4">
        <h2 className="font-headline-3 text-headline-3 text-text-primary">
          Dua Acuan Jam Kerja
        </h2>
        <p className="font-caption text-caption text-text-secondary mt-1 leading-relaxed">
          Keterlambatan dihitung terhadap jam masuk milik jadwal yang dipakai
          staf, bukan terhadap jam operasional cabang.
        </p>

        <div className="grid grid-cols-2 gap-3 mt-3">
          <div className="bg-clay-overlay rounded-xl p-3">
            <span className="font-caption text-caption text-text-primary flex items-center gap-1.5">
              <Icon name="construction" className="text-[16px]" />
              Lapangan
            </span>
            <span className="font-body-bold text-body-bold text-text-primary block mt-1">
              {jamPendek(jam.lapanganMasuk)} - {jamPendek(jam.lapanganPulang)}
            </span>
          </div>
          <div className="bg-clay-overlay rounded-xl p-3">
            <span className="font-caption text-caption text-text-primary flex items-center gap-1.5">
              <Icon name="desk" className="text-[16px]" />
              Kantor
            </span>
            <span className="font-body-bold text-body-bold text-text-primary block mt-1">
              {jamPendek(jam.kantorMasuk)} - {jamPendek(jam.kantorPulang)}
            </span>
          </div>
        </div>

        {bisaUbah ? (
          <div className="mt-3 pt-3 border-t border-border-subtle">
            <label className="font-caption text-caption text-text-secondary">
              Ubah jam kantor
            </label>
            <div className="flex items-center gap-2 mt-1.5">
              <input
                type="time"
                value={jamKantor.masuk}
                onChange={(e) => {
                  setJamKantor((v) => ({ ...v, masuk: e.target.value }));
                  setJamBerubah(true);
                }}
                aria-label="Jam masuk kantor"
                className="min-h-11 px-3 rounded-xl bg-clay-overlay font-body-bold text-body-bold text-text-primary"
              />
              <span className="text-text-secondary">-</span>
              <input
                type="time"
                value={jamKantor.pulang}
                onChange={(e) => {
                  setJamKantor((v) => ({ ...v, pulang: e.target.value }));
                  setJamBerubah(true);
                }}
                aria-label="Jam pulang kantor"
                className="min-h-11 px-3 rounded-xl bg-clay-overlay font-body-bold text-body-bold text-text-primary"
              />
              <button
                type="button"
                onClick={() => void simpanJamKantor()}
                disabled={!jamBerubah || sibuk === "jam"}
                className="min-h-11 px-4 rounded-xl primary-gradient text-white font-body-bold text-body-bold disabled:opacity-50"
              >
                Simpan
              </button>
            </div>
            <p className="font-micro-badge text-micro-badge text-text-secondary mt-1.5">
              Berlaku untuk semua staf berjadwal kantor. Jabatan tidak ikut
              berubah.
            </p>
          </div>
        ) : null}
      </section>

      {/* Jadwal per staf */}
      <section>
        <h2 className="font-headline-3 text-headline-3 text-text-primary">
          Jadwal per Staf
        </h2>
        <p className="font-caption text-caption text-text-secondary mt-1 mb-3 leading-relaxed">
          Pegawai kantor seperti kasir, admin, dan maintainer mengikuti jam
          kantor. Personnel lapangan mengikuti jam operasional.
        </p>

        <ul className="flex flex-col gap-2">
          {staff.map((orang) => {
            const jamOrang =
              orang.workSchedule === "office"
                ? `${jamPendek(jam.kantorMasuk)} - ${jamPendek(jam.kantorPulang)}`
                : `${jamPendek(jam.lapanganMasuk)} - ${jamPendek(jam.lapanganPulang)}`;

            return (
              <li
                key={orang.id}
                className="bg-surface rounded-[20px] clay-card p-3 flex items-center gap-3"
              >
                <div className="w-11 h-11 rounded-2xl bg-clay-overlay flex items-center justify-center font-body-bold text-body-bold text-text-secondary shrink-0">
                  {initials(orang.fullName)}
                </div>

                <div className="flex-1 min-w-0">
                  <p className="font-body-bold text-body-bold text-text-primary truncate">
                    {orang.fullName}
                  </p>
                  <p className="font-caption text-caption text-text-secondary truncate">
                    {ATTENDANCE_ROLE_LABELS[orang.role] ?? orang.role} - {jamOrang}
                  </p>
                </div>

                {bisaUbah ? (
                  <div
                    role="group"
                    aria-label={`Jadwal ${orang.fullName}`}
                    className="flex gap-1 bg-clay-overlay rounded-xl p-1 shrink-0"
                  >
                    {(["field", "office"] as const).map((opsi) => {
                      const aktif = orang.workSchedule === opsi;
                      return (
                        <button
                          key={opsi}
                          type="button"
                          aria-pressed={aktif}
                          disabled={sibuk === orang.id}
                          onClick={() => void ubahJadwal(orang, opsi)}
                          className={
                            "min-h-11 px-3 rounded-lg font-caption text-caption " +
                            "flex items-center gap-1 disabled:opacity-50 " +
                            (aktif
                              ? "bg-white text-text-primary font-body-bold"
                              : "text-text-secondary active:scale-95 transition-transform")
                          }
                        >
                          <Icon name={LABEL_JADWAL[opsi].ikon} className="text-[15px]" />
                          {LABEL_JADWAL[opsi].nama}
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <span className="font-caption text-caption text-text-secondary shrink-0">
                    {LABEL_JADWAL[orang.workSchedule].nama}
                  </span>
                )}
              </li>
            );
          })}
        </ul>

        {staff.length === 0 ? (
          <p className="font-caption text-caption text-text-secondary">
            Belum ada staf di cabang ini.
          </p>
        ) : null}
      </section>
    </div>
  );
}