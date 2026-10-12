import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { BottomNav } from "@/components/dashboard/bottom-nav";
import { SubPageHeader } from "@/components/pos/sub-page-header";
import { RekapConsole } from "@/components/attendance/rekap-console";
import { ATTENDANCE_MANAGER_ROLES, ATTENDANCE_ROLE_LABELS, wibNow } from "@/lib/attendance";

export const instant = false;

export default async function RekapPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, full_name, role, branch_id")
    .eq("auth_id", user.id)
    .maybeSingle();

  const branchId = profile?.branch_id as string | null;
  const role = (profile?.role as string) ?? "";
  const canRekap = ATTENDANCE_MANAGER_ROLES.includes(role);

  const restricted = (
    <main className="flex-1 flex items-center justify-center px-gutter">
      <div className="w-full max-w-[420px] bg-surface rounded-3xl p-6 clay-card text-center flex flex-col items-center gap-3">
        <span className="material-symbols-outlined text-[40px] text-warning-base">
          admin_panel_settings
        </span>
        <h1 className="font-headline-1 text-headline-1 text-text-primary">
          Akses Terbatas
        </h1>
        <p className="font-caption text-caption text-text-secondary leading-relaxed">
          Rekap Kehadiran Staf dikhususkan untuk Owner, Admin Kasir, dan
          Maintainer.
        </p>
        <a
          href="/dashboard"
          className="h-11 px-5 rounded-xl primary-gradient text-white font-body-bold text-body-bold flex items-center gap-2"
        >
          <span className="material-symbols-outlined text-[18px]">home</span>
          Kembali ke Beranda
        </a>
      </div>
    </main>
  );

  if (!profile || !branchId || !canRekap) {
    return (
      <div className="flex flex-col w-full min-h-screen">
        <SubPageHeader
          title="Rekap Kehadiran Staf"
          branchName="Cabang Utama"
          backHref="/dashboard"
        />
        {restricted}
        <BottomNav />
      </div>
    );
  }

  const today = wibNow().dateIso;

  const [branchRes, staffRes, todayLogsRes, handoffRes] = await Promise.all([
    supabase
      .from("branches")
      .select(
        "branch_name, latitude, longitude, geofence_radius_meters, operating_open_time, operating_close_time",
      )
      .eq("id", branchId)
      .maybeSingle(),
    supabase
      .from("profiles")
      .select("id, full_name, role, default_off_day")
      .eq("branch_id", branchId)
      .eq("is_active", true)
      .order("full_name"),
    supabase
      .from("attendance_logs")
      .select(
        "id, profile_id, date, clock_in, clock_out, status, late_minutes, late_reason, face_similarity_score, gps_lat, gps_lng, gps_accuracy_meters, face_photo_url, clock_out_photo_url, notes, validation_score",
      )
      .eq("date", today),
    supabase
      .from("shift_handoffs")
      .select("opening_cash, status")
      .eq("branch_id", branchId)
      .eq("shift_date", today)
      .order("opened_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const branch = branchRes.data;

  const staff = (staffRes.data ?? [])
    .filter((row) => row.role !== "maintainer")
    .map((row) => ({
      id: row.id as string,
      fullName: (row.full_name as string) ?? "Staf",
      role: row.role as string,
      roleLabel: ATTENDANCE_ROLE_LABELS[(row.role as string) ?? ""] ?? (row.role as string),
    }));

  const todayLogs = (todayLogsRes.data ?? []).map((row) => ({
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
  }));

  return (
    <div className="flex flex-col w-full min-h-screen">
      <SubPageHeader
        title="Rekap Kehadiran Staf"
        branchName={(branch?.branch_name as string) ?? "Cabang Utama"}
        backHref="/dashboard"
      />
      <RekapConsole
        profile={{
          id: profile.id as string,
          fullName: (profile.full_name as string) ?? "Staf",
          role,
          roleLabel: ATTENDANCE_ROLE_LABELS[role] ?? role,
        }}
        branch={{
          id: branchId as string,
          name: (branch?.branch_name as string) ?? "Cabang Utama",
          latitude:
            branch?.latitude === null || branch?.latitude === undefined
              ? null
              : Number(branch.latitude),
          longitude:
            branch?.longitude === null || branch?.longitude === undefined
              ? null
              : Number(branch.longitude),
          radius:
            branch?.geofence_radius_meters === null ||
            branch?.geofence_radius_meters === undefined
              ? 30
              : Number(branch.geofence_radius_meters),
          openTime: (branch?.operating_open_time as string) ?? "07:30:00",
          closeTime: (branch?.operating_close_time as string) ?? "21:00:00",
        }}
        today={today}
        staff={staff}
        todayLogs={todayLogs}
        kasStatus={
          handoffRes.data
            ? { opening: Number(handoffRes.data.opening_cash ?? 0), status: handoffRes.data.status as string }
            : null
        }
      />
      <BottomNav />
    </div>
  );
}