"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { formatTimeWib, initials } from "@/lib/format";
import {
  ATTENDANCE_ROLE_LABELS,
  ATTENDANCE_STATUS_LABELS,
  formatDistance,
  haversineMeters,
  parseTimeToMinutes,
} from "@/lib/attendance";
import {
  HARI_MINGGUAN,
  calendarCells,
  monthBounds,
  monthLabel,
  rollingMonths,
  shiftMonth,
  type MonthKey,
} from "@/lib/attendance-period";

/** Mode tampilan rekap. Harian tetap dipakai untuk melihat rincian satu hari. */
type Mode = "harian" | "bulanan" | "tiga_bulan";

type Staff = {
  id: string;
  fullName: string;
  role: string;
  roleLabel: string;
  branchId: string | null;
};

/**
 * Konfigurasi cabang yang dipakai untuk menilai satu orang. Dalam mode seluruh
 * cabang, setiap staf dinilai terhadap cabang penempatannya sendiri, bukan
 * terhadap satu cabang yang dipilih manajer.
 */
export type BranchConfig = {
  id: string;
  name: string;
  latitude: number | null;
  longitude: number | null;
  radius: number;
  openTime: string;
  closeTime: string;
};

type Log = {
  id: string;
  profileId: string;
  clockIn: string | null;
  clockOut: string | null;
  status: string;
  lateMinutes: number | null;
  lateReason: string | null;
  faceScore: number | null;
  gpsLat: number | null;
  gpsLng: number | null;
  gpsAccuracy: number | null;
  facePhotoUrl: string | null;
  clockOutPhotoUrl: string | null;
  notes: string | null;
};

type Filter = "all" | "on-time" | "late" | "off";

/**
 * Baris dari fungsi get_attendance_audit.
 *
 * Bentuknya berbeda dari Log yang dipakai tampilan harian: fungsi ini
 * mengembalikan nama dan cabang ikut serta jam jadwal yang berlaku saat
 * absen dicatat, sehingga laporan bisa menjelaskan mengapa seseorang
 * disebut terlambat tanpa perlu menebak jam masuknya.
 */
type AuditLog = {
  profileId: string;
  fullName: string;
  role: string;
  branchName: string | null;
  workSchedule: string | null;
  date: string;
  clockIn: string | null;
  clockOut: string | null;
  status: string;
  lateMinutes: number | null;
  lateReason: string | null;
  faceScore: number | null;
  liveness: boolean | null;
  expectedOpen: string | null;
  expectedClose: string | null;
  notes: string | null;
};

function mapAudit(row: Record<string, unknown>): AuditLog {
  return {
    profileId: String(row.profile_id ?? ""),
    fullName: String(row.full_name ?? ""),
    role: String(row.role ?? ""),
    branchName: (row.branch_name as string | null) ?? null,
    workSchedule: (row.work_schedule as string | null) ?? null,
    date: String(row.date ?? "").slice(0, 10),
    clockIn: (row.clock_in as string | null) ?? null,
    clockOut: (row.clock_out as string | null) ?? null,
    status: String(row.status ?? ""),
    lateMinutes:
      row.late_minutes === null || row.late_minutes === undefined
        ? null
        : Number(row.late_minutes),
    lateReason: (row.late_reason as string | null) ?? null,
    faceScore:
      row.face_score === null || row.face_score === undefined
        ? null
        : Number(row.face_score),
    liveness: row.liveness === null ? null : Boolean(row.liveness),
    expectedOpen: (row.expected_open as string | null) ?? null,
    expectedClose: (row.expected_close as string | null) ?? null,
    notes: (row.notes as string | null) ?? null,
  };
}

const LOG_COLUMNS =
  "id, profile_id, clock_in, clock_out, status, late_minutes, late_reason, face_similarity_score, gps_lat, gps_lng, gps_accuracy_meters, face_photo_url, clock_out_photo_url, notes";

function mapLog(row: Record<string, unknown>): Log {
  return {
    id: row.id as string,
    profileId: row.profile_id as string,
    clockIn: row.clock_in as string | null,
    clockOut: row.clock_out as string | null,
    status: row.status as string,
    lateMinutes: row.late_minutes === null ? null : Number(row.late_minutes),
    lateReason: row.late_reason as string | null,
    faceScore:
      row.face_similarity_score === null ? null : Number(row.face_similarity_score),
    gpsLat: row.gps_lat === null ? null : Number(row.gps_lat),
    gpsLng: row.gps_lng === null ? null : Number(row.gps_lng),
    gpsAccuracy:
      row.gps_accuracy_meters === null ? null : Number(row.gps_accuracy_meters),
    facePhotoUrl: row.face_photo_url as string | null,
    clockOutPhotoUrl: row.clock_out_photo_url as string | null,
    notes: row.notes as string | null,
  };
}

export function RekapConsole({
  profile,
  branch,
  branchConfigs,
  crossBranch,
  today,
  staff,
  todayLogs,
  kasStatus,
}: {
  profile: { id: string; fullName: string; role: string; roleLabel: string };
  branch: BranchConfig;
  /**
   * Konfigurasi semua cabang yang tampil, memakai id cabang sebagai kunci.
   * Kosong saat pengguna memilih satu cabang saja.
   */
  branchConfigs: Record<string, BranchConfig>;
  /** true saat pengguna sedang melihat seluruh cabang sekaligus. */
  crossBranch: boolean;
  today: string;
  staff: Staff[];
  todayLogs: Log[];
  kasStatus: { opening: number; status: string } | null;
}) {
  const [date, setDate] = useState(today);
  const isToday = date === today;
  const [logsState, setLogs] = useState<Log[]>([]);
  const logs = isToday ? todayLogs : logsState;
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [modal, setModal] = useState<{ staff: Staff; log: Log } | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [photoPending, setPhotoPending] = useState(false);

  // Kalender dan rekap tiga bulan memakai satu sumber data: fungsi
  // get_attendance_audit, yang sudah membatasi rentang 120 hari di server.
  const [mode, setMode] = useState<Mode>("harian");
  const [bulan, setBulan] = useState<MonthKey>(today.slice(0, 7));
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditError, setAuditError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  // Konfigurasi cabang yang relevan untuk satu orang. Saat satu cabang
  // dipilih semua orang memakai config itu; saat lintas cabang, tiap orang
  // memakai cabang penempatannya dan null bila config-nya tidak tersedia,
  // supaya UI tidak pernah memvonis geofence memakai koordinat cabang lain.
  const configFor = useCallback(
    (person: Staff): BranchConfig | null => {
      if (!crossBranch) return branch;
      if (person.branchId && branchConfigs[person.branchId]) {
        return branchConfigs[person.branchId];
      }
      return null;
    },
    [branch, branchConfigs, crossBranch],
  );

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const hasLoaded = useRef(false);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const loadLogs = useCallback(async () => {}, []);

  useEffect(() => {
    if (isToday) return;
    let active = true;
    (async () => {
      setLoading(true);
      setError(null);
      const supabase = createClient();
      const { data, error: err } = await supabase
        .from("attendance_logs")
        .select(LOG_COLUMNS)
        .eq("date", date);
      if (!active) return;
      if (err) {
        setError(err.message);
      } else {
        setLogs((data ?? []).map((row) => mapLog(row as Record<string, unknown>)));
        setError(null);
      }
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [date, isToday]);

  useEffect(() => {
    if (!isToday) return;
    // sync when todayLogs changes
  }, [todayLogs, isToday]);

  // Rentang yang dimuat diturunkan dari mode, bukan disimpan di state, supaya
  // tidak ada render kedua hanya untuk menyelaraskan keduanya.
  const rentang = useMemo(
    () =>
      mode === "bulanan"
        ? monthBounds(bulan)
        : mode === "tiga_bulan"
          ? rollingMonths(today)
          : { from: today, to: today },
    [mode, bulan, today],
  );

  useEffect(() => {
    if (mode === "harian") return;
    let active = true;
    (async () => {
      setAuditLoading(true);
      setAuditError(null);
      const supabase = createClient();
      const { data, error: err } = await supabase.rpc("get_attendance_audit", {
        p_from: rentang.from,
        p_to: rentang.to,
      });
      if (!active) return;
      if (err) {
        setAuditError(err.message);
        setAuditLogs([]);
      } else {
        setAuditLogs(
          ((data ?? []) as Record<string, unknown>[]).map((row) => mapAudit(row)),
        );
        setAuditError(null);
      }
      setAuditLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [mode, rentang.from, rentang.to]);

  /** Jumlah kemunculan tiap tanggal, dipakai untuk mewarnai sel kalender. */
  const perTanggal = useMemo(() => {
    const map = new Map<string, { hadir: number; late: number; off: number }>();
    for (const log of auditLogs) {
      const cur = map.get(log.date) ?? { hadir: 0, late: 0, off: 0 };
      if (log.status === "hadir") {
        cur.hadir += 1;
        if ((log.lateMinutes ?? 0) > 0) cur.late += 1;
      } else if (["izin", "sakit", "libur_shift"].includes(log.status)) {
        cur.off += 1;
      }
      map.set(log.date, cur);
    }
    return map;
  }, [auditLogs]);

  const selBulan = useMemo(
    () => calendarCells(bulan, today),
    [bulan, today],
  );

  const ringkasanPerStaff = useMemo(() => {
    const map = new Map<
      string,
      { nama: string; peran: string; hadir: number; late: number; menit: number; izin: number }
    >();
    for (const log of auditLogs) {
      const cur = map.get(log.profileId) ?? {
        nama: log.fullName,
        peran: log.role,
        hadir: 0,
        late: 0,
        menit: 0,
        izin: 0,
      };
      if (log.status === "hadir") {
        cur.hadir += 1;
        const menit = log.lateMinutes ?? 0;
        if (menit > 0) {
          cur.late += 1;
          cur.menit += menit;
        }
      } else if (["izin", "sakit", "libur_shift"].includes(log.status)) {
        cur.izin += 1;
      }
      map.set(log.profileId, cur);
    }
    return [...map.entries()].sort((a, b) => a[1].nama.localeCompare(b[1].nama, "id"));
  }, [auditLogs]);

  const ringkasanBulan = useMemo(() => {
    const map = new Map<string, { hadir: number; late: number; izin: number }>();
    for (const log of auditLogs) {
      const key = log.date.slice(0, 7);
      const cur = map.get(key) ?? { hadir: 0, late: 0, izin: 0 };
      if (log.status === "hadir") {
        cur.hadir += 1;
        if ((log.lateMinutes ?? 0) > 0) cur.late += 1;
      } else if (["izin", "sakit", "libur_shift"].includes(log.status)) {
        cur.izin += 1;
      }
      map.set(key, cur);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [auditLogs]);

  const logByProfile = useMemo(() => {
    const map = new Map<string, Log>();
    for (const log of logs) map.set(log.profileId, log);
    return map;
  }, [logs]);

  const hasStatus = (log: Log, statuses: string[]) => statuses.includes(log.status);

  const summary = useMemo(() => {
    let hadir = 0;
    let onTime = 0;
    let late = 0;
    let off = 0;
    for (const log of logs) {
      if (log.status === "hadir") {
        hadir += 1;
        if (log.lateMinutes !== null && log.lateMinutes > 0) {
          late += 1;
        } else {
          onTime += 1;
        }
      } else if (hasStatus(log, ["izin", "sakit", "libur_shift"])) {
        off += 1;
      }
    }
    const belumAbsen = Math.max(0, staff.length - hadir - off);
    return { hadir, onTime, late, off, belumAbsen };
  }, [logs, staff.length]);

  const percent =
    staff.length > 0 ? Math.round((summary.hadir / staff.length) * 100) : 0;

  const visibleStaff = useMemo(() => {
    if (filter === "all") return staff;
    return staff.filter((person) => {
      const log = logByProfile.get(person.id);
      if (filter === "on-time") {
        return log?.status === "hadir" && (log.lateMinutes ?? 0) <= 0;
      }
      if (filter === "late") {
        return log?.status === "hadir" && (log.lateMinutes ?? 0) > 0;
      }
      if (filter === "off") {
        return (
          log !== undefined &&
          hasStatus(log, ["izin", "sakit", "libur_shift"])
        );
      }
      return true;
    });
  }, [filter, logByProfile, staff]);

  const dateLabel = useMemo(
    () =>
      new Intl.DateTimeFormat("id-ID", {
        timeZone: "Asia/Jakarta",
        day: "numeric",
        month: "short",
        year: "numeric",
      }).format(new Date(`${date}T00:00:00+07:00`)),
    [date],
  );

  const shiftDate = (delta: number) => {
    const base = new Date(`${date}T00:00:00+07:00`);
    base.setDate(base.getDate() + delta);
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Jakarta",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(base);
  };

  const openModal = useCallback(async (person: Staff, log: Log) => {
    setModal({ staff: person, log });
    setPhotoUrl(null);
    setPhotoPending(true);
    const path = log.facePhotoUrl ?? log.clockOutPhotoUrl;
    if (path) {
      try {
        const supabase = createClient();
        const { data } = await supabase.storage
          .from("attendance-photos")
          .createSignedUrl(path, 300);
        setPhotoUrl(data?.signedUrl ?? null);
      } catch {
        setPhotoUrl(null);
      }
    }
    setPhotoPending(false);
  }, []);

  /**
   * Berkas Excel mengikuti mode yang sedang dilihat.
   *
   * Mode harian menghasilkan satu lembar rincian untuk hari itu. Mode bulanan
   * dan tiga bulan menambah lembar ringkasan per bulan dan rekap per staf,
   * karena angka mentah tiga bulan terlalu panjang untuk dibaca.
   */
  const exportExcel = useCallback(async () => {
    setExporting(true);
    setAuditError(null);
    try {
      const XLSX = await import("xlsx");

      const header = [
        "Tanggal",
        "Staf",
        "Peran",
        "Cabang",
        "Jadwal Kerja",
        "Jam Masuk Berlaku",
        "Jam Pulang Berlaku",
        "Status",
        "Masuk",
        "Pulang",
        "Terlambat (menit)",
        "Alasan Terlambat",
        "Kemiripan Wajah (%)",
        "Liveness Lulus",
        "Catatan",
      ];

      const jamBuka = (s: string | null): string => (s ? s.slice(0, 5) : "");
      const jadwal = (s: string | null): string =>
        s === "office" ? "Kantor" : s === "field" ? "Lapangan" : "";

      let baris: (string | number | boolean)[][];
      if (mode === "harian") {
        baris = staff.map((person) => {
          const log = logByProfile.get(person.id);
          const config = configFor(person);
          return [
            date,
            person.fullName,
            person.roleLabel,
            config?.name ?? branch.name,
            "",
            jamBuka(config?.openTime ?? null),
            jamBuka(config?.closeTime ?? null),
            log ? ATTENDANCE_STATUS_LABELS[log.status] ?? log.status : "Belum absen",
            log?.clockIn ? formatTimeWib(log.clockIn) : "",
            log?.clockOut ? formatTimeWib(log.clockOut) : "",
            log?.lateMinutes ?? "",
            log?.lateReason ?? "",
            log?.faceScore !== null && log?.faceScore !== undefined
              ? Math.round(log.faceScore * 100)
              : "",
            log ? "Ya" : "",
            log?.notes ?? "",
          ];
        });
      } else {
        baris = auditLogs.map((log) => [
          log.date,
          log.fullName,
          ATTENDANCE_ROLE_LABELS[log.role] ?? log.role,
          log.branchName ?? "",
          jadwal(log.workSchedule),
          jamBuka(log.expectedOpen),
          jamBuka(log.expectedClose),
          ATTENDANCE_STATUS_LABELS[log.status] ?? log.status,
          log.clockIn ? formatTimeWib(log.clockIn) : "",
          log.clockOut ? formatTimeWib(log.clockOut) : "",
          log.lateMinutes ?? "",
          log.lateReason ?? "",
          log.faceScore === null ? "" : Math.round(Number(log.faceScore) * 100),
          log.liveness === null ? "" : log.liveness ? "Ya" : "Tidak",
          log.notes ?? "",
        ]);
      }

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(
        wb,
        XLSX.utils.aoa_to_sheet([header, ...baris]),
        "Detail Kehadiran",
      );

      if (mode !== "harian") {
        XLSX.utils.book_append_sheet(
          wb,
          XLSX.utils.aoa_to_sheet([
            ["Bulan", "Hadir", "Terlambat", "Izin / Sakit"],
            ...ringkasanBulan.map(([key, v]) => [
              monthLabel(key),
              v.hadir,
              v.late,
              v.izin,
            ]),
          ]),
          "Ringkasan Bulanan",
        );

        XLSX.utils.book_append_sheet(
          wb,
          XLSX.utils.aoa_to_sheet([
            [
              "Staf",
              "Peran",
              "Hadir",
              "Terlambat",
              "Total Menit Terlambat",
              "Izin / Sakit",
            ],
            ...ringkasanPerStaff.map(([, v]) => [
              v.nama,
              ATTENDANCE_ROLE_LABELS[v.peran] ?? v.peran,
              v.hadir,
              v.late,
              v.menit,
              v.izin,
            ]),
          ]),
          "Rekap per Staf",
        );
      }

      const nama =
        mode === "harian"
          ? `Rekap-Harian-${date}.xlsx`
          : mode === "bulanan"
            ? `Rekap-Bulanan-${bulan}.xlsx`
            : `Rekap-3-Bulan-${rentang.from}_sd_${rentang.to}.xlsx`;

      XLSX.writeFile(wb, nama);
    } catch (err) {
      setAuditError(
        err instanceof Error
          ? `Gagal membuat berkas Excel: ${err.message}`
          : "Gagal membuat berkas Excel. Coba lagi.",
      );
    } finally {
      setExporting(false);
    }
  }, [
    auditLogs,
    branch.name,
    configFor,
    date,
    bulan,
    logByProfile,
    mode,
    rentang.from,
    rentang.to,
    ringkasanBulan,
    ringkasanPerStaff,
    staff,
  ]);

  const filterPills: { key: Filter; label: string; count: number }[] = [
    { key: "all", label: "Semua Staf", count: staff.length },
    { key: "on-time", label: "Hadir On-Time", count: summary.onTime },
    { key: "late", label: "Terlambat", count: summary.late },
    { key: "off", label: "Izin / Cuti", count: summary.off },
  ];

  return (
    <div className="flex flex-col w-full pb-[calc(68px+env(safe-area-inset-bottom)+24px)]">
      {/* Micro-bar: status geofence + export */}
      <section className="px-gutter pt-3">
        <div className="bg-clay-overlay rounded-xl px-3 py-2.5 flex items-center justify-between border border-border-subtle">
          <span className="font-caption text-caption text-success-text flex items-center gap-1.5">
            <span className="material-symbols-outlined text-[15px]">radar</span>
            {crossBranch
              ? "Geofence mengikuti cabang tiap staf"
              : `Geofence ${Math.round(branch.radius)}m Aktif`}
          </span>
          <button
            type="button"
            onClick={() => void exportExcel()}
            disabled={exporting}
            className="min-h-11 px-3 rounded-lg bg-brand-50 text-brand-700 font-caption text-caption flex items-center gap-1.5 active:scale-95 transition-transform disabled:opacity-60"
          >
            <span className="material-symbols-outlined text-[15px]">
              {exporting ? "hourglass_top" : "download"}
            </span>
            {exporting ? "Menyusun" : mode === "tiga_bulan" ? "Excel 3 Bulan" : "Laporan"}
          </button>
        </div>
      </section>

      {/* Pemilih tampilan: harian, kalender bulanan, atau tiga bulan bergulir */}
      <section className="px-gutter pt-3">
        <div
          role="tablist"
          aria-label="Tampilan rekap"
          className="bg-clay-overlay rounded-xl p-1 flex gap-1 border border-border-subtle"
        >
          {(
            [
              { key: "harian", label: "Harian", icon: "today" },
              { key: "bulanan", label: "Bulanan", icon: "calendar_month" },
              { key: "tiga_bulan", label: "3 Bulan", icon: "date_range" },
            ] as { key: Mode; label: string; icon: string }[]
          ).map((tab) => (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={mode === tab.key}
              onClick={() => setMode(tab.key)}
              className={
                "flex-1 min-h-11 rounded-lg font-caption text-caption flex items-center " +
                "justify-center gap-1.5 transition-colors " +
                (mode === tab.key
                  ? "bg-white text-text-primary shadow-sm font-body-bold"
                  : "text-text-secondary active:scale-95 transition-transform")
              }
            >
              <span className="material-symbols-outlined text-[15px]">{tab.icon}</span>
              {tab.label}
            </button>
          ))}
        </div>
      </section>

      {mode !== "harian" ? (
        <BulananPanel
          mode={mode}
          bulan={bulan}
          setBulan={setBulan}
          sel={selBulan}
          perTanggal={perTanggal}
          ringkasanBulan={ringkasanBulan}
          ringkasanPerStaff={ringkasanPerStaff}
          rentang={rentang}
          memuat={auditLoading}
          galat={auditError}
          padaHari={(tanggal) => {
            setDate(tanggal);
            setMode("harian");
          }}
        />
      ) : (
        <>

      {/* Hero ringkasan */}
      <section className="px-gutter pt-4">
        <div className="relative overflow-hidden rounded-[24px] p-5 primary-gradient text-on-primary clay-glow">
          <div className="absolute -right-6 -bottom-6 opacity-10 pointer-events-none text-white">
            <span className="material-symbols-outlined text-[130px]">groups</span>
          </div>
          <div className="relative z-10 flex flex-col gap-3">
            <div className="flex items-center justify-between gap-2">
              <span className="font-caption text-caption text-brand-100 flex items-center gap-1.5">
                <span className="material-symbols-outlined text-[16px]">calendar_today</span>
                Kehadiran ({dateLabel})
              </span>
              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full bg-white/20 backdrop-blur-md font-micro-badge text-micro-badge text-white uppercase tracking-wider">
                {kasStatus
                  ? kasStatus.status === "closed"
                    ? "Shift Tutup"
                    : "Shift Aktif"
                  : "Shift Belum Buka"}
              </span>
            </div>
            <div className="flex items-end justify-between gap-3">
              <div>
                <span className="font-metric-display text-metric-display text-white tracking-tight leading-none">
                  {summary.hadir} dari {staff.length} Staf Hadir
                </span>
              </div>
              <span className="font-headline-2 text-headline-2 text-brand-100 shrink-0">
                {percent}%
              </span>
            </div>
            <div className="w-full bg-white/25 rounded-full h-2 overflow-hidden">
              <div
                className="bg-white h-2 rounded-full transition-all"
                style={{ width: `${percent}%` }}
              />
            </div>
            <div className="flex flex-wrap gap-2 pt-1">
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-white/15 backdrop-blur-md font-caption text-caption text-white">
                On-Time {summary.onTime}
              </span>
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-white/15 backdrop-blur-md font-caption text-caption text-white">
                Terlambat {summary.late}
              </span>
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-white/15 backdrop-blur-md font-caption text-caption text-white">
                Izin/Cuti {summary.off}
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* Navigasi tanggal */}
      <section className="px-gutter pt-4">
        <div className="bg-surface rounded-2xl p-3 clay-card border border-white/80 flex items-center gap-3">
          <button
            type="button"
            onClick={() => setDate(shiftDate(-1))}
            disabled={loading}
            aria-label="Hari sebelumnya"
            className="w-11 h-11 rounded-xl bg-surface-container-low text-text-secondary flex items-center justify-center active:scale-95 transition-transform disabled:opacity-50"
          >
            <span className="material-symbols-outlined text-[20px]">chevron_left</span>
          </button>
          <div className="flex-1 text-center">
            <span
              className={`font-body-bold text-body-bold block ${
                loading ? "opacity-50" : ""
              }`}
            >
              {dateLabel}
            </span>
            <span className="font-caption text-caption text-text-muted">
              {isToday
                ? "Hari ini"
                : profile.role === "owner" || profile.role === "maintainer"
                  ? "Arsip kehadiran"
                  : "Arsip kehadiran"}
            </span>
          </div>
          <button
            type="button"
            onClick={() => setDate(shiftDate(1))}
            disabled={loading || isToday}
            aria-label="Hari berikutnya"
            className="w-11 h-11 rounded-xl bg-surface-container-low text-text-secondary flex items-center justify-center active:scale-95 transition-transform disabled:opacity-50"
          >
            <span className="material-symbols-outlined text-[20px]">chevron_right</span>
          </button>
        </div>
      </section>

      {/* Filter pill */}
      <section className="px-gutter pt-4">
        <div className="flex gap-2 overflow-x-auto no-scrollbar">
          {filterPills.map((pill) => (
            <button
              key={pill.key}
              type="button"
              onClick={() => setFilter(pill.key)}
              className={`min-h-11 px-3.5 rounded-full font-caption text-caption shrink-0 flex items-center gap-1.5 active:scale-95 transition-transform ${
                filter === pill.key
                  ? "primary-gradient text-white"
                  : "bg-surface text-text-secondary clay-card"
              }`}
            >
              {pill.label} ({pill.count})
            </button>
          ))}
        </div>
      </section>

      {error ? (
        <section className="px-gutter pt-3">
          <div className="p-3 rounded-xl bg-danger-surface text-danger-text font-body text-body flex items-center gap-2">
            <span className="material-symbols-outlined text-[18px]">error</span>
            <span className="flex-1">{error}</span>
          </div>
        </section>
      ) : null}

      {/* Kartu staf */}
      <section className="px-gutter pt-3 space-y-2.5">
        {visibleStaff.length === 0 ? (
          <div className="bg-surface rounded-2xl p-5 clay-card text-center">
            <span className="font-caption text-caption text-text-muted">
              Tidak ada staf pada kategori ini.
            </span>
          </div>
        ) : (
          visibleStaff.map((person) => {
            const log = logByProfile.get(person.id);
            const config = configFor(person);
            const distance =
              log?.gpsLat !== null &&
              log?.gpsLat !== undefined &&
              log?.gpsLng !== null &&
              log?.gpsLng !== undefined &&
              config?.latitude != null &&
              config?.longitude != null
                ? haversineMeters(
                    config.latitude,
                    config.longitude,
                    log.gpsLat,
                    log.gpsLng,
                  )
                : null;
            const isLate = log?.status === "hadir" && (log.lateMinutes ?? 0) > 0;
            const hasPhoto = Boolean(log?.facePhotoUrl ?? log?.clockOutPhotoUrl);

            let clockInLine: string | null = null;
            if (log?.clockIn) {
              const text = `Masuk: ${formatTimeWib(log.clockIn)} WIB`;
              // "m awal" hanya boleh dihitung terhadap jam buka cabang orang
              // itu. Tanpa config, teksnya ditampilkan polos supaya tidak
              // muncul angka yang berasal dari cabang lain.
              if (config) {
                const openMin = parseTimeToMinutes(config.openTime);
                const clockInMin = parseTimeToMinutes(formatTimeWib(log.clockIn));
                const early = openMin - clockInMin;
                clockInLine = early > 0 ? `${text} (${early}m awal)` : text;
              } else {
                clockInLine = text;
              }
            }

            return (
              <div
                key={person.id}
                className={`relative bg-surface overflow-hidden rounded-[20px] clay-card border border-white/80 ${
                  isLate ? "l" : ""
                }`}
              >
                {isLate ? (
                  <div className="absolute left-0 top-0 bottom-0 w-1.5 bg-warning-base" />
                ) : null}
                <div className="p-4 flex items-start gap-3">
                  <div className="relative shrink-0">
                    <div
                      className={`w-12 h-12 rounded-2xl flex items-center justify-center font-body-bold text-body-bold ${
                        !log
                          ? "bg-surface-container text-text-secondary"
                          : isLate
                            ? "bg-warning-surface text-warning-text"
                            : "bg-success-surface text-success-text"
                      }`}
                    >
                      {initials(person.fullName)}
                    </div>
                    <span
                      className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-white ${
                        !log
                          ? "bg-text-muted"
                          : isLate
                            ? "bg-warning-base"
                            : "bg-success-base"
                      }`}
                    />
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-body-bold text-body-bold text-text-primary truncate">
                        {person.fullName}
                      </span>
                      <span className="font-micro-badge text-micro-badge px-2 py-0.5 rounded-full bg-brand-50 text-brand-700 shrink-0">
                        {person.roleLabel}
                      </span>
                    </div>

                    {!log ? (
                      <p className="font-caption text-caption text-text-muted mt-1">
                        Belum absen pada {dateLabel}
                      </p>
                    ) : (
                      <>
                        <div className="mt-1 flex items-center justify-between gap-2">
                          <span className="font-caption text-caption text-text-primary">
                            {clockInLine ?? "Belum ada jam masuk"}
                          </span>
                          <span
                            className={`font-micro-badge text-micro-badge px-2 py-0.5 rounded-full shrink-0 ${
                              ATTENDANCE_STATUS_STYLE(log)
                            }`}
                          >
                            {ATTENDANCE_STATUS_LABELS[log.status] ?? log.status}
                          </span>
                        </div>

                        {isLate && log.lateMinutes ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-warning-surface text-warning-text font-micro-badge text-micro-badge mt-1.5">
                            <span className="material-symbols-outlined text-[13px]">
                              running_with_errors
                            </span>
                            Terlambat {log.lateMinutes} menit
                            {config ? ` (Batas Shift ${config.openTime.slice(0, 5)} WIB)` : ""}
                          </span>
                        ) : null}

                        <div className="flex flex-wrap gap-1.5 mt-2">
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-clay-overlay text-text-secondary font-caption text-caption">
                            <span className="material-symbols-outlined text-[13px] text-brand-500">
                              location_on
                            </span>
                            {distance === null
                              ? "GPS -"
                              : `GPS Verified (${formatDistance(distance)})`}
                          </span>
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-clay-overlay text-text-secondary font-caption text-caption">
                            <span className="material-symbols-outlined text-[13px] text-brand-500">
                              face
                            </span>
                            {log.faceScore === null
                              ? "Face ID -"
                              : `Face ID ${Math.round(log.faceScore * 100)}% Match`}
                          </span>
                          {hasPhoto ? (
                            <button
                              type="button"
                              onClick={() => void openModal(person, log)}
                              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-surface border border-brand-200 text-brand-700 font-caption text-caption active:scale-95 transition-transform"
                            >
                              <span className="material-symbols-outlined text-[13px]">
                                photo_camera
                              </span>
                              Selfie
                            </button>
                          ) : null}
                        </div>
                      </>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </section>

      {/* Micro footer */}
      <section className="px-gutter pt-3">
        <p className="font-caption text-caption text-text-muted text-center">
          Auto-Sync Cloud POS: Real-Time • Data kehadiran diverifikasi geofence &
          Face ID
        </p>
      </section>

      {/* Modal verifikasi selfie */}
      {modal ? (
        <VerificationModal
          modal={modal}
          photoUrl={photoUrl}
          photoPending={photoPending}
          branch={configFor(modal.staff) ?? branch}
          onClose={() => {
            setModal(null);
            setPhotoUrl(null);
          }}
        />
      ) : null}
        </>
      )}
    </div>
  );
}

/**
 * Panel kalender bulanan dan rekap tiga bulan.
 *
 * Dipisah dari RekapConsole supaya perhitungannya tidak menambah ukuran
 * komponen yang juga menangani rincian harian.
 */
function BulananPanel({
  mode,
  bulan,
  setBulan,
  sel,
  perTanggal,
  ringkasanBulan,
  ringkasanPerStaff,
  rentang,
  memuat,
  galat,
  padaHari,
}: {
  mode: Mode;
  bulan: MonthKey;
  setBulan: (v: MonthKey) => void;
  sel: ReturnType<typeof calendarCells>;
  perTanggal: Map<string, { hadir: number; late: number; off: number }>;
  ringkasanBulan: [string, { hadir: number; late: number; izin: number }][];
  ringkasanPerStaff: [
    string,
    { nama: string; peran: string; hadir: number; late: number; menit: number; izin: number },
  ][];
  rentang: { from: string; to: string };
  memuat: boolean;
  galat: string | null;
  padaHari: (tanggal: string) => void;
}) {
  return (
    <section className="px-gutter pt-4 flex flex-col gap-4">
      {galat ? (
        <div
          role="alert"
          className="bg-error-surface text-error-text rounded-xl px-3 py-2.5 font-caption text-caption"
        >
          Gagal memuat rekap: {galat}
        </div>
      ) : null}

      {mode === "bulanan" ? (
        <div className="bg-surface rounded-[20px] clay-card p-4">
          <div className="flex items-center justify-between mb-3">
            <button
              type="button"
              aria-label="Bulan sebelumnya"
              onClick={() => setBulan(shiftMonth(bulan, -1))}
              className="w-11 h-11 rounded-xl bg-clay-overlay flex items-center justify-center text-text-primary active:scale-95 transition-transform"
            >
              <span className="material-symbols-outlined text-[20px]">
                chevron_left
              </span>
            </button>
            <span className="font-headline-3 text-headline-3 text-text-primary">
              {monthLabel(bulan)}
            </span>
            <button
              type="button"
              aria-label="Bulan berikutnya"
              onClick={() => setBulan(shiftMonth(bulan, 1))}
              className="w-11 h-11 rounded-xl bg-clay-overlay flex items-center justify-center text-text-primary active:scale-95 transition-transform"
            >
              <span className="material-symbols-outlined text-[20px]">
                chevron_right
              </span>
            </button>
          </div>

          <div className="grid grid-cols-7 gap-1 mb-1">
            {HARI_MINGGUAN.map((h) => (
              <div
                key={h}
                className="text-center font-micro-badge text-micro-badge text-text-tertiary"
              >
                {h}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-1">
            {sel.map((c) => {
              const n = perTanggal.get(c.date);
              const ada = n !== undefined && (n.hadir > 0 || n.off > 0);
              const classes = [
                "min-h-11 rounded-lg flex flex-col items-center justify-center",
                c.inMonth ? "text-text-primary" : "text-text-tertiary/50",
                c.isToday ? "ring-2 ring-brand-500" : "",
                ada ? "bg-surface-container font-body-bold" : "",
              ].join(" ");
              return (
                <button
                  key={c.date}
                  type="button"
                  disabled={!c.inMonth}
                  onClick={() => padaHari(c.date)}
                  aria-label={
                    ada
                      ? `${c.date}, ${n.hadir} hadir, ${n.late} terlambat`
                      : c.date
                  }
                  className={classes}
                >
                  <span className="font-caption text-caption">{c.day}</span>
                  {ada ? (
                    <span className="font-micro-badge text-micro-badge text-text-secondary">
                      {n.hadir}/{n.hadir + n.off}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>

          <p className="font-micro-badge text-micro-badge text-text-secondary mt-3">
            Angka menunjukkan jumlah hadir dari total yang tercatat. Ketuk satu
            hari untuk melihat rinciannya.
          </p>
        </div>
      ) : (
        <div className="bg-surface rounded-[20px] clay-card p-4">
          <span className="font-headline-3 text-headline-3 text-text-primary">
            Tiga Bulan Terakhir
          </span>
          <p className="font-caption text-caption text-text-secondary mt-1">
            {rentang.from} sampai {rentang.to}
          </p>
        </div>
      )}

      {memuat ? (
        <div className="flex items-center justify-center gap-2 py-6 text-text-secondary">
          <span className="material-symbols-outlined text-[18px] animate-spin">
            progress_activity
          </span>
          <span className="font-caption text-caption">Memuat rekap</span>
        </div>
      ) : null}

      {mode === "bulanan" && ringkasanBulan.length > 0 ? (
        <TabelRekap
          judul="Ringkasan Bulan Ini"
          kolom={["Tanggal", "Hadir", "Terlambat", "Izin"]}
          baris={ringkasanBulan.map(([key, v]) => [
            key.slice(8) + " " + monthLabel(key).split(" ")[0],
            String(v.hadir),
            String(v.late),
            String(v.izin),
          ])}
        />
      ) : null}

      {mode === "tiga_bulan" && ringkasanBulan.length > 0 ? (
        <TabelRekap
          judul="Ringkasan Per Bulan"
          kolom={["Bulan", "Hadir", "Terlambat", "Izin"]}
          baris={ringkasanBulan.map(([key, v]) => [
            monthLabel(key),
            String(v.hadir),
            String(v.late),
            String(v.izin),
          ])}
        />
      ) : null}

      {!memuat && ringkasanPerStaff.length > 0 ? (
        <TabelRekap
          judul="Rekap per Staf"
          kolom={["Staf", "Hadir", "Terlambat", "Menit", "Izin"]}
          baris={ringkasanPerStaff.map(([, v]) => [
            v.nama,
            String(v.hadir),
            String(v.late),
            String(v.menit),
            String(v.izin),
          ])}
        />
      ) : null}

      {!memuat && !galat && auditKosongTXT(ringkasanPerStaff, ringkasanBulan) ? (
        <div className="bg-clay-overlay rounded-xl px-4 py-5 text-center">
          <span className="material-symbols-outlined text-[28px] text-text-tertiary">
            event_busy
          </span>
          <p className="font-body-bold text-body-bold text-text-primary mt-1">
            Belum ada data pada periode ini
          </p>
          <p className="font-caption text-caption text-text-secondary mt-1">
            Rekap hanya memuat tiga bulan terakhir. Data yang lebih lama sudah
            dihapus otomatis oleh sistem.
          </p>
        </div>
      ) : null}
    </section>
  );
}

function auditKosongTXT(
  perStaff: [string, unknown][],
  perBulan: [string, unknown][],
): boolean {
  return perStaff.length === 0 && perBulan.length === 0;
}

/** Tabel ringkasan sederhana yang bisa digulir secara horizontal di layar sempit. */
function TabelRekap({
  judul,
  kolom,
  baris,
}: {
  judul: string;
  kolom: string[];
  baris: string[][];
}) {
  return (
    <div className="bg-surface rounded-[20px] clay-card overflow-hidden">
      <div className="px-4 pt-4 pb-2">
        <span className="font-headline-3 text-headline-3 text-text-primary">
          {judul}
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left">
          <thead>
            <tr className="bg-clay-overlay">
              {kolom.map((k) => (
                <th
                  key={k}
                  scope="col"
                  className="px-3 py-2 font-micro-badge text-micro-badge text-text-secondary whitespace-nowrap"
                >
                  {k}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {baris.map((b, i) => (
              <tr key={i} className="border-t border-border-subtle">
                {b.map((sel, j) => (
                  <td
                    key={j}
                    className={
                      "px-3 py-2.5 font-caption text-caption " +
                      (j === 0 ? "text-text-primary whitespace-nowrap" : "text-text-secondary")
                    }
                  >
                    {sel}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ACCENT_STATUS_STYLE(log: Log): string {
  if (log.status === "hadir") {
    return "bg-success-surface text-success-text";
  }
  if (log.status === "izin") return "bg-warning-surface text-warning-text";
  if (log.status === "sakit") return "bg-danger-surface text-danger-text";
  return "bg-surface-container text-text-secondary";
}

function ATTENDANCE_STATUS_STYLE(log: Log): string {
  return ACCENT_STATUS_STYLE(log);
}

function VerificationModal({
  modal,
  photoUrl,
  photoPending,
  branch,
  onClose,
}: {
  modal: { staff: Staff; log: Log };
  photoUrl: string | null;
  photoPending: boolean;
  branch: {
    latitude: number | null;
    longitude: number | null;
    radius: number;
    openTime: string;
    closeTime: string;
  };
  onClose: () => void;
}) {
  const log = modal.log;
  const distance =
    log.gpsLat !== null &&
    log.gpsLng !== null &&
    branch.latitude !== null &&
    branch.longitude !== null
      ? haversineMeters(branch.latitude, branch.longitude, log.gpsLat, log.gpsLng)
      : null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 flex items-end sm:items-center justify-center"
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-[420px] bg-surface rounded-t-[24px] sm:rounded-[24px] overflow-hidden flex flex-col">
        <div className="px-4 pt-4 flex items-center gap-3">
          <div
            className={`w-10 h-10 rounded-2xl flex items-center justify-center font-body-bold text-body-bold shrink-0 ${
              log.status === "hadir" && !log.lateMinutes
                ? "bg-success-surface text-success-text"
                : "bg-warning-surface text-warning-text"
            }`}
          >
            {initials(modal.staff.fullName)}
          </div>
          <div className="flex-1 min-w-0">
            <span className="font-body-bold text-body-bold text-text-primary block">
              Verifikasi {modal.staff.fullName}
            </span>
            <span className="font-caption text-caption text-text-muted">
              {modal.staff.roleLabel} • {log.clockIn ? formatTimeWib(log.clockIn) : "--:--"} WIB
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Tutup"
            className="w-9 h-9 rounded-xl bg-surface-container-low text-text-secondary flex items-center justify-center active:scale-95 transition-transform shrink-0"
          >
            <span className="material-symbols-outlined text-[18px]">close</span>
          </button>
        </div>

        <div className="px-4 pt-3">
          <div className="relative aspect-[4/3] rounded-[16px] bg-surface-container-low overflow-hidden">
            {photoPending ? (
              <p className="absolute inset-0 flex items-center justify-center font-caption text-caption text-text-muted">
                Memuat foto verifikasi...
              </p>
            ) : photoUrl ? (
              <img
                src={photoUrl}
                alt={`Foto verifikasi ${modal.staff.fullName}`}
                className="w-full h-full object-cover"
              />
            ) : (
              <p className="absolute inset-0 flex items-center justify-center font-caption text-caption text-text-muted">
                Foto tidak tersedia.
              </p>
            )}
            {photoUrl ? (
              <span className="absolute top-3 right-3 inline-flex items-center gap-1 px-2 py-1 rounded-full bg-emerald-500 text-white font-micro-badge text-micro-badge shadow">
                <span className="material-symbols-outlined text-[13px]">verified</span>
                VERIFIED
              </span>
            ) : null}
          </div>
        </div>

        <div className="px-4 py-4 space-y-2">
          <div className="bg-surface-container-low rounded-2xl p-3 flex items-center justify-between">
            <span className="font-caption text-caption text-text-secondary flex items-center gap-1.5">
              <span className="material-symbols-outlined text-[15px] text-brand-500">
                location_on
              </span>
              Geofence {Math.round(branch.radius)}m
            </span>
            <span className="font-caption text-caption text-text-primary">
              {distance === null
                ? "GPS tidak tersedia"
                : distance <= branch.radius
                  ? `Di dalam radius (${formatDistance(distance)})`
                  : `${formatDistance(distance)} di luar radius`}
            </span>
          </div>
          <div className="bg-surface-container-low rounded-2xl p-3 flex items-center justify-between">
            <span className="font-caption text-caption text-text-secondary flex items-center gap-1.5">
              <span className="material-symbols-outlined text-[15px] text-brand-500">
                face
              </span>
              Kemiripan Sampel Wajah
            </span>
            <span className="font-body-bold text-body-bold text-text-primary">
              {log.faceScore === null ? "-" : `${Math.round(log.faceScore * 100)}% Match`}
            </span>
          </div>
          {log.notes ? (
            <div className="bg-clay-overlay rounded-2xl p-3">
              <span className="font-caption text-caption text-text-muted">
                Catatan {modal.staff.fullName}
              </span>
              <p className="font-caption text-caption text-text-primary mt-0.5">
                {log.notes}
              </p>
            </div>
          ) : null}
          <button
            type="button"
            onClick={onClose}
            className="w-full h-11 rounded-full bg-surface-container-low text-text-secondary font-body-bold text-body-bold flex items-center justify-center gap-2 active:scale-95 transition-transform"
          >
            <span className="material-symbols-outlined text-[18px]">verified_user</span>
            Tutup Verifikasi
          </button>
        </div>
      </div>
    </div>
  );
}