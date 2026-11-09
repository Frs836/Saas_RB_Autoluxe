"use client";

import { useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Icon } from "@/components/ui/icon";
import { formatRupiah } from "@/lib/format";
import { useRouter } from "next/navigation";

type ImportType = "inventory" | "cash_flow";

type ImportResult = {
  imported: number;
  skipped: number;
  errors: { item?: string; row?: unknown; error: string }[];
};

const TEMPLATES: Record<ImportType, {
  label: string; icon: string; color: string;
  headers: string[]; example: (string | number)[][];
  description: string;
}> = {
  inventory: {
    label: "Stok & Inventaris",
    icon: "inventory_2",
    color: "bg-orange-50 text-orange-700",
    description: "Import item stok baru atau update stok yang sudah ada. Jika nama item + cabang sudah ada, stok akan di-update.",
    headers: ["item_name", "unit", "current_stock", "min_stock_alert", "unit_cost"],
    example: [
      ["Nano Ceramic 10H", "botol", 10, 2, 150000],
      ["Microfiber Towel", "pcs",   50, 10, 25000],
      ["Shampoo Carwash",  "liter", 20, 5,  35000],
    ],
  },
  cash_flow: {
    label: "Kas Historis",
    icon: "payments",
    color: "bg-success-surface text-success-text",
    description: "Import data kas masuk/keluar historis. Kolom type: 'in' atau 'out'. payment_method: cash/qris/bank_transfer.",
    headers: ["type", "amount", "category", "description", "payment_method", "created_at"],
    example: [
      ["in",  500000, "pos_order",         "Order RBA-001 lunas",    "cash",          "2026-10-01"],
      ["out", 150000, "Perlengkapan Wash",  "Beli shampoo carwash",  "bank_transfer", "2026-10-02"],
      ["in",  250000, "pos_order",         "Order RBA-002 lunas",    "qris",          "2026-10-03"],
    ],
  },
};

export function BulkImportConsole({
  branchId,
  branches,
}: {
  branchId: string | null;
  branches: { id: string; name: string }[];
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);

  const [activeType, setActiveType] = useState<ImportType>("inventory");
  const [selectedBranch, setSelectedBranch] = useState(branchId ?? branches[0]?.id ?? "");
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [fileName, setFileName] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const tmpl = TEMPLATES[activeType];

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setResult(null);
    setError(null);
    setRows([]);

    const XLSX = await import("xlsx");
    const buf  = await file.arrayBuffer();
    const wb   = XLSX.read(buf, { type: "array", cellDates: true });
    const ws   = wb.Sheets[wb.SheetNames[0]];
    const raw  = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "" });

    if (!raw.length) { setError("File kosong atau format tidak dikenali."); return; }
    setRows(raw.slice(0, 500)); // max 500 baris
  }

  async function downloadTemplate() {
    const XLSX = await import("xlsx");
    const wb   = XLSX.utils.book_new();
    const data = [tmpl.headers, ...tmpl.example];
    const ws   = XLSX.utils.aoa_to_sheet(data);
    ws["!cols"] = tmpl.headers.map(() => ({ wch: 20 }));
    XLSX.utils.book_append_sheet(wb, ws, "Data");

    // Sheet petunjuk
    const guide = [
      [`Template ${tmpl.label}`],
      [tmpl.description],
      [],
      ...tmpl.headers.map((h) => [h, ""]),
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(guide), "Petunjuk");
    XLSX.writeFile(wb, `template_${activeType}.xlsx`);
  }

  async function handleImport() {
    if (!rows.length) { setError("Belum ada data. Upload file Excel terlebih dahulu."); return; }
    if (!selectedBranch) { setError("Pilih cabang tujuan."); return; }
    setLoading(true);
    setError(null);
    setResult(null);

    const supabase = createClient();
    try {
      let res: { data: ImportResult | null; error: { message: string } | null };

      if (activeType === "inventory") {
        res = await (supabase as any).rpc("bulk_import_inventory", {
          p_items: rows,
          p_branch_id: selectedBranch,
        });
      } else {
        res = await (supabase as any).rpc("bulk_import_cash_flow", {
          p_rows: rows,
          p_branch_id: selectedBranch,
        });
      }

      if (res.error) { setError(res.error.message); return; }
      setResult(res.data!);
      setRows([]);
      setFileName(null);
      if (fileRef.current) fileRef.current.value = "";
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="px-gutter py-4 flex flex-col gap-4">
      {/* Jenis import */}
      <div className="clay-card p-4 flex flex-col gap-3">
        <h2 className="font-headline-2 text-headline-2 text-text-primary">Jenis Data</h2>
        <div className="grid grid-cols-2 gap-2">
          {(Object.keys(TEMPLATES) as ImportType[]).map((t) => {
            const tmplItem = TEMPLATES[t];
            return (
              <button key={t} type="button" onClick={() => { setActiveType(t); setRows([]); setFileName(null); setResult(null); setError(null); }}
                className={`p-3 rounded-xl flex flex-col items-center gap-2 active:scale-95 transition-transform border-2 ${
                  activeType === t ? "border-brand-400 bg-brand-50" : "border-transparent bg-surface-container-low"
                }`}>
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${tmplItem.color}`}>
                  <Icon name={tmplItem.icon} className="text-[20px]" />
                </div>
                <span className="font-caption text-caption text-text-primary text-center leading-tight">{tmplItem.label}</span>
              </button>
            );
          })}
        </div>
        <p className="font-caption text-caption text-text-muted leading-relaxed">{tmpl.description}</p>
      </div>

      {/* Pilih cabang */}
      {branches.length > 1 && (
        <div className="clay-card p-4 flex flex-col gap-2">
          <label className="font-caption text-caption text-text-secondary">Cabang Tujuan</label>
          <select value={selectedBranch} onChange={(e) => setSelectedBranch(e.target.value)}
            className="h-11 px-3 rounded-xl bg-surface-container-low font-body text-body text-text-primary outline-none focus:ring-2 focus:ring-brand-400">
            {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </div>
      )}

      {/* Download template */}
      <button type="button" onClick={downloadTemplate}
        className="flex items-center justify-center gap-2 py-3 rounded-xl bg-surface-container-low text-text-secondary font-caption text-caption active:scale-95 transition-transform">
        <Icon name="download" className="text-[18px]" />
        Download Template Excel ({activeType === "inventory" ? "Stok" : "Kas"})
      </button>

      {/* Upload file */}
      <div className="clay-card p-4 flex flex-col gap-3">
        <h3 className="font-body-bold text-body-bold text-text-primary">Upload File Excel</h3>
        <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv"
          onChange={handleFile}
          className="block w-full text-sm text-text-secondary file:mr-3 file:py-2 file:px-4 file:rounded-xl file:border-0 file:bg-brand-50 file:text-brand-700 file:font-caption file:cursor-pointer" />
        {fileName && (
          <div className="flex items-center gap-2 p-3 rounded-xl bg-success-surface text-success-text">
            <Icon name="check_circle" className="text-[18px] shrink-0" />
            <div className="min-w-0">
              <p className="font-caption text-caption font-semibold truncate">{fileName}</p>
              <p className="font-micro-badge text-micro-badge">{rows.length} baris siap diimport</p>
            </div>
          </div>
        )}
      </div>

      {/* Preview */}
      {rows.length > 0 && (
        <div className="clay-card p-4 flex flex-col gap-2">
          <p className="font-body-bold text-body-bold text-text-primary">Preview (5 baris pertama)</p>
          <div className="overflow-x-auto -mx-1">
            <table className="w-full text-left">
              <thead>
                <tr>
                  {Object.keys(rows[0]).slice(0, 6).map((k) => (
                    <th key={k} className="px-2 py-1.5 font-micro-badge text-micro-badge text-text-muted whitespace-nowrap">{k}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 5).map((row, i) => (
                  <tr key={i} className="border-t border-outline-variant/40">
                    {Object.values(row).slice(0, 6).map((v, j) => (
                      <td key={j} className="px-2 py-1.5 font-caption text-caption text-text-primary whitespace-nowrap max-w-[120px] truncate">
                        {String(v)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {error && (
        <div className="p-3 rounded-xl bg-danger-surface text-danger-text font-caption text-caption flex items-center gap-2">
          <Icon name="error" className="text-[18px] shrink-0" />{error}
        </div>
      )}

      {/* Result */}
      {result && (
        <div className={`p-4 rounded-xl ${result.errors.length > 0 ? "bg-warning-surface" : "bg-success-surface"}`}>
          <p className={`font-body-bold text-body-bold ${result.errors.length > 0 ? "text-warning-text" : "text-success-text"}`}>
            ✓ {result.imported} baris berhasil diimport
            {result.skipped > 0 ? `, ${result.skipped} dilewati` : ""}
          </p>
          {result.errors.slice(0, 3).map((e, i) => (
            <p key={i} className="font-caption text-caption text-warning-text mt-1">
              • {e.item ?? "Baris"}: {e.error}
            </p>
          ))}
        </div>
      )}

      {/* Import button */}
      <button type="button" onClick={handleImport} disabled={loading || !rows.length}
        className="w-full py-4 rounded-2xl bg-primary text-white font-body-bold text-body-bold flex items-center justify-center gap-2 active:scale-95 transition-transform disabled:opacity-60">
        {loading ? <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <Icon name="upload" className="text-[22px]" />}
        {loading ? "Mengimport..." : `Import ${tmpl.label}`}
      </button>
    </div>
  );
}
