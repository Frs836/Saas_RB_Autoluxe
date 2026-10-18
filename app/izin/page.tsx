import { createClient } from "@/lib/supabase/server";
import { BottomNav } from "@/components/dashboard/bottom-nav";
import { SubPageHeader } from "@/components/pos/sub-page-header";
import {
  TimeOffConsole,
  type TimeOffRow,
} from "@/components/izin/time-off-console";
import { can } from "@/lib/rbac";
import { requirePermission } from "@/lib/rbac-guard";
import { wibNow } from "@/lib/attendance";

export const instant = false;

export default async function IzinPage() {
  const session = await requirePermission("time_off.request");

  const supabase = await createClient();
  const canDecide = can(session.role, "time_off.decide");

  // RLS time_off_select_own_or_privileged sudah membatasi karyawan pada
  // pengajuannya sendiri, jadi penyaringan di sini hanya reinforcement.
  const { data: rows } = await supabase
    .from("time_off_requests")
    .select(
      "id, profile_id, type, start_date, end_date, reason, proof_photo_url, status, approver_id, decided_at, created_at, cancelled_at",
    )
    .order("created_at", { ascending: false })
    .limit(200);

  // Hanya owner dan maintainer yang punya izin time_off.decide, dan keduanya
  // juga punya cakupan seluruh cabang. Jadi pemutus selalu melihat semua
  // pengajuan yang boleh ia lihat menurut RLS.
  const filtered = (rows ?? []).filter(
    (row) => row.profile_id === session.id || canDecide,
  );

  const profileIds = Array.from(
    new Set(
      filtered.flatMap((row) => [row.profile_id, row.approver_id]).filter(Boolean) as string[],
    ),
  );

  let nameById: Record<string, string> = {};
  if (profileIds.length > 0) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, full_name")
      .in("id", profileIds);
    nameById = Object.fromEntries(
      (profiles ?? []).map((p) => [p.id, (p.full_name as string) ?? "Staf"]),
    );
  }

  const requests: TimeOffRow[] = filtered.map((row) => ({
    id: row.id as string,
    type: row.type as TimeOffRow["type"],
    startDate: row.start_date as string,
    endDate: row.end_date as string,
    reason: row.reason as string,
    status: row.status as TimeOffRow["status"],
    requesterName: nameById[row.profile_id as string] ?? "Staf",
    isOwn: row.profile_id === session.id,
    proofPath: (row.proof_photo_url as string) ?? null,
    approverName: row.approver_id
      ? (nameById[row.approver_id as string] ?? "Pengelola")
      : null,
    decidedAt: (row.decided_at as string) ?? null,
    createdAt: row.created_at as string,
  }));

  return (
    <div className="flex flex-col w-full min-h-screen">
      <SubPageHeader
        title="Izin, Cuti & Sakit"
        branchName={canDecide ? "Semua pengajuan cabang" : "Pengajuan pribadi"}
        backHref="/dashboard"
      />
      <main className="flex-1">
        <TimeOffConsole
          requests={requests}
          canDecide={canDecide}
          todayIso={wibNow().dateIso}
        />
      </main>
      <BottomNav role={session.role} />
    </div>
  );
}