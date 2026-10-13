"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { formatTimeWib, initials } from "@/lib/format";
import {
  ATTENDANCE_STATUS_LABELS,
  formatDistance,
  haversineMeters,
  parseTimeToMinutes,
} from "@/lib/attendance";

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

  const exportCsv = useCallback(() => {
    const escape = (value: string | number | null): string => {
      const text = value === null || value === undefined ? "" : String(value);
      return `"${text.replace(/"/g, '""')}"`;
    };
    const header = [
      "Tanggal",
      "Staf",
      "Peran",
      "Cabang",
      "Status",
      "Masuk",
      "Pulang",
      "Terlambat (menit)",
      "Jarak ke Cabang (m)",
      "Kemiripan Wajah (%)",
      "Catatan",
    ].join(",");
    const rows = staff.map((person) => {
      const log = logByProfile.get(person.id);
      const config = configFor(person);
      const distance =
        log?.gpsLat !== null &&
        log?.gpsLat !== undefined &&
        log?.gpsLng !== null &&
        log?.gpsLng !== undefined &&
        config?.latitude != null &&
        config?.longitude != null
          ? Math.round(
              haversineMeters(
                config.latitude,
                config.longitude,
                log.gpsLat,
                log.gpsLng,
              ),
            )
          : null;
      return [
        escape(dateLabel),
        escape(person.fullName),
        escape(person.roleLabel),
        escape(config?.name ?? branch.name),
        escape(log ? ATTENDANCE_STATUS_LABELS[log.status] ?? log.status : "Belum absen"),
        escape(log?.clockIn ? formatTimeWib(log.clockIn) : ""),
        escape(log?.clockOut ? formatTimeWib(log.clockOut) : ""),
        escape(log?.lateMinutes ?? ""),
        escape(distance),
        escape(log?.faceScore !== null && log?.faceScore !== undefined ? Math.round(log.faceScore * 100) : ""),
        escape(log?.notes ?? ""),
      ].join(",");
    });
    const csv = `\uFEFF${header}\n${rows.join("\n")}`;
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `rekap-absensi-${date}.csv`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }, [branch.name, configFor, date, dateLabel, logByProfile, staff]);

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
            onClick={exportCsv}
            className="h-8 px-3 rounded-lg bg-brand-50 text-brand-700 font-caption text-caption flex items-center gap-1.5 active:scale-95 transition-transform"
          >
            <span className="material-symbols-outlined text-[15px]">download</span>
            Laporan
          </button>
        </div>
      </section>

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
            className="w-10 h-10 rounded-xl bg-surface-container-low text-text-secondary flex items-center justify-center active:scale-95 transition-transform disabled:opacity-50"
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
            className="w-10 h-10 rounded-xl bg-surface-container-low text-text-secondary flex items-center justify-center active:scale-95 transition-transform disabled:opacity-50"
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
              className={`h-9 px-3.5 rounded-full font-caption text-caption shrink-0 flex items-center gap-1.5 active:scale-95 transition-transform ${
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
              // eslint-disable-next-line @next/next/no-img-element
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