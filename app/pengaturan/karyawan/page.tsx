import { BottomNav } from "@/components/dashboard/bottom-nav";
import { SubPageHeader } from "@/components/pos/sub-page-header";
import {
  StaffScheduleView,
  type StaffSchedule,
} from "@/components/branch/staff-schedule-view";
import {
  StaffManagement,
  type ManagedStaff,
} from "@/components/branch/staff-management";
import { ATTENDANCE_ROLE_LABELS } from "@/lib/attendance";
import { requirePermission, scopedBranchId } from "@/lib/rbac-guard";
import { createClient } from "@/lib/supabase/server";

export const instant = false;

export default async function StaffSchedulePage() {
  const session = await requirePermission("branch.manage");
  const supabase = await createClient();

  // Jadwal kerja bersifat per cabang, jadi halaman ini memakai cabang aktif
  // yang sama seperti pengaturan cabang. Saat manajer melihat seluruh cabang,
  // daftar staf digabung agar tidak ada staf yang luput dijadwalkan.
  const cabangId = scopedBranchId(session);
  const lintasCabang = session.branchScope === "all" && !cabangId;

  const [cabangRes, stafRes] = await Promise.all([
    cabangId
      ? supabase
          .from("branches")
          .select(
            "operating_open_time, operating_close_time, office_open_time, office_close_time",
          )
          .eq("id", cabangId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    (async () => {
      let q = supabase
        .from("profiles")
        .select(
          "id, full_name, role, branch_id, work_schedule, is_active, default_off_day, face_reference_photo_url, face_verification",
        )
        .order("full_name");
      if (cabangId) q = q.eq("branch_id", cabangId);
      return q;
    })(),
  ]);

  const cabang = cabangRes.data;

  // Saat belum memilih cabang, jam diambil dari cabang pertama yang aktif
  // supaya kolom jam tetap terbaca. Nilai ini hanya acuan tampilan; penilaian
  // keterlambatan tetap dihitung server per cabang masing-masing staf.
  let jamKantorMasuk = "10:00";
  let jamKantorPulang = "18:00";
  let jamLapanganMasuk = "07:30";
  let jamLapanganPulang = "21:00";

  if (cabang) {
    jamLapanganMasuk = String(cabang.operating_open_time ?? "07:30:00").slice(0, 5);
    jamLapanganPulang = String(cabang.operating_close_time ?? "21:00:00").slice(0, 5);
    jamKantorMasuk = String(cabang.office_open_time ?? "10:00:00").slice(0, 5);
    jamKantorPulang = String(cabang.office_close_time ?? "18:00:00").slice(0, 5);
  } else {
    const { data: fallback } = await supabase
      .from("branches")
      .select(
        "operating_open_time, operating_close_time, office_open_time, office_close_time",
      )
      .eq("is_active", true)
      .limit(1)
      .maybeSingle();
    if (fallback) {
      jamLapanganMasuk = String(fallback.operating_open_time ?? "07:30:00").slice(0, 5);
      jamLapanganPulang = String(fallback.operating_close_time ?? "21:00:00").slice(0, 5);
      jamKantorMasuk = String(fallback.office_open_time ?? "10:00:00").slice(0, 5);
      jamKantorPulang = String(fallback.office_close_time ?? "18:00:00").slice(0, 5);
    }
  }

  const cabangTerpakai = [
    ...new Set(
      (stafRes.data ?? [])
        .map((s) => s.branch_id)
        .filter((v): v is string => typeof v === "string"),
    ),
  ];

  const { data: namaCabang } =
    cabangTerpakai.length > 0
      ? await supabase
          .from("branches")
          .select("id, branch_name")
          .in("id", cabangTerpakai)
      : { data: [] };

  const namaCabangMap = new Map(
    (namaCabang ?? []).map((b) => [b.id as string, b.branch_name as string]),
  );

  const staff: StaffSchedule[] = (stafRes.data ?? []).map((row) => ({
    id: row.id as string,
    fullName: (row.full_name as string) ?? "Staf",
    role: (row.role as string) ?? "karyawan",
    branchName:
      lintasCabang && row.branch_id
        ? namaCabangMap.get(row.branch_id as string) ?? null
        : null,
    workSchedule:
      (row.work_schedule as StaffSchedule["workSchedule"]) ?? "field",
    isActive: (row.is_active as boolean) ?? true,
  }));

  const FACE_LABEL: Record<string, string> = {
    verified: "Wajah Terverifikasi",
    pending: "Menunggu Verifikasi",
    rejected: "Wajah Ditolak",
    none: "Belum Daftar",
  };

  /*
   * Foto sampel wajah disimpan di bucket privat, jadi harus lewat URL
   * bertanda tangan. Sebelumnya jalur mentah dipakai langsung sebagai src,
   * sehingga peramban meminta /pengaturan/<auth_id>/<file>.webp dan selalu
   * mendapat 404. Tanda tangan dibuat sekali untuk seluruh staf, bukan satu
   * demi satu, supaya halaman ini tidak menambah satu perjalanan jaringan per
   * wajah.
   */
  const fotoPaths = (stafRes.data ?? [])
    .map((row) => row.face_reference_photo_url as string | null)
    .filter((p): p is string => typeof p === "string" && p.length > 0);
  const fotoUrlMap = new Map<string, string>();
  if (fotoPaths.length > 0) {
    const { data: signed } = await supabase.storage
      .from("attendance-photos")
      .createSignedUrls(fotoPaths, 60 * 30);
    for (const item of signed ?? []) {
      if (item.path && item.signedUrl) fotoUrlMap.set(item.path, item.signedUrl);
    }
  }

  const managedStaff: ManagedStaff[] = (stafRes.data ?? []).map((row) => ({
    id: row.id as string,
    fullName: (row.full_name as string) ?? "Staf",
    role: (row.role as string) ?? "karyawan",
    roleLabel:
      ATTENDANCE_ROLE_LABELS[(row.role as string) ?? ""] ?? "Staf",
    branchId: (row.branch_id as string | null) ?? null,
    branchName: row.branch_id
      ? (namaCabangMap.get(row.branch_id as string) ?? "-")
      : "-",
    workSchedule:
      (row.work_schedule as ManagedStaff["workSchedule"]) ?? "field",
    isActive: (row.is_active as boolean) ?? true,
    defaultOffDay:
      row.default_off_day === null || row.default_off_day === undefined
        ? null
        : Number(row.default_off_day),
    facePhotoUrl: (() => {
      const p = row.face_reference_photo_url as string | null;
      return p ? (fotoUrlMap.get(p) ?? null) : null;
    })(),
    faceStatus:
      FACE_LABEL[(row.face_verification as string) ?? "none"] ?? "Belum Daftar",
  }));

  // Cabang tujuan dipindah staff diambil dari seluruh cabang, bukan hanya yang
  // sedang dipakai. Kalau daftar dibatasi cabang aktif, memindahkan staf ke
  // cabang lain jadi tidak mungkin sama sekali.
  const { data: semuaCabang } = await supabase
    .from("branches")
    .select("id, branch_name")
    .order("branch_name");

  const branchOptions = (semuaCabang ?? []).map((b) => ({
    id: b.id as string,
    name: (b.branch_name as string) ?? "Cabang",
  }));

  return (
    <div className="flex flex-col w-full min-h-screen">
      <SubPageHeader
        title="Jadwal Kerja Staf"
        branchName={lintasCabang ? "Seluruh Cabang" : "Cabang Aktif"}
        backHref="/dashboard"
      />
      <main className="flex-1">
        <StaffScheduleView
          staff={staff}
          jam={{
            lapanganMasuk: jamLapanganMasuk,
            lapanganPulang: jamLapanganPulang,
            kantorMasuk: jamKantorMasuk,
            kantorPulang: jamKantorPulang,
          }}
          bisaUbah={Boolean(cabang)}
        />
        <StaffManagement
          staff={managedStaff}
          branches={branchOptions}
          bisaUbahJabatan={session.role === "owner"}
        />
      </main>
      <BottomNav role={session.role} />
    </div>
  );
}