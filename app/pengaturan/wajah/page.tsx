import { BottomNav } from "@/components/dashboard/bottom-nav";
import { SubPageHeader } from "@/components/pos/sub-page-header";
import {
  FaceVerificationList,
  type FaceRegistration,
} from "@/components/branch/face-verification-list";
import { requirePermission } from "@/lib/rbac-guard";
import { createClient } from "@/lib/supabase/server";

export const instant = false;

export default async function FaceVerificationPage() {
  const session = await requirePermission("branch.manage");

  const supabase = await createClient();

  // Daftar diambil lewat RPC supaya pemeriksaan peran hanya bisa dilewati di
  // satu tempat, dan urutan menunggu dihitung berdasarkan status.
  const { data, error } = await supabase.rpc("pending_face_registrations");

  const registrations: FaceRegistration[] = error
    ? []
    : (
        (data ?? []) as Array<{
          profile_id: string;
          full_name: string | null;
          role: string | null;
          branch_name: string | null;
          face_verification: FaceRegistration["face_verification"] | null;
          face_review_note: string | null;
          registered_at: string | null;
          reference_photo_url: string | null;
          has_descriptor: boolean;
        }>
      ).map((row) => ({
        profile_id: row.profile_id,
        full_name: row.full_name ?? "Staf",
        role: row.role ?? "karyawan",
        branch_name: row.branch_name ?? null,
        face_verification: row.face_verification ?? "pending",
        face_review_note: row.face_review_note ?? null,
        registered_at: row.registered_at ?? null,
        reference_photo_url: row.reference_photo_url ?? null,
        has_descriptor: row.has_descriptor,
      }));

  return (
    <div className="flex flex-col w-full min-h-screen">
      <SubPageHeader
        title="Verifikasi Wajah"
        branchName="Seluruh Cabang"
        backHref="/dashboard"
      />
      <main className="flex-1">
        <FaceVerificationList registrations={registrations} />
      </main>
      <BottomNav role={session.role} />
    </div>
  );
}