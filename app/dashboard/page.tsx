import Link from "next/link";
import { redirect } from "next/navigation";
import { LiveClock } from "@/components/dashboard/live-clock";
import { wibNow } from "@/lib/attendance";
import { createClient } from "@/lib/supabase/server";
import { DashboardHeader } from "@/components/dashboard/dashboard-header";
import { BottomNav } from "@/components/dashboard/bottom-nav";
import { PendingVerification } from "@/components/auth/pending-verification";
import {
  formatRupiah,
  formatRupiahShort,
  formatTimeWib,
  todayWibIso,
} from "@/lib/format";
import { can, quickActionsFor, roleLabel } from "@/lib/rbac";
import { getSessionProfile, scopedBranchId } from "@/lib/rbac-guard";
import { scopeBranchQuery } from "@/lib/branch";
import { Icon } from "@/components/ui/icon";

export const instant = false;

const ORDER_STAGE: Record<string, { label: string; progress: number }> = {
  queued: { label: "Dalam Antrean", progress: 10 },
  in_progress: { label: "Sedang Dikerjakan", progress: 60 },
  qc_review: { label: "Review QC", progress: 85 },
  // Pengerjaan selesai tapi belum diambil adalah tahap yang paling sering
  // ditanyakan pelanggan, jadi harus punya label sendiri.
  completed: { label: "Pengerjaan Selesai", progress: 95 },
  menunggu_diambil: { label: "Siap Diambil", progress: 100 },
};

type MyCashHold = {
  cash_amount: number | null;
  qris_amount: number | null;
  transfer_amount: number | null;
  held_total: number | null;
  held_count: number | null;
  unpaid_total: number | null;
  unpaid_count: number | null;
};

function statusBadge(status: string) {
  switch (status) {
    case "hadir":
      return { text: "Hadir", cls: "bg-success-surface text-success-text" };
    case "izin":
      return { text: "Izin", cls: "bg-warning-surface text-warning-text" };
    case "sakit":
      return { text: "Sakit", cls: "bg-danger-surface text-danger-text" };
    case "libur_shift":
      return { text: "Libur", cls: "bg-surface-container text-text-secondary" };
    default:
      return {
        text: "Belum Absen",
        cls: "bg-surface-container text-text-secondary",
      };
  }
}

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const profile = await getSessionProfile();

  if (!profile) {
    return (
      <PendingVerification
        action={
          <form action="/auth/signout" method="post">
            <button
              type="submit"
              className="h-11 px-5 rounded-xl bg-brand-50 text-brand-600 font-body-bold text-body-bold"
            >
              Keluar
            </button>
          </form>
        }
      />
    );
  }

  const role = profile.role;
  // null berarti pengguna memilih "Seluruh Cabang" lewat branch switcher.
  const branchId = scopedBranchId(profile);
  const today = todayWibIso();

  const canSeeBranchCash = can(role, "cash.view_branch");
  const canSeeOwnHold = can(role, "cash.view_own_hold");

  const [branchRes, shiftRes, attendanceRes, handoffRes, ordersRes, notifRes, holdRes] =
    await Promise.all([
      branchId
        ? supabase
            .from("branches")
            .select("branch_name, operating_open_time")
            .eq("id", branchId)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      profile.shiftId
        ? supabase
            .from("shifts")
            .select("name, start_time")
            .eq("id", profile.shiftId)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      supabase
        .from("attendance_logs")
        .select("clock_in, clock_out, status")
        .eq("profile_id", profile.id)
        .eq("date", today)
        .maybeSingle(),
      // Handoff kas cabang HANYA untuk role berwenang. Karyawan tidak boleh
      // menarik data ini sama sekali, bukan sekadar disembunyikan.
      canSeeBranchCash
        ? scopeBranchQuery(
            supabase
              .from("shift_handoffs")
              .select("opening_cash, expected_cash, actual_cash, status"),
            branchId,
            "shift_handoffs",
          )
            .eq("shift_date", today)
            .order("opened_at", { ascending: false })
            .limit(1)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      scopeBranchQuery(
        supabase
          .from("orders")
          .select(
            "id, order_number, license_plate, vehicle_model, service_package, status, total_price, created_at, assigned_to",
          ),
        branchId,
        "orders",
      )
        .in("status", ["queued", "in_progress", "qc_review"])
        .order("created_at", { ascending: false })
        .limit(25),
      supabase
        .from("notifications")
        .select("title, body")
        .eq("recipient_id", profile.id)
        .eq("is_read", false)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      canSeeOwnHold
        ? supabase.rpc("my_cash_hold_today")
        : Promise.resolve({ data: null }),
    ]);

  const branch = branchRes.data;
  const shift = shiftRes.data;
  const attendance = attendanceRes.data;
  const handoff = canSeeBranchCash ? handoffRes.data : null;
  const activeOrders = ordersRes.data ?? [];
  const note = notifRes.data;
  const myHold = (Array.isArray(holdRes.data) ? holdRes.data[0] : holdRes.data) as
    | MyCashHold
    | null;

    const inProgress = activeOrders.filter((o) => o.status === "in_progress");
  const queued = activeOrders.filter((o) => o.status === "queued");
  const qcReview = activeOrders.filter((o) => o.status === "qc_review");

  /*
   * Kartu order aktif memakai urutan stages: sedang dikerjakan lebih dulu,
   * lalu antrean, lalu QC.
   *
   * Sebelumnya QC tidak pernah dipakai sebagai calon kartu. Padahal kartu
   * penghitung menampilkan "1 QC", jadi order itu ada di daftar tetapi tidak
   * pernah muncul sebagai kartu, dan tidak ada satupun tautan untuk
   * membukanya. Urutan sekarang mencakup ketiganya sehingga kartu selalu
   * muncul selama masih ada order yang belum selesai.
   */
  const liveOrder = inProgress[0] ?? queued[0] ?? qcReview[0] ?? null;

  let liveAssignee: string | null = null;
  if (liveOrder?.assigned_to) {
    const { data: assignee } = await supabase
      .from("profiles")
      .select("full_name")
      .eq("id", liveOrder.assigned_to)
      .maybeSingle();
    liveAssignee = assignee?.full_name ?? null;
  }

  const badge = statusBadge(attendance?.status ?? "");
  const clockInTime = attendance?.clock_in
    ? formatTimeWib(attendance.clock_in)
    : null;

  const openedTime = (branch?.operating_open_time ?? "07:30:00").slice(0, 5);

// Jam dikirim dari server supaya render pertama sama persis dengan HTML hasil
// render server. Setelah itu LiveClock yang memperbaruinya setiap detik.
const jamSekarang = wibNow();
  const quickActions = quickActionsFor(role);

  const heldTotal = Number(myHold?.held_total ?? 0);
  const heldCount = Number(myHold?.held_count ?? 0);
  const heldCash = Number(myHold?.cash_amount ?? 0);
  const heldDigital = Number(myHold?.qris_amount ?? 0) + Number(myHold?.transfer_amount ?? 0);
  const unpaidCount = Number(myHold?.unpaid_count ?? 0);
  const unpaidTotal = Number(myHold?.unpaid_total ?? 0);

  // Padding bawah memperhitungkan bilah navigasi dan safe area iPhone,
  // supaya kartu terakhir tidak tertutup menu.
  return (
      <div className="flex flex-col w-full pb-nav-plain min-h-screen">
      <DashboardHeader
        branchName={branch?.branch_name ?? "Cabang Utama"}
        fullName={profile.fullName}
        hasUnread={Boolean(note)}
        profileId={profile.id}
        canSwitchBranch={profile.canSwitchBranch}
        branches={profile.branches}
        activeBranchId={profile.branchId}
        branchScope={profile.branchScope}
      />

      <div className="px-gutter pt-space-md grid grid-cols-2 gap-space-md">
        <section className="col-span-2 relative overflow-hidden rounded-[20px] p-5 primary-gradient text-on-primary clay-glow">
          <div className="absolute -right-6 -bottom-6 opacity-10 pointer-events-none text-white">
            <Icon name="directions_car" className="text-[130px]" />
          </div>
          <div className="relative z-10 flex flex-col gap-3">
            <div className="flex items-center justify-between gap-2">
              <span className="font-caption text-caption text-brand-100 flex items-center gap-1.5">
                <Icon name="schedule" className="text-[16px]" />
                Jam Resmi: {openedTime} WIB
              </span>
              <div className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-white/20 backdrop-blur-md">
                <Icon name={attendance?.status === "hadir" ? "verified" : "info"} className="text-[14px] text-white" />
                <span className="font-micro-badge text-micro-badge text-white tracking-wider uppercase">
                  {badge.text}
                </span>
              </div>
            </div>
            <div className="flex flex-col">
              {/*
                Angka besar itu jam berjalan, bukan jam absen.
                Sebelumnya kolom ini diisi jam check-in dari database, jadi
                selama staf belum absen isinya tetap dua strip dan tidak pernah
                bergerak. Jam absen dipisahkan ke bawah supaya keduanya tidak
                saling menggantikan.
              */}
              <h2 className="font-metric-display text-metric-display text-white tracking-tight leading-none">
                <LiveClock jamAwal={jamSekarang.timeLabel} />
                <span className="font-headline-2 text-headline-2 text-brand-100 font-normal">
                  WIB
                </span>
              </h2>
              <p className="font-caption text-caption text-brand-100 mt-1">
                {clockInTime
                  ? `Absen masuk tercatat ${clockInTime}`
                  : "Belum absen hari ini"}
              </p>
            </div>
            <div className="pt-1">
              <Link
                href="/absensi"
                className="w-full h-11 px-4 rounded-xl bg-white/20 flex items-center justify-center gap-2 active:scale-[0.98] transition-transform"
              >
                <Icon name={clockInTime ? "how_to_reg" : "face_retouching_natural"} className="text-[20px] text-white" />
                <span className="font-body-bold text-body-bold text-white">
                  {clockInTime ? "Absensi Hari Ini Tercatat" : "Buka Scanner Face ID"}
                </span>
              </Link>
            </div>
          </div>
        </section>

        {canSeeBranchCash ? (
          <Link
            href="/shift"
            aria-label="Buka Audit Shift"
            className="col-span-1 rounded-[20px] p-4 bg-surface flex flex-col justify-between clay-card active:scale-[0.98] transition-transform"
          >
            <div className="flex flex-col gap-2">
              <div className="w-10 h-10 rounded-xl bg-brand-50 flex items-center justify-center text-brand-600 shadow-[inset_0px_1px_2px_rgba(255,255,255,0.9)]">
                <Icon name="payments" className="text-[22px]" />
              </div>
              <div>
                <span className="font-caption text-caption text-text-secondary line-clamp-1">
                  Kas Titipan Shift
                </span>
                <div className="font-headline-1 text-headline-1 text-text-primary mt-0.5 tracking-tight">
                  {handoff?.opening_cash != null
                    ? formatRupiahShort(handoff.opening_cash)
                    : "Belum ada"}
                </div>
              </div>
            </div>
            <div className="mt-3 pt-2">
              <div className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-warning-surface text-warning-text w-full">
                <Icon name={handoff?.status === "closed" ? "task_alt" : "pending"} className="text-[13px] shrink-0" />
                <span className="font-micro-badge text-micro-badge truncate">
                  {handoff?.status === "closed"
                    ? "Shift Sudah Ditutup"
                    : "Audit Shift Berjalan"}
                </span>
              </div>
            </div>
          </Link>
        ) : (
          <section className="col-span-1 rounded-[20px] p-4 bg-surface flex flex-col justify-between clay-card">
            <div className="flex flex-col gap-2">
              <div className="w-10 h-10 rounded-xl bg-brand-50 flex items-center justify-center text-brand-600 shadow-[inset_0px_1px_2px_rgba(255,255,255,0.9)]">
                <Icon name="savings" className="text-[22px]" />
              </div>
              <div>
                <span className="font-caption text-caption text-text-secondary line-clamp-1">
                  Kas Titipan Saya
                </span>
                <div className="font-headline-1 text-headline-1 text-text-primary mt-0.5 tracking-tight">
                  {heldTotal > 0 ? formatRupiahShort(heldTotal) : "Rp 0"}
                </div>
              </div>
            </div>
            <div className="mt-3 pt-2 flex flex-col gap-1">
              <div className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-brand-50 text-brand-700 w-full">
                <Icon name="account_balance_wallet" className="text-[13px] shrink-0" />
                <span className="font-micro-badge text-micro-badge truncate">
                  Tunai {formatRupiahShort(heldCash)}
                </span>
              </div>
              <div className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-surface-container text-text-secondary w-full">
                <Icon name="qr_code_scanner" className="text-[13px] shrink-0" />
                <span className="font-micro-badge text-micro-badge truncate">
                  QRIS/Transfer {formatRupiahShort(heldDigital)}
                </span>
              </div>
            </div>
          </section>
        )}

        <section className="col-span-1 rounded-[20px] p-4 bg-surface flex flex-col justify-between clay-card">
          <div className="flex flex-col gap-2">
            <div className="w-10 h-10 rounded-xl bg-brand-50 flex items-center justify-center text-brand-600 shadow-[inset_0px_1px_2px_rgba(255,255,255,0.9)]">
              <Icon name="garage" className="text-[22px]" />
            </div>
            <div>
              <span className="font-caption text-caption text-text-secondary line-clamp-1">
                Order Dikerjakan
              </span>
              <div className="font-headline-1 text-headline-1 text-text-primary mt-0.5 tracking-tight flex items-baseline gap-1">
                {inProgress.length}
                <span className="font-caption text-caption text-text-muted">
                  Unit
                </span>
              </div>
            </div>
          </div>
          <div className="mt-3 pt-2">
            <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-brand-50 text-brand-700 w-full">
              <span className="h-1.5 w-1.5 rounded-full bg-brand-500 animate-pulse shrink-0" />
              <span className="font-micro-badge text-micro-badge truncate">
                {queued.length} Antre • {qcReview.length} QC
              </span>
            </div>
          </div>
        </section>

        {!canSeeBranchCash && unpaidCount > 0 ? (
          <Link
            href="/pos/orders"
            className="col-span-2 rounded-[16px] p-3.5 bg-warning-surface flex items-center gap-3 active:scale-[0.98] transition-transform"
          >
            <Icon name="hourglass_top" className="text-[22px] text-warning-text shrink-0" />
            <div className="min-w-0">
              <p className="font-caption text-caption text-warning-text font-semibold">
                {unpaidCount} order menunggu pembayaran kasir
              </p>
              <p className="font-micro-badge text-micro-badge text-warning-text opacity-80">
                Total tagihan {formatRupiah(unpaidTotal)}
              </p>
            </div>
          </Link>
        ) : null}

        <section className="col-span-2 rounded-[20px] p-4 bg-surface clay-card">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h3 className="font-headline-2 text-headline-2 text-text-primary leading-tight">
                Aksi Cepat Operasional
              </h3>
              <p className="font-caption text-caption text-text-muted">
                Pintasan sesuai hak akses {roleLabel(role)}
              </p>
            </div>
            <Icon name="bolt" className="text-text-muted text-[18px]" />
          </div>
          <div className="grid grid-cols-4 gap-2">
            {quickActions.map((action) =>
              action.disabled ? (
                <button
                  key={action.label}
                  type="button"
                  aria-disabled="true"
                  title={action.disabledTitle ?? "Modul menyusul"}
                  className="group flex flex-col items-center gap-1.5 p-2 rounded-xl bg-surface-container-low text-center cursor-not-allowed opacity-70"
                >
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center shadow-[inset_0px_1px_2px_rgba(255,255,255,0.9)] bg-brand-50 text-brand-600">
                    <Icon name={action.icon} className="text-[20px]" />
                  </div>
                  <span className="font-micro-badge text-micro-badge text-text-primary leading-tight line-clamp-1">
                    {action.label}
                  </span>
                </button>
              ) : (
                <Link
                  key={action.label}
                  href={action.href}
                  className="group flex flex-col items-center gap-1.5 p-2 rounded-xl bg-surface-container-low text-center active:scale-95 transition-transform"
                >
                  <div
                    className={`w-10 h-10 rounded-xl flex items-center justify-center shadow-[inset_0px_1px_2px_rgba(255,255,255,0.9)] ${
                      action.primary
                        ? "bg-brand-500 text-on-primary"
                        : "bg-brand-50 text-brand-600"
                    }`}
                  >
                    <Icon name={action.icon} className="text-[20px]" />
                  </div>
                  <span className="font-micro-badge text-micro-badge text-text-primary leading-tight line-clamp-1">
                    {action.label}
                  </span>
                </Link>
              ),
            )}
          </div>
          {heldCount > 0 ? (
            <p className="mt-3 font-caption text-caption text-text-muted">
              Anda memegang {heldCount} kas titipan hari ini. Serahkan ke Admin
              Kasir saat shift dibuka.
            </p>
          ) : null}
        </section>

        {liveOrder && (
          // Kartu ini adalah order yang sedang dikerjakan, jadi harus bisa
          // diklik untuk membuka detailnya. Sebelumnya berupa section biasa
          // tanpa tautan sama sekali, sehingga satu-satunya jalan ke detail
          // order harus lewat menu Antrean.
          <Link
            href={`/pos/orders/${liveOrder.id}`}
            aria-label={`Buka detail order ${liveOrder.order_number}`}
            className="col-span-2 rounded-[20px] p-4 bg-surface clay-card active:scale-[0.99] transition-transform"
          >
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-success-base opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-success-base" />
                </span>
                <span className="font-caption text-caption text-text-primary font-semibold">
                  {ORDER_STAGE[liveOrder.status]?.label ?? "Order Aktif"}
                </span>
              </div>
              <span className="font-caption text-caption text-brand-600 font-medium font-mono">
                {liveOrder.order_number}
              </span>
            </div>
            <div className="flex gap-3 items-center">
              <div className="w-16 h-16 rounded-xl bg-surface-container flex items-center justify-center shrink-0 text-brand-600 shadow-[inset_0px_1px_2px_rgba(0,0,0,0.05)]">
                <Icon name="directions_car" className="text-[30px]" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-1">
                  <h4 className="font-body-bold text-body-bold text-text-primary truncate">
                    {liveOrder.vehicle_model ?? "Kendaraan"}
                  </h4>
                  <span className="font-micro-badge text-micro-badge px-2 py-0.5 rounded bg-surface-container-high text-text-secondary font-mono shrink-0">
                    {liveOrder.license_plate}
                  </span>
                </div>
                <p className="font-caption text-caption text-brand-600 mt-0.5 truncate">
                  {liveOrder.service_package ?? "Paket layanan"}
                </p>
                <div className="mt-2 flex items-center gap-2">
                  <div className="w-full bg-surface-container rounded-full h-2 overflow-hidden">
                    <div
                      className="bg-gradient-to-r from-brand-600 to-brand-400 h-2 rounded-full"
                      style={{
                        width: `${ORDER_STAGE[liveOrder.status]?.progress ?? 0}%`,
                      }}
                    />
                  </div>
                  <span className="font-micro-badge text-micro-badge text-text-muted shrink-0">
                    {ORDER_STAGE[liveOrder.status]?.progress ?? 0}%
                  </span>
                </div>
              </div>
            </div>
            <div className="mt-3 pt-3 flex items-center justify-between bg-surface-container-low px-3 py-2 rounded-xl">
              <div className="flex items-center gap-2">
                <div className="w-5 h-5 rounded-full bg-brand-200 text-brand-700 flex items-center justify-center font-micro-badge text-micro-badge">
                  {liveAssignee
                    ? liveAssignee
                        .split(/\s+/)
                        .slice(0, 2)
                        .map((p) => p[0])
                        .join("")
                        .toUpperCase()
                    : "RB"}
                </div>
                <span className="font-caption text-caption text-text-secondary">
                  {liveAssignee ? `Teknisi: ${liveAssignee}` : "Belum ada teknisi"}
                </span>
              </div>
              <span className="font-caption text-caption text-success-text font-medium">
                {formatRupiah(liveOrder.total_price)}
              </span>
            </div>
            <p className="mt-2 font-micro-badge text-micro-badge text-brand-600 text-right">
              Ketuk untuk membuka detail pengerjaan
            </p>
          </Link>
        )}

        {note && (
          <section className="col-span-2 rounded-[20px] p-3.5 bg-brand-50 flex items-start gap-3 shadow-[0px_2px_4px_rgba(15,23,42,0.03)]">
            <div className="w-8 h-8 rounded-lg bg-surface flex items-center justify-center text-brand-600 shrink-0 shadow-[0px_2px_4px_rgba(37,99,235,0.08)]">
              <Icon name="campaign" className="text-[18px]" />
            </div>
            <div className="flex-1 min-w-0">
              <span className="font-caption text-caption text-text-primary font-semibold block">
                {note.title}
              </span>
              <p className="font-caption text-caption text-text-secondary mt-0.5 line-clamp-2">
                {note.body}
              </p>
            </div>
          </section>
        )}
      </div>

      <BottomNav role={role} />
    </div>
  );
}