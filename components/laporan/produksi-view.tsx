"use client";

import { useState } from "react";
import { Icon } from "@/components/ui/icon";

export type MaterialItem = {
  item_id: string;
  item_name: string;
  unit: string;
  quantity: number;
  unit_cost: number;
  cost_amount: number;
};

export type OrderCostRow = {
  order_id: string;
  order_number: string;
  license_plate: string;
  vehicle_model: string;
  vehicle_size: string;
  service_package: string;
  total_price: number;
  order_status: string;
  completed_at: string | null;
  order_created_at: string;
  branch_name: string;
  total_production_cost: number;
  materials: MaterialItem[];
};

export type MaterialTotalRow = {
  item_name: string;
  unit: string;
  total_qty: number;
  total_cost: number;
};

export type ProductionReportData = {
  summary: {
    total_production_cost: number;
    total_revenue: number;
    total_orders: number;
    total_gross_profit: number;
  };
  orders: OrderCostRow[];
  material_breakdown: MaterialTotalRow[];
};

function rupiah(num: number) {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(num);
}

export function ProduksiView({
  initialData,
  branchName,
}: {
  initialData: ProductionReportData | null;
  branchName: string;
}) {
  const [data] = useState<ProductionReportData | null>(initialData);
  const [expandedOrders, setExpandedOrders] = useState<Record<string, boolean>>({});
  const [exporting, setExporting] = useState(false);
  const [search, setSearch] = useState("");

  const summary = data?.summary ?? {
    total_production_cost: 0,
    total_revenue: 0,
    total_orders: 0,
    total_gross_profit: 0,
  };

  const marginPct =
    summary.total_revenue > 0
      ? Math.round((summary.total_gross_profit / summary.total_revenue) * 100)
      : 0;

  function toggleOrder(id: string) {
    setExpandedOrders((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  const filteredOrders = (data?.orders ?? []).filter((o) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      o.order_number?.toLowerCase().includes(q) ||
      o.license_plate?.toLowerCase().includes(q) ||
      o.service_package?.toLowerCase().includes(q) ||
      o.vehicle_size?.toLowerCase().includes(q)
    );
  });

  async function handleExportExcel() {
    setExporting(true);
    try {
      const XLSX = await import("xlsx");
      const wb = XLSX.utils.book_new();

      // Sheet 1: Ringkasan
      const summarySheet = [
        ["LAPORAN BIAYA PRODUKSI & PEMAKAIAN BAHAN — RB AUTOLUXE", ""],
        ["Cabang:", branchName],
        ["Tanggal Ekspor:", new Date().toLocaleDateString("id-ID")],
        [],
        ["Total Biaya Modal Bahan (HPP):", summary.total_production_cost],
        ["Total Omzet Terkait:", summary.total_revenue],
        ["Total Laba Kotor:", summary.total_gross_profit],
        ["Margin Kotor (%):", `${marginPct}%`],
        ["Jumlah Order Selesai:", summary.total_orders],
      ];
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summarySheet), "Ringkasan");

      // Sheet 2: Rincian per Order
      const orderHeaders = [
        "No Order",
        "Plat Nomor",
        "Model Kendaraan",
        "Ukuran",
        "Paket Jasa",
        "Omzet Jasa (Rp)",
        "Biaya Bahan (HPP Rp)",
        "Laba Kotor (Rp)",
        "Margin (%)",
        "Tanggal",
      ];
      const orderRows = (data?.orders ?? []).map((o) => {
        const margin = o.total_price - o.total_production_cost;
        const pct = o.total_price > 0 ? Math.round((margin / o.total_price) * 100) : 0;
        return [
          o.order_number,
          o.license_plate,
          o.vehicle_model,
          o.vehicle_size,
          o.service_package,
          o.total_price,
          o.total_production_cost,
          margin,
          `${pct}%`,
          new Date(o.order_created_at).toLocaleDateString("id-ID"),
        ];
      });
      XLSX.utils.book_append_sheet(
        wb,
        XLSX.utils.aoa_to_sheet([orderHeaders, ...orderRows]),
        "Order_dan_Biaya"
      );

      // Sheet 3: Rincian Pemakaian Bahan per Item
      const itemHeaders = [
        "No Order",
        "Plat Nomor",
        "Ukuran",
        "Paket Jasa",
        "Nama Bahan",
        "Jumlah Terpakai",
        "Satuan",
        "Harga Satuan (Rp)",
        "Total Biaya Bahan (Rp)",
      ];
      const itemRows: (string | number)[][] = [];
      (data?.orders ?? []).forEach((o) => {
        (o.materials ?? []).forEach((m) => {
          itemRows.push([
            o.order_number,
            o.license_plate,
            o.vehicle_size,
            o.service_package,
            m.item_name,
            m.quantity,
            m.unit,
            m.unit_cost,
            m.cost_amount,
          ]);
        });
      });
      XLSX.utils.book_append_sheet(
        wb,
        XLSX.utils.aoa_to_sheet([itemHeaders, ...itemRows]),
        "Rincian_Bahan_Order"
      );

      // Sheet 4: Akumulasi Bahan
      const matHeaders = ["Nama Bahan", "Satuan", "Total Pemakaian", "Total Biaya (Rp)"];
      const matRows = (data?.material_breakdown ?? []).map((m) => [
        m.item_name,
        m.unit,
        m.total_qty,
        m.total_cost,
      ]);
      XLSX.utils.book_append_sheet(
        wb,
        XLSX.utils.aoa_to_sheet([matHeaders, ...matRows]),
        "Akumulasi_Bahan"
      );

      XLSX.writeFile(
        wb,
        `Laporan_Biaya_Produksi_${new Date().toISOString().slice(0, 10)}.xlsx`
      );
    } catch (err) {
      console.error("Export excel error:", err);
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="flex-1 px-gutter pt-4 pb-nav-plain lg:pb-8 flex flex-col gap-4">
      {/* Header Info & Action */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="font-headline-2 text-headline-2 text-text-primary">
            Laporan Biaya Produksi (HPP Jasa)
          </h2>
          <p className="font-caption text-caption text-text-muted">
            Transparansi biaya modal bahan terpakai per ukuran mobil & laba kotor jasa.
          </p>
        </div>
        <button
          type="button"
          onClick={handleExportExcel}
          disabled={exporting}
          className="inline-flex items-center gap-1.5 min-h-11 px-4 rounded-full primary-gradient text-white font-body-bold text-caption active:scale-[0.98] transition-transform disabled:opacity-70 shadow-sm"
        >
          <Icon name="download" className="text-[18px]" />
          {exporting ? "Menyiapkan..." : "Ekspor Excel"}
        </button>
      </div>

      {/* Ringkasan Finansial Produksi */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="clay-card p-3.5 flex flex-col gap-1 border-l-4 border-l-danger-base">
          <span className="font-caption text-caption text-text-muted">Total Modal Bahan (HPP)</span>
          <span className="font-headline-2 text-headline-2 text-danger-text font-bold">
            {rupiah(summary.total_production_cost)}
          </span>
          <span className="font-micro-badge text-[10px] text-text-muted">
            Dari {summary.total_orders} unit kendaraan
          </span>
        </div>

        <div className="clay-card p-3.5 flex flex-col gap-1 border-l-4 border-l-brand-600">
          <span className="font-caption text-caption text-text-muted">Total Omzet Order</span>
          <span className="font-headline-2 text-headline-2 text-brand-700 font-bold">
            {rupiah(summary.total_revenue)}
          </span>
          <span className="font-micro-badge text-[10px] text-text-muted">Nilai jasa bruto</span>
        </div>

        <div className="clay-card p-3.5 flex flex-col gap-1 border-l-4 border-l-success-base">
          <span className="font-caption text-caption text-text-muted">Laba Kotor Jasa</span>
          <span className="font-headline-2 text-headline-2 text-success-text font-bold">
            {rupiah(summary.total_gross_profit)}
          </span>
          <span className="font-micro-badge text-[10px] text-success-text font-semibold">
            Margin {marginPct}%
          </span>
        </div>

        <div className="clay-card p-3.5 flex flex-col gap-1 border-l-4 border-l-warning-base">
          <span className="font-caption text-caption text-text-muted">Rata-rata Modal / Mobil</span>
          <span className="font-headline-2 text-headline-2 text-text-primary font-bold">
            {summary.total_orders > 0
              ? rupiah(Math.round(summary.total_production_cost / summary.total_orders))
              : "Rp 0"}
          </span>
          <span className="font-micro-badge text-[10px] text-text-muted">Per unit selesai</span>
        </div>
      </div>

      {/* Akumulasi Konsumsi Bahan Terbanyak */}
      {data?.material_breakdown && data.material_breakdown.length > 0 ? (
        <section className="bg-surface rounded-2xl p-4 clay-card border border-white/80 flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <Icon name="inventory_2" className="text-brand-600 text-[20px]" />
            <h3 className="font-headline-3 text-headline-3 text-text-primary">
              Akumulasi Bahan Produksi Terpakai
            </h3>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2.5">
            {data.material_breakdown.map((mat) => (
              <div
                key={mat.item_name}
                className="p-3 rounded-xl bg-surface-container-low border border-slate-100 flex flex-col gap-1"
              >
                <span className="font-body-bold text-caption text-text-primary truncate" title={mat.item_name}>
                  {mat.item_name}
                </span>
                <div className="flex items-baseline justify-between">
                  <span className="font-caption text-caption text-text-muted">
                    {mat.total_qty.toLocaleString("id-ID")} {mat.unit}
                  </span>
                  <span className="font-body-bold text-caption text-danger-text">
                    {rupiah(mat.total_cost)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {/* Riwayat Order & Rincian Bahan yang Dikeluarkan */}
      <section className="bg-surface rounded-2xl p-4 clay-card border border-white/80 flex flex-col gap-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Icon name="receipt_long" className="text-brand-600 text-[20px]" />
            <h3 className="font-headline-3 text-headline-3 text-text-primary">
              Riwayat Stok Keluar per Order (Biaya Bahan)
            </h3>
          </div>
          <div className="relative">
            <Icon name="search" className="absolute left-3 top-2.5 text-[18px] text-text-muted" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Cari order, plat, paket..."
              className="h-10 pl-9 pr-3 rounded-xl bg-surface-container-low font-body text-caption outline-none focus:ring-2 focus:ring-brand-400 w-full sm:w-60"
            />
          </div>
        </div>

        {filteredOrders.length === 0 ? (
          <div className="p-8 text-center text-text-muted flex flex-col items-center gap-2">
            <Icon name="search_off" className="text-[36px]" />
            <p className="font-body text-body">
              Belum ada data pemakaian bahan produksi pada periode ini.
            </p>
            <p className="font-caption text-caption text-text-muted">
              Biaya modal otomatis tercatat ketika order diselesaikan dan bahan resep terpotong.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-2.5">
            {filteredOrders.map((order) => {
              const isExpanded = expandedOrders[order.order_id];
              const margin = order.total_price - order.total_production_cost;
              const marginPercentage =
                order.total_price > 0
                  ? Math.round((margin / order.total_price) * 100)
                  : 0;

              return (
                <div
                  key={order.order_id}
                  className="rounded-2xl border border-slate-200/80 bg-surface p-3.5 transition-all shadow-sm hover:shadow"
                >
                  <div
                    className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 cursor-pointer select-none"
                    onClick={() => toggleOrder(order.order_id)}
                  >
                    <div className="flex items-start gap-3">
                      <div className="w-10 h-10 rounded-xl bg-brand-50 text-brand-600 flex items-center justify-center shrink-0 mt-0.5">
                        <Icon name="directions_car" className="text-[22px]" />
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-body-bold text-body-bold text-text-primary">
                            {order.license_plate}
                          </span>
                          <span className="font-micro-badge text-[10px] px-2 py-0.5 rounded-full bg-surface-container text-text-secondary">
                            {order.order_number}
                          </span>
                          <span className="font-micro-badge text-[10px] px-2 py-0.5 rounded-full bg-brand-50 text-brand-700 font-bold">
                            Size {order.vehicle_size}
                          </span>
                        </div>
                        <p className="font-caption text-caption text-text-muted mt-0.5">
                          {order.service_package} {order.vehicle_model ? `· ${order.vehicle_model}` : ""}
                        </p>
                        <p className="font-micro-badge text-[10px] text-text-muted">
                          {new Date(order.order_created_at).toLocaleString("id-ID", {
                            timeZone: "Asia/Jakarta",
                            dateStyle: "medium",
                            timeStyle: "short",
                          })}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center justify-between sm:justify-end gap-4 border-t sm:border-t-0 pt-2 sm:pt-0">
                      <div className="text-right">
                        <div className="font-caption text-caption text-text-muted">Biaya Modal Bahan</div>
                        <div className="font-headline-3 text-headline-3 text-danger-text font-bold">
                          {rupiah(order.total_production_cost)}
                        </div>
                        <div className="font-micro-badge text-[10px] text-success-text font-semibold">
                          Margin: {rupiah(margin)} ({marginPercentage}%)
                        </div>
                      </div>
                      <button
                        type="button"
                        aria-label="Rincian bahan"
                        className="w-8 h-8 rounded-full bg-surface-container-low flex items-center justify-center text-text-secondary"
                      >
                        <Icon
                          name={isExpanded ? "expand_less" : "expand_more"}
                          className="text-[20px]"
                        />
                      </button>
                    </div>
                  </div>

                  {/* Rincian Bahan yang Dikonsumsi */}
                  {isExpanded ? (
                    <div className="mt-3 pt-3 border-t border-slate-100 flex flex-col gap-2">
                      <div className="flex items-center justify-between text-caption font-semibold text-text-secondary">
                        <span>Rincian Bahan Terpakai:</span>
                        <span>{order.materials?.length ?? 0} jenis bahan</span>
                      </div>
                      <div className="overflow-x-auto">
                        <table className="w-full text-left text-xs">
                          <thead>
                            <tr className="border-b border-slate-100 text-text-muted">
                              <th className="py-1.5 font-normal">Nama Bahan</th>
                              <th className="py-1.5 font-normal text-center">Pemakaian</th>
                              <th className="py-1.5 font-normal text-right">Biaya Satuan</th>
                              <th className="py-1.5 font-normal text-right">Total Biaya</th>
                            </tr>
                          </thead>
                          <tbody>
                            {(order.materials ?? []).map((m, idx) => (
                              <tr key={idx} className="border-b border-slate-50">
                                <td className="py-1.5 font-medium text-text-primary">{m.item_name}</td>
                                <td className="py-1.5 text-center text-text-secondary">
                                  {m.quantity} {m.unit}
                                </td>
                                <td className="py-1.5 text-right text-text-muted">
                                  {rupiah(m.unit_cost)} / {m.unit}
                                </td>
                                <td className="py-1.5 text-right font-semibold text-danger-text">
                                  {rupiah(m.cost_amount)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
