import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { BottomNav } from "@/components/dashboard/bottom-nav";
import { SubPageHeader } from "@/components/pos/sub-page-header";
import { AttendanceConsole } from "@/components/attendance/attendance-console";
import { ATTENDANCE_MANAGER_ROLES, ATTENDANCE_ROLE_LABELS, LOCATION_MANAGER_ROLES, wibNow } from "@/lib/attendance";

export const instant = false;

export default async function AbsensiPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, full_name, role, branch_id, face_descriptor")
    .eq("auth_id", user.id)
    .maybeSingle();

  if (!profile) {
    redirect("/dashboard");
  }

  const branchId = profile.branch_id as string | null;
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
      .eq("profile_id", profile.id)
      .eq("date", today)
      .maybeSingle(),
    supabase
      .from("attendance_logs")
      .select("date, clock_in, clock_out, status, late_minutes")
      .eq("profile_id", profile.id)
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
  const role = profile.role as string;
  const canManageLocation = LOCATION_MANAGER_ROLES.includes(role);
  const canAudit = ATTENDANCE_MANAGER_ROLES.includes(role);

  const rawDescriptor = profile.face_descriptor as number[] | null;
  const faceDescriptor =
    Array.isArray(rawDescriptor) && rawDescriptor.length > 0
      ? rawDescriptor.map((v) => Number(v))
      : null;

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
          id: profile.id as string,
          fullName: (profile.full_name as string) ?? "Staf",
          role,
          roleLabel: ATTENDANCE_ROLE_LABELS[role] ?? role,
          hasFace: faceDescriptor !== null,
          faceDescriptor,
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
      <BottomNav />
    </div>
  );
}
