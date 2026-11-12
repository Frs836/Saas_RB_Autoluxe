"use server";

/**
 * Server actions untuk absensi.
 * Setelah check-in berhasil, kirim push ke owner dan manager.
 */
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { adminClient } from "@/lib/supabase/admin";
import { sendPushToProfiles, getNotifTargets } from "@/lib/push";

type CheckInParams = {
  p_latitude: number;
  p_longitude: number;
  p_accuracy_meters?: number;
  p_face_descriptor: number[];
  p_liveness_trace?: string | number | boolean | null | { [key: string]: unknown } | unknown[];
  p_late_reason?: string;
  p_device_fingerprint?: string;
};

type ActionResult = { ok: true } | { ok: false; message: string };

export async function attendanceCheckInAction(
  params: CheckInParams,
): Promise<ActionResult> {
  const supabase = await createClient();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: rpcErr } = await supabase.rpc("attendance_check_in", params as any);
  if (rpcErr) return { ok: false, message: rpcErr.message };

  revalidatePath("/absensi");
  revalidatePath("/rekap");

  void (async () => {
    try {
      // Ambil profil pemanggil untuk nama dan branch_id
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;

      const db = adminClient();
      const { data: profile } = await db
        .from("profiles")
        .select("full_name, branch_id")
        .eq("auth_id", user.id)
        .maybeSingle();

      if (!profile?.branch_id) return;

      const employeeName = (profile.full_name as string) ?? "Karyawan";
      const branchId = profile.branch_id as string;

      const targets = await getNotifTargets(branchId, ["owner", "manager"]);
      if (targets.length > 0) {
        await sendPushToProfiles({
          profileIds: targets,
          title: "Absensi Masuk",
          body: `${employeeName} telah melakukan absensi masuk.`,
          url: "/rekap",
        });
      }
    } catch (err) {
      console.error("[push] attendanceCheckInAction notification failed:", err);
    }
  })();

  return { ok: true };
}

export async function attendanceCheckOutAction(): Promise<ActionResult> {
  const supabase = await createClient();

  const { error: rpcErr } = await supabase.rpc("attendance_check_out", {});
  if (rpcErr) return { ok: false, message: rpcErr.message };

  revalidatePath("/absensi");

  return { ok: true };
}
