import { createClient } from "@/lib/supabase/server";
import { BottomNav } from "@/components/dashboard/bottom-nav";
import { SubPageHeader } from "@/components/pos/sub-page-header";
import { AttendanceConsole } from "@/components/attendance/attendance-console";
import { ATTENDANCE_ROLE_LABELS, wibNow } from "@/lib/attendance";
import { can } from "@/lib/rbac";
import { requirePermission, scopedBranchId } from "@/lib/rbac-guard";

export const instant = false;

export default async function AbsensiPage() {
  const session = await requirePermission("attendance.self");

  const supabase = await createClient();

  const { data: profile } = await supabase
    .from("profiles")
    .select("face_descriptor, face_verification")
    .eq("id", session.id)
    .maybeSingle();

  // Geofence absensi harus milik cabang penempatan orang itu sendiri. Kalau
  // branch switcher, Owner yang sedang meninjau cabang lain akan
  // ditolak absen karena lokasinya dibandingkan terhadap koordinat yang salah.
  const branchId = session.homeBranchId ?? scopedBranchId(session);
  const today = wibNow().dateIso;

  const [branchRes, todayRes, historyRes, handoffRes] = await Promise.all([
    branchId
      ? supabase
          .from("branches")
          .select(
            "id, branch_name, latitude, longitude, geofence_radius_meters, operating_open_time, operating_close_time",
          )
          .eq("id", branchId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    supabase
      .from("attendance_logs")
      .select("clock_in, clock_out, status, late_minutes, late_reason")
      .eq("profile_id", session.id)
      .eq("date", today)
      .maybeSingle(),
    supabase
      .from("attendance_logs")
      .select("date, clock_in, clock_out, status, late_minutes")
      .eq("profile_id", session.id)
      .order("date", { ascending: false })
      .limit(6),
    branchId
      ? supabase
          .from("shift_handoffs")
          .select("opening_cash, status")
          .eq("branch_id", branchId)
          .eq("shift_date", today)
          .order("opened_at", { ascending: false })
          .limit(1)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const branch = branchRes.data;
  const role = session.role;
  const canManageLocation = can(role, "attendance.manage_location");
  const canAudit = can(role, "attendance.audit");

  const rawDescriptor = profile?.face_descriptor as number[] | null;
  const faceDescriptor =
    Array.isArray(rawDescriptor) && rawDescriptor.length > 0
      ? rawDescriptor.map((v) => Number(v))
      : null;

  // Status verifikasi wajah master. Tanpa ini karyawan hanya melihat tombol
  // check-in yang ditolak server tanpa tahu penyebabnya.
  const faceStatus = (
    faceDescriptor === null
      ? null
      : ((profile?.face_verification as "pending" | "approved" | "rejected" | null) ??
        "pending")
  ) as "pending" | "approved" | "rejected" | null;

  const todayRow = todayRes.data;
  const history = (historyRes.data ?? [])
    .filter((row) => row.date !== today)
    .slice(0, 5)
    .map((row) => ({
      date: row.date as string,
      clockIn: row.clock_in as string | null,
      clockOut: row.clock_out as string | null,
      status: row.status as string,
      lateMinutes: row.late_minutes === null ? null : Number(row.late_minutes),
    }));

  return (
    <div className="flex flex-col w-full min-h-screen">
      <SubPageHeader
        title="Absensi Biometrik"
        branchName={branch?.branch_name ?? "Cabang Utama"}
        backHref="/dashboard"
      />
      <AttendanceConsole
        profile={{
          id: session.id,
          fullName: session.fullName,
          role,
          roleLabel: ATTENDANCE_ROLE_LABELS[role] ?? role,
          hasFace: faceDescriptor !== null,
          faceDescriptor,
          faceStatus,
        }}
        branch={{
          id: (branch?.id as string) ?? branchId ?? "",
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
        today={
          todayRow
            ? {
                clockIn: todayRow.clock_in as string | null,
                clockOut: todayRow.clock_out as string | null,
                status: todayRow.status as string,
                lateMinutes:
                  todayRow.late_minutes === null
                    ? null
                    : Number(todayRow.late_minutes),
                lateReason: todayRow.late_reason as string | null,
              }
            : null
        }
        history={history}
        canManageLocation={canManageLocation}
        handoff={
          handoffRes.data
            ? {
                opening: Number(handoffRes.data.opening_cash ?? 0),
                status: handoffRes.data.status as string,
              }
            : null
        }
        canAudit={canAudit}
      />
      <BottomNav role={session.role} />
    </div>
  );
}
