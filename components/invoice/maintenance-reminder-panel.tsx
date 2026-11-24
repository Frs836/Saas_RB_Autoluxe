"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { Icon } from "@/components/ui/icon";
import { formatDateWib } from "@/lib/format";
import { whatsappLink } from "@/lib/pos";
import {
  updateScheduleStatusAction,
  type MaintenanceScheduleItem,
} from "@/app/actions/maintenance-schedule";

export function MaintenanceReminderPanel({
  schedules: initialSchedules,
}: {
  schedules: MaintenanceScheduleItem[];
}) {
  const [schedules, setSchedules] = useState(initialSchedules);
  const [filter, setFilter] = useState<"all" | "due_soon" | "reminded" | "completed">("due_soon");
  const [isPending, startTransition] = useTransition();
  const [activeMsg, setActiveMsg] = useState<{ id: string; text: string } | null>(null);

  const today = useMemo(() => new Date().toISOString().split("T")[0], []);

  // Filter schedules
  const filtered = useMemo(() => {
    return schedules.filter((s) => {
      if (filter === "completed") return s.status === "completed";
      if (filter === "reminded") return s.status === "reminded";
      if (filter === "due_soon") {
        if (s.status === "completed" || s.status === "cancelled") return false;
        // Due soon jika tanggalnya <= 14 hari ke depan dari hari ini atau sudah lewat
        const d = new Date(s.dueDate).getTime();
        const limit = new Date().getTime() + 14 * 24 * 60 * 60 * 1000;
        return d <= limit;
      }
      return true;
    });
  }, [schedules, filter]);

  const dueSoonCount = useMemo(() => {
    const limit = new Date().getTime() + 14 * 24 * 60 * 60 * 1000;
    return schedules.filter(
      (s) =>
        s.status === "pending" &&
        new Date(s.dueDate).getTime() <= limit,
    ).length;
  }, [schedules]);

  const handleUpdateStatus = (
    id: string,
    status: "pending" | "reminded" | "completed" | "cancelled",
  ) => {
    startTransition(async () => {
      const res = await updateScheduleStatusAction(id, status);
      if (res.success) {
        setSchedules((prev) =>
          prev.map((s) => (s.id === id ? { ...s, status } : s)),
        );
      }
    });
  };

  const getDaysDiffLabel = (dueDateStr: string) => {
    const due = new Date(dueDateStr).getTime();
    const now = new Date(today).getTime();
    const diffDays = Math.round((due - now) / (1000 * 60 * 60 * 24));

    if (diffDays < 0) {
      return { text: `Lewat ${Math.abs(diffDays)} hari`, color: "bg-red-50 text-red-700 border-red-200" };
    }
    if (diffDays === 0) {
      return { text: "Hari ini!", color: "bg-amber-50 text-amber-700 border-amber-200" };
    }
    if (diffDays <= 7) {
      return { text: `H-${diffDays} hari lagi`, color: "bg-amber-50 text-amber-700 border-amber-200" };
    }
    return { text: `${diffDays} hari lagi`, color: "bg-blue-50 text-blue-700 border-blue-200" };
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Header reminder & Attention Badge */}
      <div className="p-4 rounded-3xl bg-gradient-to-r from-brand-900 via-indigo-950 to-slate-900 text-white shadow-md flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-white/10 flex items-center justify-center text-amber-400 shrink-0">
            <Icon name="notification_important" className="text-[28px]" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="font-headline-2 text-headline-2 text-white">
                Auto Attention: Perawatan Berkala
              </h2>
              {dueSoonCount > 0 ? (
                <span className="px-2.5 py-0.5 rounded-full bg-amber-400 text-slate-950 font-bold text-xs">
                  {dueSoonCount} Perlu Diingatkan
                </span>
              ) : null}
            </div>
            <p className="text-xs text-white/70 mt-0.5">
              Jadwal otomatis perawatan 6 bulan &amp; 1 tahun kendaraan coating/detailing pelanggan.
            </p>
          </div>
        </div>

        {/* Tab filters */}
        <div className="flex bg-white/10 p-1 rounded-xl gap-1 shrink-0">
          <button
            type="button"
            onClick={() => setFilter("due_soon")}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${
              filter === "due_soon"
                ? "bg-white text-slate-900 shadow-sm"
                : "text-white/80 hover:bg-white/5"
            }`}
          >
            Jatuh Tempo ({dueSoonCount})
          </button>
          <button
            type="button"
            onClick={() => setFilter("reminded")}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${
              filter === "reminded"
                ? "bg-white text-slate-900 shadow-sm"
                : "text-white/80 hover:bg-white/5"
            }`}
          >
            Sudah Diingatkan
          </button>
          <button
            type="button"
            onClick={() => setFilter("all")}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${
              filter === "all"
                ? "bg-white text-slate-900 shadow-sm"
                : "text-white/80 hover:bg-white/5"
            }`}
          >
            Semua ({schedules.length})
          </button>
        </div>
      </div>

      {/* Schedules List */}
      {filtered.length === 0 ? (
        <div className="clay-card p-8 flex flex-col items-center justify-center text-center gap-2 text-text-secondary">
          <Icon name="event_available" className="text-[36px] text-text-muted" />
          <p className="font-body-bold text-body-bold">
            Tidak ada jadwal perawatan pada kategori ini
          </p>
          <p className="text-xs text-text-muted max-w-sm">
            Jadwal otomatis dibuat saat order berstatus selesai (completed) untuk layanan coating dan express polish.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {filtered.map((item) => {
            const diff = getDaysDiffLabel(item.dueDate);
            const is6M = item.scheduleType === "6_month";

            const waMsg =
              `Halo Kak *${item.customerName}*,\n\n` +
              `Mengingatkan kendaraan *${item.vehicleModel}* (${item.licensePlate}) sudah memasuki jadwal *perawatan berkala ${is6M ? "6 Bulan" : "1 Tahun / Tahunan"}* di RB AUTOLUXE.\n\n` +
              `Layanan perawatan ini mencakup peremajaan proteksi coating & pembersihan jamur agar cat tetap berkilau dan garansi tetap aktif.\n\n` +
              `Bisa kami bantu jadwalkan kedatangan kendaraannya minggu ini Kak? Terima kasih! 🙏`;

            return (
              <article
                key={item.id}
                className="clay-card p-4 flex flex-col justify-between gap-3 relative overflow-hidden"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="px-2.5 py-0.5 rounded-lg bg-surface-container font-mono font-bold text-xs text-text-primary">
                        {item.licensePlate}
                      </span>
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border ${
                          is6M
                            ? "bg-indigo-50 text-indigo-700 border-indigo-200"
                            : "bg-purple-50 text-purple-700 border-purple-200"
                        }`}
                      >
                        {is6M ? "Perawatan 6 Bulan" : "Perawatan 1 Tahun"}
                      </span>
                    </div>

                    <p className="font-body-bold text-body-bold text-text-primary mt-1 truncate">
                      {item.customerName} · {item.vehicleModel}
                    </p>
                    <p className="text-xs text-text-muted truncate">
                      {item.servicePackage}
                    </p>
                  </div>

                  <span
                    className={`px-2.5 py-1 rounded-xl text-xs font-bold border shrink-0 ${diff.color}`}
                  >
                    {diff.text}
                  </span>
                </div>

                <div className="p-2.5 rounded-xl bg-surface-container-low text-xs flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 text-text-secondary">
                    <Icon name="event" className="text-[16px] text-brand-600" />
                    <span>Jatuh Tempo: <strong>{formatDateWib(item.dueDate)}</strong></span>
                  </div>
                  <span
                    className={`font-micro-badge text-micro-badge px-2 py-0.5 rounded-full ${
                      item.status === "completed"
                        ? "bg-success-surface text-success-text"
                        : item.status === "reminded"
                        ? "bg-brand-50 text-brand-700"
                        : "bg-surface-container text-text-muted"
                    }`}
                  >
                    {item.status === "completed"
                      ? "Selesai"
                      : item.status === "reminded"
                      ? "Sudah Diingatkan"
                      : "Pending"}
                  </span>
                </div>

                {/* Action buttons */}
                <div className="flex items-center gap-2 pt-1 border-t border-outline-variant/40">
                  {item.customerPhone ? (
                    <a
                      href={whatsappLink(item.customerPhone, waMsg)}
                      target="_blank"
                      rel="noreferrer"
                      onClick={() => handleUpdateStatus(item.id, "reminded")}
                      className="flex-1 h-10 rounded-xl bg-whatsapp text-white font-body-bold text-caption flex items-center justify-center gap-1.5 active:scale-95 transition-transform shadow-sm"
                    >
                      <Icon name="chat" className="text-[18px]" />
                      <span>Ingatkan via WA</span>
                    </a>
                  ) : null}

                  <Link
                    href={`/invoice/${item.orderId}`}
                    className="h-10 px-3 rounded-xl bg-surface-container text-text-secondary font-body-bold text-caption flex items-center gap-1 active:scale-95 transition-transform"
                    title="Buka Invoice & Garansi A4"
                  >
                    <Icon name="receipt" className="text-[16px]" />
                    <span>Invoice</span>
                  </Link>

                  {item.status !== "completed" ? (
                    <button
                      type="button"
                      disabled={isPending}
                      onClick={() => handleUpdateStatus(item.id, "completed")}
                      className="h-10 px-3 rounded-xl bg-emerald-50 text-emerald-700 border border-emerald-200 font-body-bold text-caption flex items-center gap-1 active:scale-95 transition-transform"
                      title="Tandai Sudah Datang / Selesai Perawatan"
                    >
                      <Icon name="check" className="text-[16px]" />
                      <span>Selesai</span>
                    </button>
                  ) : null}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
