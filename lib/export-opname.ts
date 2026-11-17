import * as XLSX from "xlsx";
import { formatAngka } from "@/lib/pos";

function getMonthName(monthNumber: number): string {
  const names = [
    "Januari", "Februari", "Maret", "April", "Mei", "Juni",
    "Juli", "Agustus", "September", "Oktober", "November", "Desember",
  ];
  return names[monthNumber - 1] ?? String(monthNumber);
}

export function formatPeriodIndo(periodString: string): string {
  // periodString: "2026-11" atau "2026-11-01"
  const clean = periodString.slice(0, 7);
  const [year, month] = clean.split("-");
  return `${getMonthName(Number(month))} ${year}`;
}

export type InventoryOpnameExportItem = {
  item_name: string;
  unit: string;
  purchase_unit?: string | null;
  purchase_content_qty?: number | null;
  system_qty: number;
  physical_qty: number | null;
  difference: number | null;
  unit_cost?: number | null;
  note?: string | null;
};

export function exportInventoryOpnameToExcel({
  branchName,
  periodMonth,
  status,
  items,
}: {
  branchName: string;
  periodMonth: string;
  status: string;
  items: InventoryOpnameExportItem[];
}) {
  const periodLabel = formatPeriodIndo(periodMonth);
  const statusLabel =
    status === "submitted" ? "Selesai (Dikirim)" : status === "draft" ? "Draf (Dalam Proses)" : "Dibatalkan";
  const printDate = new Intl.DateTimeFormat("id-ID", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Jakarta",
  }).format(new Date());

  const data: (string | number)[][] = [
    ["LAPORAN STOK OPNAME FISIK BULANAN (BAHAN BAKU & INVENTARIS GUDANG)"],
    ["RB AUTOLUXE — AUTOMOTIVE DETAILING MANAGEMENT SYSTEM"],
    [],
    ["Cabang", `: ${branchName}`],
    ["Periode Opname", `: ${periodLabel}`],
    ["Status Rekonsiliasi", `: ${statusLabel}`],
    ["Tanggal Export", `: ${printDate} WIB`],
    [],
    [
      "No",
      "Nama Bahan / Barang",
      "Kemasan Beli",
      "Satuan Pakai",
      "Stok Sistem",
      "Hitung Fisik Riil",
      "Selisih Qty",
      "HPP per Satuan (Rp)",
      "Total Nilai Selisih (Rp)",
      "Alasan / Catatan Selisih",
    ],
  ];

  let totalSelisihRp = 0;

  items.forEach((item, idx) => {
    const diff = item.difference !== null ? item.difference : (item.physical_qty !== null ? item.physical_qty - item.system_qty : 0);
    const cost = item.unit_cost ?? 0;
    const diffValRp = diff * cost;
    totalSelisihRp += diffValRp;

    const kemasan = item.purchase_unit
      ? `${item.purchase_unit} @ ${formatAngka(Number(item.purchase_content_qty || 1))} ${item.unit}`
      : "-";

    data.push([
      idx + 1,
      item.item_name,
      kemasan,
      item.unit,
      item.system_qty,
      item.physical_qty !== null ? item.physical_qty : "-",
      diff !== 0 ? (diff > 0 ? `+${diff}` : diff) : 0,
      cost,
      diffValRp,
      item.note ?? "-",
    ]);
  });

  data.push([]);
  data.push([
    "TOTAL",
    "",
    "",
    "",
    "",
    "",
    "",
    "Total Nilai Selisih (Rp):",
    totalSelisihRp,
    "",
  ]);

  const ws = XLSX.utils.aoa_to_sheet(data);

  // Atur lebar kolom
  ws["!cols"] = [
    { wch: 5 },  // No
    { wch: 32 }, // Nama Bahan
    { wch: 20 }, // Kemasan
    { wch: 14 }, // Satuan
    { wch: 14 }, // Stok Sistem
    { wch: 16 }, // Hitung Fisik
    { wch: 14 }, // Selisih Qty
    { wch: 18 }, // HPP
    { wch: 22 }, // Nilai Selisih
    { wch: 35 }, // Catatan
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Stok Opname");

  const filename = `Stok Opname ${periodLabel} - ${branchName}.xlsx`;
  XLSX.writeFile(wb, filename);
}

export type BundleOpnameExportItem = {
  bundle_name: string;
  unit: string;
  output_qty: number;
  formula_preview?: string | null;
  system_qty: number;
  physical_qty: number | null;
  difference: number | null;
  hpp_per_unit?: number | null;
  total_batch_cost?: number | null;
  note?: string | null;
};

export function exportBundleOpnameToExcel({
  branchName,
  periodMonth,
  status,
  items,
}: {
  branchName: string;
  periodMonth: string;
  status: string;
  items: BundleOpnameExportItem[];
}) {
  const periodLabel = formatPeriodIndo(periodMonth);
  const statusLabel =
    status === "submitted" ? "Selesai (Dikirim)" : status === "draft" ? "Draf (Dalam Proses)" : "Dibatalkan";
  const printDate = new Intl.DateTimeFormat("id-ID", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Jakarta",
  }).format(new Date());

  const data: (string | number)[][] = [
    ["LAPORAN STOK OPNAME FISIK BULANAN (BAHAN RACIKAN BENGKEL)"],
    ["RB AUTOLUXE — AUTOMOTIVE DETAILING MANAGEMENT SYSTEM"],
    [],
    ["Cabang", `: ${branchName}`],
    ["Periode Opname", `: ${periodLabel}`],
    ["Status Rekonsiliasi", `: ${statusLabel}`],
    ["Tanggal Export", `: ${printDate} WIB`],
    [],
    [
      "No",
      "Nama Racikan",
      "Satuan Output",
      "Hasil 1x Racik",
      "Komposisi Formula Bahan",
      "Stok Sistem",
      "Hitung Fisik Riil",
      "Selisih Qty",
      "HPP per Satuan (Rp)",
      "Total Nilai Selisih (Rp)",
      "Alasan / Catatan Selisih",
    ],
  ];

  let totalSelisihRp = 0;

  items.forEach((item, idx) => {
    const diff = item.difference !== null ? item.difference : (item.physical_qty !== null ? item.physical_qty - item.system_qty : 0);
    const cost = item.hpp_per_unit ?? 0;
    const diffValRp = diff * cost;
    totalSelisihRp += diffValRp;

    data.push([
      idx + 1,
      item.bundle_name,
      item.unit.toUpperCase(),
      `${formatAngka(item.output_qty)} ${item.unit}`,
      item.formula_preview ?? "-",
      item.system_qty,
      item.physical_qty !== null ? item.physical_qty : "-",
      diff !== 0 ? (diff > 0 ? `+${diff}` : diff) : 0,
      cost,
      diffValRp,
      item.note ?? "-",
    ]);
  });

  data.push([]);
  data.push([
    "TOTAL",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "Total Nilai Selisih (Rp):",
    totalSelisihRp,
    "",
  ]);

  const ws = XLSX.utils.aoa_to_sheet(data);

  // Atur lebar kolom
  ws["!cols"] = [
    { wch: 5 },  // No
    { wch: 30 }, // Nama Racikan
    { wch: 14 }, // Satuan Output
    { wch: 16 }, // Hasil 1x Racik
    { wch: 38 }, // Komposisi Formula
    { wch: 14 }, // Stok Sistem
    { wch: 16 }, // Hitung Fisik
    { wch: 14 }, // Selisih Qty
    { wch: 18 }, // HPP per Satuan
    { wch: 22 }, // Nilai Selisih
    { wch: 35 }, // Catatan
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Opname Racikan");

  const filename = `Stok Opname Racikan ${periodLabel} - ${branchName}.xlsx`;
  XLSX.writeFile(wb, filename);
}
