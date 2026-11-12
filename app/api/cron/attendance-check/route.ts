import { NextRequest, NextResponse } from "next/server";
import { adminClient } from "@/lib/supabase/admin";
import { sendPushToProfiles, getNotifTargets } from "@/lib/push";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  // Protect with CRON_SECRET header (set in vercel.json)
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = adminClient();

  // Get all active branches with their schedules
  const { data: branches } = await db
    .from("branches")
    .select("id, branch_name, operating_open_time, operating_close_time")
    .eq("is_active", true);

  if (!branches?.length) {
    return NextResponse.json({ ok: true, checked: 0 });
  }

  // Current time in WIB (UTC+7)
  const now = new Date();
  const wibOffset = 7 * 60; // minutes
  const wibNow = new Date(now.getTime() + wibOffset * 60000);
  const currentHHMM = wibNow.toISOString().slice(11, 16); // "HH:MM"

  let notifsSent = 0;

  for (const branch of branches) {
    const openTime = (branch.operating_open_time as string)?.slice(0, 5) ?? "07:30";
    const closeTime = (branch.operating_close_time as string)?.slice(0, 5) ?? "21:00";

    // Check: current time is within 30 minutes after open time → attendance reminder
    const [openH, openM] = openTime.split(":").map(Number);
    const openMinutes = openH * 60 + openM;
    const [nowH, nowM] = currentHHMM.split(":").map(Number);
    const nowMinutes = nowH * 60 + nowM;

    const minutesAfterOpen = nowMinutes - openMinutes;
    if (minutesAfterOpen >= 0 && minutesAfterOpen <= 30) {
      // Find staff who have not checked in today
      const todayWib = wibNow.toISOString().slice(0, 10);
      const { data: staffList } = await db
        .from("profiles")
        .select("id")
        .eq("branch_id", branch.id)
        .eq("is_active", true)
        .in("role", ["karyawan", "kepala_karyawan", "admin_kasir", "manager"]);

      const staffIds = (staffList ?? []).map((s) => s.id);

      if (staffIds.length > 0) {
        const { data: attended } = await db
          .from("attendance_logs")
          .select("profile_id")
          .in("profile_id", staffIds)
          .gte("check_in", `${todayWib}T00:00:00+07:00`)
          .lte("check_in", `${todayWib}T23:59:59+07:00`);

        const attendedIds = new Set((attended ?? []).map((a) => a.profile_id));
        const absentIds = staffIds.filter((id) => !attendedIds.has(id));

        if (absentIds.length > 0) {
          await sendPushToProfiles({
            profileIds: absentIds,
            title: "Pengingat Absensi Masuk",
            body: `Anda belum absen masuk hari ini. Jam kerja ${openTime} WIB. Segera lakukan absensi.`,
            url: "/absensi",
          });

          // Notify owner/admin
          const adminIds = await getNotifTargets(branch.id, ["owner", "admin_kasir", "manager"]);
          if (adminIds.length > 0) {
            await sendPushToProfiles({
              profileIds: adminIds,
              title: "Karyawan Belum Absen",
              body: `${absentIds.length} karyawan di ${branch.branch_name} belum absen masuk (jam ${openTime}).`,
              url: "/absensi",
            });
          }
          notifsSent += absentIds.length;
        }
      }
    }

    // Check: 5 minutes before close time → closing reminder
    const [closeH, closeM] = closeTime.split(":").map(Number);
    const closeMinutes = closeH * 60 + closeM;
    const minutesBeforeClose = closeMinutes - nowMinutes;

    if (minutesBeforeClose >= 4 && minutesBeforeClose <= 6) {
      const activeIds = await getNotifTargets(branch.id, [
        "karyawan", "kepala_karyawan", "admin_kasir", "manager", "owner", "finance", "maintainer",
      ]);
      if (activeIds.length > 0) {
        await sendPushToProfiles({
          profileIds: activeIds,
          title: "5 Menit Sebelum Jam Pulang",
          body: `Jam pulang ${closeTime} WIB hampir tiba. Selesaikan pekerjaan dan persiapkan serah terima shift.`,
          url: "/dashboard",
        });
        notifsSent += activeIds.length;
      }
    }
  }

  // -----------------------------------------------------------------
  // Anomali device fingerprint — notifikasi ke owner/manager per cabang.
  // Baris yang sudah ditandai "[notified]" pada anomaly_reason dilewati
  // agar tidak spam setiap menit cron berjalan.
  // -----------------------------------------------------------------
  try {
    const { data: anomalyRows } = await db
      .from("attendance_logs")
      .select("id, profile_id, anomaly_reason")
      .eq("anomaly_flag", true);

    const toNotify = (anomalyRows ?? []).filter(
      (row) => !(row.anomaly_reason ?? "").includes("[notified]"),
    );

    if (toNotify.length > 0) {
      const profileIds = Array.from(
        new Set(toNotify.map((r) => r.profile_id as string)),
      );
      const { data: profiles } = await db
        .from("profiles")
        .select("id, full_name, branch_id")
        .in("id", profileIds);

      const profileMap = new Map(
        (profiles ?? []).map((p) => [p.id as string, p]),
      );

      for (const row of toNotify) {
        const profile = profileMap.get(row.profile_id as string);
        const branchId = profile?.branch_id as string | undefined;
        const staffName = (profile?.full_name as string) ?? "Karyawan";
        if (!branchId) continue;

        const targets = await getNotifTargets(branchId, ["owner", "manager"]);
        if (targets.length > 0) {
          await sendPushToProfiles({
            profileIds: targets,
            title: "Absensi Anomali",
            body: `Absensi Anomali: ${staffName} absen dengan device berbeda`,
            url: "/rekap",
          });
          notifsSent += targets.length;
        }

        // Tandai sudah dinotif agar tidak dikirim ulang.
        const marker = "[notified]";
        const baseReason = row.anomaly_reason ?? "device_changed";
        const newReason = baseReason.includes(marker)
          ? baseReason
          : `${baseReason} ${marker}`;
        await db
          .from("attendance_logs")
          .update({ anomaly_reason: newReason })
          .eq("id", row.id);
      }
    }
  } catch (err) {
    console.error("[cron] anomaly notification failed:", err);
  }

  return NextResponse.json({ ok: true, notifsSent });
}
