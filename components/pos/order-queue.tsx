"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { formatRupiah, formatTimeWib, formatDateWib } from "@/lib/format";
import { PAYMENT_LABELS, whatsappLink } from "@/lib/pos";

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
};

const FILTERS = [
  { key: "all", label: "Semua" },
  { key: "queued", label: "Antrean" },
  { key: "in_progress", label: "Dikerjakan" },
  { key: "qc_review", label: "QC Review" },
  { key: "completed", label: "Selesai" },
];

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
}: {
  orders: QueueOrder[];
  canManage: boolean;
  canStartWork?: boolean;
}) {
  const router = useRouter();

  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const orders = initialOrders;

  const query = search.trim().toLowerCase();
  const filtered = useMemo(
    () =>
      orders.filter((order) => {
        const matchFilter =
          filter === "all" ? order.status !== "cancelled" : order.status === filter;
        const matchQuery =
          query === "" ||
          (order.order_number ?? "").toLowerCase().includes(query) ||
          (order.license_plate ?? "").toLowerCase().includes(query) ||
          (order.customer_name ?? "").toLowerCase().includes(query) ||
          (order.vehicle_model ?? "").toLowerCase().includes(query);
        return matchFilter && matchQuery;
      }),
    [orders, filter, query],
  );

  const counts = useMemo(
    () => ({
      queued: orders.filter((o) => o.status === "queued").length,
      in_progress: orders.filter((o) => o.status === "in_progress").length,
      qc_review: orders.filter((o) => o.status === "qc_review").length,
      completed: orders.filter((o) => o.status === "completed").length,
    }),
    [orders],
  );

  async function transition(order: QueueOrder, status: string) {
    setBusyId(order.id);
    setError(null);
    const supabase = createClient();
    const { error: rpcError } = await supabase.rpc("apply_order_status", {
      p_order_id: order.id,
      p_status: status,
    });
    setBusyId(null);
    if (rpcError) {
      setError(rpcError.message);
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

  return (
    <div className="px-gutter py-4 pb-28 flex flex-col gap-4">
      <div className="grid grid-cols-4 gap-2">
        {[
          { key: "queued", label: "Antrean", value: counts.queued },
          { key: "in_progress", label: "Kerja", value: counts.in_progress },
          { key: "qc_review", label: "QC", value: counts.qc_review },
          { key: "completed", label: "Selesai", value: counts.completed },
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
        <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-text-muted text-[20px]">
          search
        </span>
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
            className={`shrink-0 px-4 py-2 rounded-full font-caption text-caption active:scale-95 transition-transform ${
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
          <span className="material-symbols-outlined text-[20px]">error</span>
          {error}
        </div>
      ) : null}

      {filtered.length === 0 ? (
        <div className="clay-card p-8 flex flex-col items-center text-center gap-2">
          <span className="material-symbols-outlined text-[40px] text-text-muted">
            inbox
          </span>
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
            const waHref = order.customer_phone
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
                    className="font-caption text-caption font-mono text-brand-600 font-semibold"
                  >
                    {order.order_number}
                  </Link>
                  <span
                    className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full font-caption text-caption ${meta.cls}`}
                  >
                    <span className="material-symbols-outlined text-[14px]">
                      {meta.icon}
                    </span>
                    {meta.label}
                  </span>
                </div>

                <div className="flex items-start gap-3">
                  <div className="w-12 h-12 rounded-xl bg-surface-container flex items-center justify-center shrink-0 text-brand-600">
                    <span className="material-symbols-outlined text-[24px]">
                      {order.vehicle_size === "Motor"
                        ? "two_wheeler"
                        : "directions_car"}
                    </span>
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
                      {order.customer_name ?? "-"}
                      {order.customer_phone ? ` • ${order.customer_phone}` : ""}
                    </p>
                  </div>
                </div>

                <div className="flex items-center justify-between gap-2 bg-surface-container-low rounded-xl px-3 py-2">
                  <div className="flex items-center gap-1.5 min-w-0">
                    {order.team.length === 0 ? (
                      <span className="font-caption text-caption text-text-muted">
                        Belum ada teknisi
                      </span>
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
                      className="w-10 h-10 rounded-xl bg-whatsapp/10 text-whatsapp flex items-center justify-center shrink-0 active:scale-95 transition-transform"
                    >
                      <span className="material-symbols-outlined text-[20px]">
                        chat
                      </span>
                    </a>
                  ) : null}
                  {canManage && actions.length > 0 ? (
                    <div className="flex flex-1 gap-2">
                      {actions.map((action) => (
                        <button
                          key={action.status}
                          type="button"
                          disabled={busy}
                          onClick={() => transition(order, action.status)}
                          className={`flex-1 py-2.5 rounded-xl font-caption text-caption flex items-center justify-center gap-1 active:scale-95 transition-transform disabled:opacity-60 ${
                            action.status === "completed"
                              ? "bg-success-surface text-success-text"
                              : "bg-primary text-white"
                          }`}
                        >
                          <span className="material-symbols-outlined text-[18px]">
                            {action.icon}
                          </span>
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
                      <span className="material-symbols-outlined text-[20px]">
                        cancel
                      </span>
                    </button>
                  ) : null}
                  {!canManage && canStartWork && order.status === "queued" ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => startWork(order)}
                      className="flex-1 py-2.5 rounded-xl bg-primary text-white font-caption text-caption flex items-center justify-center gap-1 active:scale-95 transition-transform disabled:opacity-60"
                    >
                      <span className="material-symbols-outlined text-[18px]">
                        engineering
                      </span>
                      Kerjakan Sekarang
                    </button>
                  ) : null}
                  <Link
                    href={`/pos/orders/${order.id}`}
                    className="h-10 px-3 rounded-xl bg-surface-container text-text-secondary flex items-center gap-1 font-caption text-caption shrink-0"
                  >
                    <span className="material-symbols-outlined text-[18px]">
                      photo_camera
                    </span>
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
}
