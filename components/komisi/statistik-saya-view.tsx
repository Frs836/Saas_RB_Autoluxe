"use client";

import { useState, useTransition } from "react";
import { createClient } from "@/lib/supabase/client";
import { formatRupiah, formatDateWib } from "@/lib/format";
import { Icon } from "@/components/ui/icon";
import Link from "next/link";

type OrderRow = {
  id: string;
  totalPrice: number;
  status: string;
  servicePackage: string;
  completedAt: string | null;
  createdAt: string;
  licensePlate: string | null;
  vehicleModel: string | null;
  isLead: boolean;
};

const STATUS_LABEL: Record<string, string> = {
  queued: "Antrean", in_progress: "Dikerjakan", qc_review: "QC",
  completed: "Selesai", menunggu_pembayaran: "Menunggu Bayar",
  menunggu_diambil: "Siap Diambil", diserahkan: "Diserahkan",
};

function parseLocalDate(s: string): Date {
  const [y,m,d] = s.split("-").map(Number);
  return new Date(y, m-1, d);
}
function formatDateInput(d: Date): string { return d.toISOString().slice(0,10); }

export function StatistikSayaView({
  orders: initialOrders,
  from,
  to,
  profileId,
}: {
  orders: OrderRow[];
  from: string;
  to: string;
  profileId: string;
}) {
  const [orders, setOrders] = useState<OrderRow[]>(initialOrders);
  const [fromDate, setFromDate] = useState(from);
  const [toDate,   setToDate]   = useState(to);
  const [pending, startTransition] = useTransition();

  function applyPreset(p: "bulan_ini"|"bulan_lalu"|"3bulan") {
    const now = new Date();
    let f: Date, t: Date;
    if (p === "bulan_ini")  { f = new Date(now.getFullYear(), now.getMonth(), 1); t = now; }
    else if (p === "bulan_lalu") { f = new Date(now.getFullYear(), now.getMonth()-1, 1); t = new Date(now.getFullYear(), now.getMonth(), 0); }
    else { f = new Date(now.getFullYear(), now.getMonth()-2, 1); t = now; }
    setFromDate(formatDateInput(f)); setToDate(formatDateInput(t));
    fetchOrders(formatDateInput(f), formatDateInput(t));
  }

  function fetchOrders(f: string, t: string) {
    startTransition(async () => {
      const supabase = createClient();
      const { data } = await supabase
        .from("order_team_members")
        .select("order_id, is_lead, orders!inner(id, total_price, status, service_package, completed_at, created_at, license_plate, vehicle_model)")
        .eq("profile_id", profileId)
        .gte("orders.created_at", `${f}T00:00:00.000Z`)
        .lte("orders.created_at", `${t}T23:59:59.999Z`);
      if (data) {
        setOrders((data as any[]).map((r) => {
          const o = r.orders;
          return { id: o.id, totalPrice: Number(o.total_price??0), status: o.status, servicePackage: o.service_package, completedAt: o.completed_at, createdAt: o.created_at, licensePlate: o.license_plate, vehicleModel: o.vehicle_model, isLead: r.is_lead };
        }));
      }
    });
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Filter */}
      <div className="clay-card p-4 flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h3 className="font-headline-2 text-headline-2 text-text-primary">Periode</h3>
          {pending && <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />}
        </div>
        <div className="flex gap-2 flex-wrap">
          {(["bulan_ini","bulan_lalu","3bulan"] as const).map((p) => (
            <button key={p} type="button" onClick={() => applyPreset(p)}
              className="px-3 h-9 rounded-full bg-surface-container-low text-text-secondary font-caption text-caption active:scale-95 transition-transform">
              {p === "bulan_ini" ? "Bulan Ini" : p === "bulan_lalu" ? "Bulan Lalu" : "3 Bulan"}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1">
            <span className="font-caption text-caption text-text-muted">Dari</span>
            <input type="date" value={fromDate} onChange={(e)=>{ setFromDate(e.target.value); fetchOrders(e.target.value,toDate); }}
              className="h-11 px-3 rounded-xl bg-surface-container-low font-body text-body text-text-primary outline-none" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-caption text-caption text-text-muted">Sampai</span>
            <input type="date" value={toDate} onChange={(e)=>{ setToDate(e.target.value); fetchOrders(fromDate,e.target.value); }}
              className="h-11 px-3 rounded-xl bg-surface-container-low font-body text-body text-text-primary outline-none" />
          </label>
        </div>
      </div>

      {/* Order list */}
      {orders.length === 0 ? (
        <div className="clay-card p-8 flex flex-col items-center text-center gap-2">
          <Icon name="inbox" className="text-[40px] text-text-muted" />
          <p className="font-body text-body text-text-secondary">Belum ada order pada periode ini.</p>
        </div>
      ) : (
        <>
          <p className="font-caption text-caption text-text-muted">{orders.length} order ditemukan</p>
          <div className="flex flex-col gap-3">
            {orders.map((o) => (
              <Link key={o.id} href={`/pos/orders/${o.id}`}
                className="clay-card p-4 flex flex-col gap-2 active:scale-[0.99] transition-transform">
                <div className="flex items-center justify-between gap-2">
                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-micro-badge text-micro-badge ${
                    o.isLead ? "bg-brand-50 text-brand-700" : "bg-surface-container text-text-secondary"
                  }`}>
                    <Icon name={o.isLead ? "star" : "groups"} className="text-[12px]" />
                    {o.isLead ? "Lead" : "Anggota"}
                  </span>
                  <span className="font-caption text-caption text-text-muted">
                    {STATUS_LABEL[o.status] ?? o.status}
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-surface-container flex items-center justify-center shrink-0">
                    <Icon name="directions_car" className="text-brand-600 text-[20px]" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-body-bold text-body-bold text-text-primary truncate">
                      {o.vehicleModel ?? "Kendaraan"}
                      {o.licensePlate ? ` • ${o.licensePlate}` : ""}
                    </p>
                    <p className="font-caption text-caption text-brand-600 truncate">{o.servicePackage}</p>
                  </div>
                  <p className="font-body-bold text-body-bold text-text-primary shrink-0">
                    {formatRupiah(o.totalPrice)}
                  </p>
                </div>
                <p className="font-caption text-caption text-text-muted">
                  {formatDateWib(o.createdAt)}
                </p>
              </Link>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
