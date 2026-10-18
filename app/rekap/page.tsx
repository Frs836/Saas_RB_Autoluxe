import { createClient } from "@/lib/supabase/server";
import { BottomNav } from "@/components/dashboard/bottom-nav";
import { SubPageHeader } from "@/components/pos/sub-page-header";
import { RekapConsole, type BranchConfig } from "@/components/attendance/rekap-console";
import { ATTENDANCE_ROLE_LABELS, wibNow } from "@/lib/attendance";
import { requirePermission, scopedBranchId } from "@/lib/rbac-guard";
import { scopeBranchQuery } from "@/lib/branch";
import { can } from "@/lib/rbac";
import { BranchScopeBadges } from "@/components/branch/branch-scope-badges";
import { Icon } from "@/components/ui/icon";

export const instant = false;

export default async function RekapPage() {
  const session = await requirePermission("attendance.audit");

  const supabase = await createClient();
  // null berarti sedang viewing seluruh cabang, dan rekap memang mendukung
  // itu karena daftar stafnya diambil per cabang.
  const branchId = scopedBranchId(session);
  const role = session.role;

  if (!branchId && session.branchScope !== "all") {
    return (
      <div className="flex flex-col w-full min-h-screen">
        <SubPageHeader
          title="Rekap Kehadiran Staf"
          branchName="Cabang Utama"
          backHref="/dashboard"
        />
        <main className="flex-1 flex items-center justify-center px-gutter">
          <div className="w-full max-w-[420px] bg-surface rounded-3xl p-6 clay-card text-center flex flex-col items-center gap-3">
            <Icon name="account_tree" className="text-[40px] text-warning-base" />
            <h1 className="font-headline-1 text-headline-1 text-text-primary">
              Cabang Belum Ditugaskan
            </h1>
            <p className="font-caption text-caption text-text-secondary leading-relaxed">
              Akun Anda belum terikat pada cabang. Hubungi Owner atau
              Maintainer.
            </p>
            <a
              href="/dashboard"
              className="h-11 px-5 rounded-xl primary-gradient text-white font-body-bold text-body-bold flex items-center gap-2"
            >
              <Icon name="home" className="text-[18px]" />
              Kembali ke Beranda
            </a>
          </div>
        </main>
        <BottomNav role={session.role} />
      </div>
    );
  }

  const today = wibNow().dateIso;

  const BRANCH_FIELDS =
    "id, branch_name, latitude, longitude, geofence_radius_meters, operating_open_time, operating_close_time";

  const [branchRes, allBranchesRes, staffRes, handoffRes, daftarCabangRes] =
    await Promise.all([
    branchId
      ? supabase
          .from("branches")
          .select(BRANCH_FIELDS)
          .eq("id", branchId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    // Saat lintas cabang, tiap staf dinilai terhadap geofence cabangnya
    // sendiri. Config itu tidak bisa disimpulkan dari satu cabang terpilih.
    branchId
      ? Promise.resolve({ data: null })
      : supabase.from("branches").select(BRANCH_FIELDS),
    scopeBranchQuery(
      supabase
        .from("profiles")
        .select("id, full_name, role, default_off_day, branch_id"),
      branchId,
      "profiles",
    )
      .eq("is_active", true)
      .order("full_name"),
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
    // Daftar cabang terpisah dari config geofence. Config hanya diambil saat
    // lintas cabang, sedangkan badge harus tetap lengkap saat satu cabang
    // sedang dipilih.
    supabase
      .from("branches")
      .select("id, branch_name, is_active")
      .order("branch_name"),
  ]);

  // attendance_logs tidak punya branch_id, jadi cakupan cabang dijaga lewat
  // daftar profile_id staf pada cabang ini. Tanpa filter ini rekap ikut
  // menyertakan log seluruh cabang.
  const branchProfileIds = (staffRes.data ?? []).map((row) => row.id as string);

  const todayLogsRes = await supabase
    .from("attendance_logs")
    .select(
      "id, profile_id, date, clock_in, clock_out, status, late_minutes, late_reason, face_similarity_score, gps_lat, gps_lng, gps_accuracy_meters, face_photo_url, clock_out_photo_url, notes, validation_score, distance_from_branch_meters, geofence_radius_meters, outside_radius, clock_out_gps_lat, clock_out_gps_lng",
    )
    .eq("date", today)
    .in("profile_id", branchProfileIds.length > 0 ? branchProfileIds : ["00000000-0000-0000-0000-000000000000"]);

  const branch = branchRes.data;

  const toConfig = (row: Record<string, unknown>) => ({
    id: row.id as string,
    name: (row.branch_name as string) ?? "Cabang",
    latitude: row.latitude === null ? null : Number(row.latitude),
    longitude: row.longitude === null ? null : Number(row.longitude),
    radius: Number(row.geofence_radius_meters ?? 30),
    openTime: (row.operating_open_time as string) ?? "07:30:00",
    closeTime: (row.operating_close_time as string) ?? "21:00:00",
  });

  const branchConfigs: Record<string, BranchConfig> = {};
  for (const row of (allBranchesRes.data ?? []) as Record<string, unknown>[]) {
    const config = toConfig(row);
    branchConfigs[config.id] = config;
  }

  const staff = (staffRes.data ?? [])
    .filter((row) => row.role !== "maintainer")
    .map((row) => ({
      id: row.id as string,
      fullName: (row.full_name as string) ?? "Staf",
      role: row.role as string,
      roleLabel: ATTENDANCE_ROLE_LABELS[(row.role as string) ?? ""] ?? (row.role as string),
      branchId: (row.branch_id as string | null) ?? null,
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
    /*
     * Jarak, radius, dan penanda luar radius sudah dihitung server saat
     * check-in dan disimpan. Nilai inilah yang dipakai atasan saat menilai
     * kehadiran, jadi laporan harus menampilkan angka yang sama, bukan
     * hasil hitung ulang di peramban.
     */
    distanceFromBranch:
      row.distance_from_branch_meters === null
        ? null
        : Number(row.distance_from_branch_meters),
    storedRadius:
      row.geofence_radius_meters === null ? null : Number(row.geofence_radius_meters),
    outsideRadius: row.outside_radius === null ? null : Boolean(row.outside_radius),
    clockOutGpsLat:
      row.clock_out_gps_lat === null ? null : Number(row.clock_out_gps_lat),
    clockOutGpsLng:
      row.clock_out_gps_lng === null ? null : Number(row.clock_out_gps_lng),
    facePhotoUrl: row.face_photo_url as string | null,
    clockOutPhotoUrl: row.clock_out_photo_url as string | null,
    notes: row.notes as string | null,
  }));

  return (
    <div className="flex flex-col w-full min-h-screen">
      <SubPageHeader
        title="Rekap Kehadiran Staf"
        branchName={
          (branch?.branch_name as string) ??
          (session.branchScope === "all" ? "Seluruh Cabang" : "Cabang Utama")
        }
        backHref="/dashboard"
      />
      <BranchScopeBadges
        branches={
          can(role, "branch.switch")
            ? (daftarCabangRes.data ?? []).map((b) => ({
                id: b.id as string,
                name: (b.branch_name as string) ?? "Cabang",
                isActive: Boolean(b.is_active),
              }))
            : []
        }
        activeBranchId={branchId}
      />
      <RekapConsole
        profile={{
          id: session.id,
          fullName: session.fullName,
          role,
          roleLabel: ATTENDANCE_ROLE_LABELS[role] ?? role,
        }}
        branch={
          branch
            ? toConfig(branch)
            : {
                id: branchId ?? session.homeBranchId ?? "",
                // Tanpa cabang terpilih, nama tampilan bukan config nyata dan
                // tidak boleh dipakai untuk menilai geofence.
                name:
                  session.branchScope === "all" ? "Seluruh Cabang" : "Cabang Utama",
                latitude: null,
                longitude: null,
                radius: 30,
                openTime: "07:30:00",
                closeTime: "21:00:00",
              }
        }
        branchConfigs={branchConfigs}
        crossBranch={session.branchScope === "all"}
        today={today}
        staff={staff}
        todayLogs={todayLogs}
        kasStatus={
          handoffRes.data
            ? { opening: Number(handoffRes.data.opening_cash ?? 0), status: handoffRes.data.status as string }
            : null
        }
      />
      <BottomNav role={session.role} />
    </div>
  );
}