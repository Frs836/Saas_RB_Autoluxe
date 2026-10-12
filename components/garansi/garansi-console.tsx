"use client";

import { useMemo, useState } from "react";
import { formatDateWib } from "@/lib/format";

type Order = {
  id: string;
  orderNumber: string;
  customerName: string;
  vehiclePlate: string | null;
  totalPrice: number;
  completedAt: string | null;
};

type Warranty = {
  id: string;
  warrantyCode: string;
  startDate: string;
  endDate: string;
  status: string;
};

export function GaransiConsole({
  orders,
  warranties,
  canManage,
}: {
  orders: Order[];
  warranties: Warranty[];
  canManage: boolean;
}) {
  const [selectedOrderId, setSelectedOrderId] = useState<string>("");
  const [problem, setProblem] = useState("");
  const [loading] = useState(false);

  const selectedOrder = useMemo(
    () => orders.find((o) => o.id === selectedOrderId) || null,
    [orders, selectedOrderId],
  );

  return (
    <div className="min-h-screen bg-canvas">
      <div className="pb-[calc(68px+env(safe-area-inset-bottom)+24px)] px-gutter pt-4 space-y-space-lg">
        <section className="clay-card flex flex-col gap-space-md p-space-lg">
          <div className="flex items-center justify-between">
            <h2 className="font-headline-2 text-headline-2 text-text-primary">Klaim Garansi</h2>
            <span className="px-2 py-0.5 rounded-full bg-brand-50 text-brand-600 font-micro-badge text-micro-badge">Berdasarkan Order Completed</span>
          </div>

          <div className="flex flex-col gap-space-xs">
            <label className="font-caption text-caption text-text-secondary">Pilih Order (Completed)</label>
            <select
              value={selectedOrderId}
              onChange={(e) => setSelectedOrderId(e.target.value)}
              className="h-12 rounded-xl bg-surface px-3 font-body-regular text-body-regular text-text-primary shadow-[inset_0px_2px_4px_rgba(15,23,42,0.06)]"
            >
              <option value="">Pilih order...</option>
              {orders.map((order) => (
                <option key={order.id} value={order.id}>
                  {order.orderNumber} - {order.customerName}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-space-xs">
            <label className="font-caption text-caption text-text-secondary">Detail Keluhan</label>
            <textarea
              value={problem}
              onChange={(e) => setProblem(e.target.value)}
              placeholder="Deskripsikan kerusakan/keluhan pelanggan"
              rows={3}
              className="rounded-xl bg-surface px-3 py-2 font-body-regular text-body-regular text-text-primary shadow-[inset_0px_2px_4px_rgba(15,23,42,0.06)]"
            />
          </div>

          <button
            disabled={!canManage || !selectedOrder || !problem || loading}
            className="h-[50px] rounded-full bg-primary-gradient text-on-primary font-body-bold text-body-bold shadow-[0px_10px_22px_rgba(37,99,235,0.24)] disabled:opacity-60"
          >
            Ajukan Klaim Garansi
          </button>
        </section>

        <section className="clay-card flex flex-col gap-space-md p-space-lg">
          <div className="flex items-center justify-between">
            <h2 className="font-headline-2 text-headline-2 text-text-primary">Sertifikat Garansi Aktif</h2>
            <span className="font-caption text-caption text-text-muted">{warranties.length} item</span>
          </div>
          <div className="flex flex-col gap-space-sm">
            {warranties.length === 0 ? (
              <div className="py-8 text-center font-caption text-caption text-text-muted">
                Belum ada garansi terbit
              </div>
            ) : (
              warranties.map((w) => (
                <div key={w.id} className="flex flex-col gap-space-xs py-3 border-b border-border-subtle last:border-b-0">
                  <p className="font-body-bold text-body-bold text-text-primary">{w.warrantyCode}</p>
                  <div className="flex items-center justify-between font-caption text-caption text-text-muted">
                    <span>Mulai: {formatDateWib(w.startDate)}</span>
                    <span>Berakhir: {formatDateWib(w.endDate)}</span>
                  </div>
                  <span className="self-start px-2 py-0.5 rounded-full bg-success-surface text-success-text font-micro-badge text-micro-badge uppercase">
                    {w.status}
                  </span>
                </div>
              ))
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
