"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { formatRupiah, formatTimeWib, formatDateWib } from "@/lib/format";
import { PAYMENT_LABELS, whatsappLink } from "@/lib/pos";
import { Icon } from "@/components/ui/icon";
import { useSingleFlight } from "@/lib/use-single-flight";

export type TeamMember = { id: string; full_name: string; is_lead: boolean };

export type QueueOrder = {
  id: string;
  order_number: string;
  license_plate: string | null;
  vehicle_model: string | null;
  vehicle_size: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  service_package: string | null;
  status: string;
  total_price: number | null;
  payment_method: string | null;
  created_at: string;
  completed_at: string | null;
  assigned_to: string | null;
  cancellation_reason: string | null;
  branch_id: string | null;
  team: TeamMember[];
};

const STATUS_META: Record<
  string,
  { label: string; cls: string; icon: string }
> = {
  queued: {
    label: "Antrean",
    cls: "bg-warning-surface text-warning-text",
    icon: "hourglass_top",
  },
  in_progress: {
    label: "Dikerjakan",
    cls: "bg-brand-50 text-brand-700",
    icon: "build",
  },
  qc_review: {
    label: "QC Review",
    cls: "bg-surface-container-high text-text-secondary",
    icon: "fact_check",
  },
  completed: {
    label: "Selesai",
    cls: "bg-success-surface text-success-text",
    icon: "task_alt",
  },
  /*
   * Tahap serah terima dari migrasi 0030. Tanpa entri di sini, kartu
   * antrean menampilkan label status kosong untuk order yang justru sudah
   * selesai dan tinggal diambil.
   */
  menunggu_diambil: {
    label: "Siap Diambil",
    cls: "bg-success-surface text-success-text",
    icon: "local_shipping",
  },
  diserahkan: {
    label: "Sudah Diserahkan",
    cls: "bg-success-surface text-success-text",
    icon: "verified",
  },
  cancelled: {
    label: "Dibatalkan",
    cls: "bg-danger-surface text-danger-text",
    icon: "cancel",
  },
};

const TRANSITIONS: Record<
  string,
  { status: string; label: string; icon: string }[]
> = {
  queued: [
    { status: "in_progress", label: "Mulai Pengerjaan", icon: "play_arrow" },
  ],
  in_progress: [
    { status: "qc_review", label: "Ajukan QC", icon: "fact_check" },
  ],
  qc_review: [
    { status: "completed", label: "Selesaikan", icon: "task_alt" },
    { status: "in_progress", label: "Kembalikan", icon: "undo" },
  ],
  /*
   * Tahap serah terima punya RPC sendiri. apply_order_status sengaja tidak
   * boleh dipakai di sini karena advance_handover yang memvalidasi urutan
   * selesai, menunggu diambil, lalu diserahkan.
   */
  completed: [{ status: "menunggu_diambil", label: "Siapkan untuk Diambil", icon: "local_shipping" }],
  menunggu_diambil: [{ status: "diserahkan", label: "Serahkan ke Pelanggan", icon: "verified" }],
};

const STATUS_SERAH_TERIMA = new Set(["menunggu_diambil", "diserahkan"]);

/*
 * Tab antrean.
 *
 * Sebelumnya hanya ada queued, in_progress, qc_review, dan completed.
 * Migrasi 0030 menambah menunggu_diambil dan diserahkan ke enum status, dan
 * keduanya punya aksi di halaman ini, tetapi tidak punya tab. Filter memakai
 * pencocokan status yang persis, jadi begitu satu order berhenti di
 * menunggu_diambil, order itu tidak cocok dengan tab mana pun dan hilang
 * dari layar walaupun datanya masih ada. Tab "Selesai" sengaja dibuat
 * mencakup tiga status pascapengerjaan supaya tidak ada order yang tidak bisa
 * ditemukan.
 */
const FILTERS = [
  { key: "all", label: "Semua" },
  { key: "queued", label: "Antrean" },
  { key: "in_progress", label: "Dikerjakan" },
  { key: "qc_review", label: "QC Review" },
  { key: "selesai", label: "Selesai" },
];

/* Status pascapengerjaan yang dikumpulkan pada tab Selesai. */
const STATUS_SELESAI = new Set(["completed", "menunggu_diambil", "diserahkan"]);

function initials(name: string | null) {
  if (!name) return "RB";
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0])
    .join("")
    .toUpperCase();
}

export function OrderQueue({
  orders: initialOrders,
  canManage,
  canStartWork,
  role,
}: {
  orders: QueueOrder[];
  canManage: boolean;
  canStartWork?: boolean;
  role: string;
}) {
  const router = useRouter();
  const kirimSekali = useSingleFlight();

  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Modal pilih tim untuk claim order
  const [showTeamModal, setShowTeamModal] = useState(false);
  const [claimOrder, setClaimOrder] = useState<QueueOrder | null>(null);
  const [availableStaff, setAvailableStaff] = useState<{ id: string; full_name: string; busy: boolean }[]>([]);
  const [selectedStaff, setSelectedStaff] = useState<string[]>([]);
  const [teamModalLoading, setTeamModalLoading] = useState(false);

  const orders = initialOrders;

  const query = search.trim().toLowerCase();
  const isStaff = role === "karyawan";
  const filtered = useMemo(
    () =>
      orders.filter((order) => {
        const matchFilter =
          filter === "all"
            ? order.status !== "cancelled"
            : filter === "selesai"
              ? STATUS_SELESAI.has(order.status)
              : order.status === filter;
        const matchQuery =
          query === "" ||
          (order.order_number ?? "").toLowerCase().includes(query) ||
          (order.license_plate ?? "").toLowerCase().includes(query) ||
          (!isStaff && (order.customer_name ?? "").toLowerCase().includes(query)) ||
          (order.vehicle_model ?? "").toLowerCase().includes(query);
        return matchFilter && matchQuery;
      }),
    [orders, filter, query, isStaff],
  );

  const counts = useMemo(
    () => ({
      queued: orders.filter((o) => o.status === "queued").length,
      in_progress: orders.filter((o) => o.status === "in_progress").length,
      qc_review: orders.filter((o) => o.status === "qc_review").length,
      selesai: orders.filter((o) => STATUS_SELESAI.has(o.status)).length,
    }),
    [orders],
  );

  async function transition(order: QueueOrder, status: string) {
    setBusyId(order.id);
    setError(null);
    const supabase = createClient();
    const { error: rpcErr } = STATUS_SERAH_TERIMA.has(status)
      ? await supabase.rpc("advance_handover", { p_order_id: order.id, p_next: status })
      : await supabase.rpc("apply_order_status", { p_order_id: order.id, p_status: status });
    setBusyId(null);
    if (rpcErr) {
      setError(rpcErr.message);
      return;
    }
    router.refresh();
  }

  async function startWork(order: QueueOrder) {
    setBusyId(order.id);
    setError(null);
    const supabase = createClient();
    const { error: rpcError } = await supabase.rpc("start_order_work", {
      p_order_id: order.id,
    });
    setBusyId(null);
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    router.refresh();
  }

  async function cancel(order: QueueOrder) {
    const reason =
      typeof window !== "undefined"
        ? window.prompt(
            `Alasan pembatalan order ${order.order_number}:`,
            "Dibatalkan oleh pelanggan",
          )
        : null;
    if (reason === null) return;
    setBusyId(order.id);
    setError(null);
    const supabase = createClient();
    const { error: rpcError } = await supabase.rpc("cancel_order", {
      p_order_id: order.id,
      p_reason: reason.trim() || "Dibatalkan",
    });
    setBusyId(null);
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    router.refresh();
  }

  // Buka modal pilih tim untuk claim order
  async function openTeamModal(order: QueueOrder) {
    setClaimOrder(order);
    setSelectedStaff([]);
    setTeamModalLoading(true);
    try {
      const supabase = createClient();
      // Ambil karyawan aktif cabang yang sama, exclude yang busy
      const { data: staffData } = await supabase
        .from("profiles")
        .select("id, full_name")
        .eq("role", "karyawan")
        .eq("is_active", true)
        .eq("branch_id", order.branch_id ?? null);

      // Ambil yang busy di order lain in_progress/qc_review
      const { data: busyData } = await supabase
        .from("order_team_members")
        .select("profile_id, orders!inner(status, branch_id)")
        .in("orders.status", ["in_progress", "qc_review"])
        .eq("orders.branch_id", order.branch_id ?? null);

      const busyIds = new Set((busyData ?? []).map((r) => r.profile_id as string));

      const staff = (staffData ?? []).map((s) => ({
        id: s.id,
        full_name: s.full_name,
        busy: busyIds.has(s.id),
      }));
      setAvailableStaff(staff);
    } catch {
      setAvailableStaff([]);
    } finally {
      setTeamModalLoading(false);
      setShowTeamModal(true);
    }
  }

  function toggleStaff(id: string) {
    const staff = availableStaff.find((s) => s.id === id);
    if (staff?.busy) return;
    setSelectedStaff((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  async function submitClaimWithTeam() {
    if (!claimOrder) return;
    if (!kirimSekali.mulai()) return;

    setTeamModalLoading(true);
    setError(null);
    try {
      const supabase = createClient();
      const { error: rpcError } = await supabase.rpc("start_order_work", {
        p_order_id: claimOrder.id,
        p_team_ids: selectedStaff,
      });
      if (rpcError) throw new Error(rpcError.message);

      setShowTeamModal(false);
      setClaimOrder(null);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal claim order, coba lagi.");
    } finally {
      kirimSekali.selesai();
      setTeamModalLoading(false);
    }
  }

  return (
    <div className="px-gutter py-4 pb-nav-plain flex flex-col gap-4">
      <div className="grid grid-cols-4 gap-2">
        {[
          { key: "queued", label: "Antrean", value: counts.queued },
          { key: "in_progress", label: "Kerja", value: counts.in_progress },
          { key: "qc_review", label: "QC", value: counts.qc_review },
          { key: "selesai", label: "Selesai", value: counts.selesai },
        ].map((stat) => (
          <div
            key={stat.key}
            className="clay-card p-3 flex flex-col items-center gap-0.5"
          >
            <span className="font-headline-2 text-headline-2 text-text-primary">
              {stat.value}
            </span>
            <span className="font-caption text-caption text-text-muted">
              {stat.label}
            </span>
          </div>
        ))}
      </div>

      <div className="relative">
        <Icon name="search" className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted text-[20px]" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Cari plat, nama, atau no. order..."
          className="w-full h-12 pl-10 pr-3 rounded-2xl bg-surface-container-low font-body text-body text-text-primary outline-none focus:ring-2 focus:ring-brand-400"
        />
      </div>

      <div className="flex gap-2 overflow-x-auto no-scrollbar -mx-gutter px-gutter">
        {FILTERS.map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => setFilter(item.key)}
            // min-h-11 karena py-2 saja hanya menghasilkan 32px, terlalu pendek untuk
            // ibu jari. Filter ini dipakai berulang sepanjang hari jadi sering
            // ditekan dengan satu tangan sambil memegang unit.
            className={`shrink-0 px-4 min-h-11 rounded-full font-caption text-caption flex items-center active:scale-95 transition-transform ${
              filter === item.key
                ? "bg-primary text-white"
                : "bg-surface-container-low text-text-secondary"
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {error ? (
        <div className="p-3 rounded-xl bg-danger-surface text-danger-text font-body text-body flex items-center gap-2">
          <Icon name="error" className="text-[20px]" />
          {error}
        </div>
      ) : null}

      {filtered.length === 0 ? (
        <div className="clay-card p-8 flex flex-col items-center text-center gap-2">
          <Icon name="inbox" className="text-[40px] text-text-muted" />
          <p className="font-body text-body text-text-secondary">
            Tidak ada order pada filter ini.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {filtered.map((order) => {
            const meta = STATUS_META[order.status] ?? STATUS_META.queued;
            const actions = TRANSITIONS[order.status] ?? [];
            const busy = busyId === order.id;
            const canCancel =
              canManage &&
              (order.status === "queued" || order.status === "in_progress");
            // Pengerjaan tidak boleh dimulai tanpa teknisi. Server menolaknya,
            // dan tombolnya di sini dimatikan supaya alasannya terlihat.
            const perluTeknisi = order.status === "queued" && order.team.length === 0;
            // Bisa claim order jika: karyawan, status queued, tidak ada tim, dan karyawan free
            const canClaimOrder = order.status === "queued" && order.team.length === 0 && !busy;
            const waHref = !isStaff && order.customer_phone
              ? whatsappLink(
                  order.customer_phone,
                  `Halo ${order.customer_name ?? ""}, ini RB AUTOLUXE. Terkait order ${order.order_number} (${order.license_plate ?? ""}), `,
                )
              : null;
            return (
              <div key={order.id} className="clay-card p-4 flex flex-col gap-3">
                <div className="flex items-center justify-between gap-2">
                  <Link
                    href={`/pos/orders/${order.id}`}
                    // min-h-11 dan inline-flex supaya tautan nomor order, yang
                    // adalah jalan utama masuk ke detail order, punya tinggi
                    // target sentuh yang layak dan bukan sekadar tinggi teks.
                    className="font-caption text-caption font-mono text-brand-600 font-semibold inline-flex items-center min-h-11 self-start -my-2.5"
                  >
                    {order.order_number}
                  </Link>
                  <span
                    className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full font-caption text-caption ${meta.cls}`}
                  >
                    <Icon name={meta.icon} className="text-[14px]" />
                    {meta.label}
                  </span>
                </div>

                <div className="flex items-start gap-3">
                  <div className="w-12 h-12 rounded-xl bg-surface-container flex items-center justify-center shrink-0 text-brand-600">
                    <Icon name={(order.vehicle_size ?? "").startsWith("Motor")
                        ? "two_wheeler"
                        : "directions_car"} className="text-[24px]" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="font-body-bold text-body-bold text-text-primary truncate">
                        {order.vehicle_model ?? "Kendaraan"}
                      </h3>
                      {order.license_plate ? (
                        <span className="font-micro-badge text-micro-badge px-1.5 py-0.5 rounded bg-surface-container-high text-text-secondary font-mono shrink-0">
                          {order.license_plate}
                        </span>
                      ) : null}
                    </div>
                    <p className="font-caption text-caption text-brand-600 mt-0.5 truncate">
                      {order.service_package ?? "Paket layanan"}
                    </p>
                    <p className="font-caption text-caption text-text-muted mt-0.5 truncate">
                      {!isStaff ? (
                        <>
                          {order.customer_name ?? "-"}
                          {order.customer_phone ? ` • ${order.customer_phone}` : ""}
                        </>
                      ) : (
                        "Data pelanggan disembunyikan"
                      )}
                    </p>
                  </div>
                </div>

                <div className="flex items-center justify-between gap-2 bg-surface-container-low rounded-xl px-3 py-2">
                  <div className="flex items-center gap-1.5 min-w-0">
                    {order.team.length === 0 ? (
                      perluTeknisi ? (
                        <Link
                          href={`/pos/orders/${order.id}`}
                          className="font-caption text-caption text-brand-600 flex items-center gap-1 min-h-9"
                        >
                          <Icon name="group_add" className="text-[16px]" />
                          Belum ada teknisi — atur dulu
                        </Link>
                      ) : (
                        <span className="font-caption text-caption text-text-muted">
                          Belum ada teknisi
                        </span>
                      )
                    ) : (
                      <>
                        <div className="flex -space-x-1.5">
                          {order.team.slice(0, 4).map((member) => (
                            <div
                              key={member.id}
                              className={`w-6 h-6 rounded-full flex items-center justify-center font-micro-badge text-micro-badge border-2 border-surface ${
                                member.is_lead
                                  ? "bg-brand-500 text-white"
                                  : "bg-brand-200 text-brand-700"
                              }`}
                              title={member.full_name}
                            >
                              {initials(member.full_name)}
                            </div>
                          ))}
                        </div>
                        <span className="font-caption text-caption text-text-secondary truncate">
                          {order.team.length} teknisi
                        </span>
                      </>
                    )}
                  </div>
                  <span className="font-body-bold text-body-bold text-text-primary shrink-0">
                    {formatRupiah(order.total_price ?? 0)}
                  </span>
                </div>

                <div className="flex items-center justify-between gap-2">
                  <span className="font-caption text-caption text-text-muted">
                    {formatDateWib(order.created_at)} •{" "}
                    {formatTimeWib(order.created_at)} WIB
                  </span>
                  {order.payment_method ? (
                    <span className="font-caption text-caption text-text-secondary">
                      {PAYMENT_LABELS[order.payment_method] ??
                        order.payment_method}
                    </span>
                  ) : null}
                </div>

                {order.status === "cancelled" && order.cancellation_reason ? (
                  <p className="font-caption text-caption text-danger-text">
                    Alasan: {order.cancellation_reason}
                  </p>
                ) : null}

                <div className="flex items-center gap-2 pt-1">
                  {waHref ? (
                    <a
                      href={waHref}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label="Hubungi pelanggan via WhatsApp"
                      className="w-11 h-11 rounded-xl bg-whatsapp/10 text-whatsapp flex items-center justify-center shrink-0 active:scale-95 transition-transform"
                    >
                      <Icon name="chat" className="text-[20px]" />
                    </a>
                  ) : null}
                  {canManage && actions.length > 0 ? (
                    <div className="flex flex-1 gap-2">
                      {actions.map((action) => (
                        <button
                          key={action.status}
                          type="button"
                          disabled={busy || (perluTeknisi && action.status === "in_progress")}
                          title={
                            perluTeknisi && action.status === "in_progress"
                              ? "Pilih teknisi dulu sebelum memulai pengerjaan."
                              : undefined
                          }
                          onClick={() => transition(order, action.status)}
                          className={`flex-1 py-2.5 rounded-xl font-caption text-caption flex items-center justify-center gap-1 active:scale-95 transition-transform disabled:opacity-60 ${
                            action.status === "completed"
                              ? "bg-success-surface text-success-text"
                              : "bg-primary text-white"
                          }`}
                        >
                          <Icon name={action.icon} className="text-[18px]" />
                          {action.label}
                        </button>
                      ))}
                    </div>
                  ) : null}
                  {canCancel ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => cancel(order)}
                      aria-label="Batalkan order"
                      className="w-10 h-10 rounded-xl bg-danger-surface text-danger-text flex items-center justify-center shrink-0 active:scale-95 transition-transform disabled:opacity-60"
                    >
                      <Icon name="cancel" className="text-[20px]" />
                    </button>
                  ) : null}
{canStartWork && order.status === "queued" && !canManage ? (
                      perluTeknisi ? (
                        <button
                          type="button"
                          disabled={busy || !canClaimOrder}
                          title={
                            !canClaimOrder
                              ? "Kamu sedang mengerjakan order lain. Selesaikan dulu."
                              : "Pilih rekan kerja lalu mulai pengerjaan"
                          }
                          onClick={() => openTeamModal(order)}
                          className="flex-1 py-2.5 rounded-xl bg-primary text-white font-caption text-caption flex items-center justify-center gap-1 active:scale-95 transition-transform disabled:opacity-60"
                        >
                          <Icon name="engineering" className="text-[18px]" />
                          Kerjakan Antrian Ini
                        </button>
                      ) : (
                        <button
                          type="button"
                          disabled={busy}
                          title={busy ? "Sedang memproses..." : undefined}
                          onClick={() => startWork(order)}
                          className="flex-1 py-2.5 rounded-xl bg-primary text-white font-caption text-caption flex items-center justify-center gap-1 active:scale-95 transition-transform disabled:opacity-60"
                        >
                          <Icon name="engineering" className="text-[18px]" />
                          Kerjakan Sekarang
                        </button>
                      )
                    ) : null}
                  <Link
                    href={`/pos/orders/${order.id}`}
                    className="min-h-11 px-3 rounded-xl bg-surface-container text-text-secondary flex items-center gap-1 font-caption text-caption shrink-0"
                  >
                    <Icon name="photo_camera" className="text-[18px]" />
                    Inspeksi
                  </Link>
                  {!canManage && !canStartWork ? (
                    <span className="font-caption text-caption text-text-muted flex-1 text-right">
                      Hanya lihat
                    </span>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );

  // Modal Pilih Tim untuk Claim Order
  if (showTeamModal) {
    const order = claimOrder as any;
    const maxTeam = order.vehicle_size?.startsWith("Motor") ? 3 : 4;
    const canSelectMore = selectedStaff.length < maxTeam - 1; // -1 karena caller otomatis jadi lead
    return (
      <>
        <div className="fixed inset-0 z-[60] bg-black/50 flex items-center justify-center p-4" onClick={() => setShowTeamModal(false)} />
        <div className="fixed z-[61] w-full max-w-md bg-surface rounded-2xl p-6 clay-card shadow-xl animate-in slide-in-from-bottom-4 duration-200" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-headline-2 text-headline-2 text-text-primary">Pilih Rekan Kerja</h3>
            <button
              type="button"
              onClick={() => setShowTeamModal(false)}
              className="w-10 h-10 rounded-xl bg-surface-container-low flex items-center justify-center text-text-secondary active:scale-95"
              aria-label="Tutup"
            >
              <Icon name="close" className="text-[22px]" />
            </button>
          </div>
          <p className="font-caption text-caption text-text-secondary mb-4">
            Order <b>{(order as any).order_number}</b> ({(order as any).vehicle_model ?? "Kendaraan"})<br />
            Maksimal <b>{maxTeam}</b> orang (termasuk Anda sebagai lead). Sudah dipilih: <b>{selectedStaff.length}</b> rekan.
          </p>
          {teamModalLoading ? (
            <div className="h-40 flex items-center justify-center">
              <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            </div>
          ) : (
            <div className="max-h-64 overflow-y-auto space-y-2">
              {availableStaff.length === 0 ? (
                <p className="font-body text-body text-text-secondary text-center py-8">
                  Tidak ada karyawan aktif di cabang ini.
                </p>
              ) : (
                availableStaff.map((staff) => (
                  <button
                    key={staff.id}
                    type="button"
                    disabled={staff.busy || (!canSelectMore && !selectedStaff.includes(staff.id))}
                    onClick={() => toggleStaff(staff.id)}
                    className={`w-full px-4 py-3 rounded-xl flex items-center justify-between gap-2 text-left transition-colors ${
                      selectedStaff.includes(staff.id)
                        ? "bg-primary text-white"
                        : staff.busy
                        ? "bg-surface-container-low text-text-muted opacity-60"
                        : "bg-surface-container-low text-text-secondary hover:bg-surface-container"
                    }`}
                  >
                    <span className="font-body text-body truncate">{staff.full_name}</span>
                    {staff.busy && (
                      <span className="font-micro-badge text-micro-badge bg-warning-surface text-warning-text px-2 py-0.5 rounded-full shrink-0">
                        Sibuk
                      </span>
                    )}
                    {selectedStaff.includes(staff.id) && (
                      <Icon name="check_circle" className="text-[20px] text-white shrink-0" />
                    )}
                  </button>
                ))
              )}
            </div>
          )}
          <div className="mt-6 flex gap-3">
            <button
              type="button"
              onClick={() => setShowTeamModal(false)}
              className="flex-1 py-3 rounded-xl bg-surface-container-low text-text-secondary font-body-bold text-body-bold active:scale-95"
            >
              Batal
            </button>
            <button
              type="button"
              disabled={teamModalLoading || selectedStaff.length > maxTeam - 1}
              onClick={submitClaimWithTeam}
              className="flex-1 py-3 rounded-xl primary-gradient text-white font-body-bold text-body-bold active:scale-95 disabled:opacity-60 flex items-center justify-center gap-2"
            >
              {teamModalLoading ? (
                <>
                  <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Memproses...
                </>
              ) : (
                <>
                  <Icon name="play_arrow" className="text-[20px]" />
                  Mulai Pengerjaan
                </>
              )}
            </button>
          </div>
        </div>
      </>
    );
  }
}
