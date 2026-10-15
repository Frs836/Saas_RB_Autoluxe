import { BottomNav } from "@/components/dashboard/bottom-nav";
import { SubPageHeader } from "@/components/pos/sub-page-header";
import {
  StaffScheduleView,
  type StaffSchedule,
} from "@/components/branch/staff-schedule-view";
import { requirePermission, scopedBranchId } from "@/lib/rbac-guard";
import { AddStaffPanel } from "@/components/branch/add-staff-panel";
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
        .select("id, full_name, role, branch_id, work_schedule, is_active")
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
          cabangId={cabangId}
          bisaBuatMaintainer={session.role === "owner"}
        />
      </main>
      <BottomNav role={session.role} />
    </div>
  );
}