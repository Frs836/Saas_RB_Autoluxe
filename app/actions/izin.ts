"use server";

/**
 * Server actions untuk izin/cuti.
 * - Submit: notif ke owner dan manager
 * - Decide: notif ke pemohon
 */
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { adminClient } from "@/lib/supabase/admin";
import { sendPushToProfiles, getNotifTargets } from "@/lib/push";

type ActionResult = { ok: true } | { ok: false; message: string };

type SubmitTimeOffParams = {
  p_type: "izin" | "sakit" | "cuti";
  p_start_date: string;
  p_end_date: string;
  p_reason: string;
  p_proof_path?: string;
};

export async function submitTimeOffAction(
  params: SubmitTimeOffParams,
): Promise<ActionResult> {
  const supabase = await createClient();

  const { error: rpcErr } = await supabase.rpc(
    "submit_time_off_request",
    params,
  );
  if (rpcErr) return { ok: false, message: rpcErr.message };

  revalidatePath("/izin");

  void (async () => {
    try {
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
          title: "Pengajuan Izin Baru",
          body: `${employeeName} mengajukan izin/cuti. Menunggu persetujuan.`,
          url: "/izin",
        });
      }
    } catch (err) {
      console.error("[push] submitTimeOffAction notification failed:", err);
    }
  })();

  return { ok: true };
}

export async function decideTimeOffAction(
  requestId: string,
  decision: "approved" | "rejected",
): Promise<ActionResult> {
  const supabase = await createClient();

  const { error: rpcErr } = await supabase.rpc("decide_time_off_request", {
    p_id: requestId,
    p_decision: decision,
  });
  if (rpcErr) return { ok: false, message: rpcErr.message };

  revalidatePath("/izin");

  void (async () => {
    try {
      // Ambil profile_id pemohon dari request
      const db = adminClient();
      const { data: req } = await db
        .from("time_off_requests")
        .select("profile_id")
        .eq("id", requestId)
        .maybeSingle();

      const profileId = req?.profile_id as string | null;
      if (!profileId) return;

      const title =
        decision === "approved" ? "Izin Disetujui" : "Izin Ditolak";
      const body =
        decision === "approved"
          ? "Pengajuan izin Anda telah disetujui."
          : "Pengajuan izin Anda telah ditolak.";

      await sendPushToProfiles({
        profileIds: [profileId],
        title,
        body,
        url: "/izin",
      });
    } catch (err) {
      console.error("[push] decideTimeOffAction notification failed:", err);
    }
  })();

  return { ok: true };
}

export async function cancelTimeOffAction(
  requestId: string,
): Promise<ActionResult> {
  const supabase = await createClient();

  const { error: rpcErr } = await supabase.rpc("cancel_time_off_request", {
    p_id: requestId,
  });
  if (rpcErr) return { ok: false, message: rpcErr.message };

  revalidatePath("/izin");

  return { ok: true };
}
