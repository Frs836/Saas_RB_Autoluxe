"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/ui/icon";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/toast";
import {
  maintainerWipeStockAction,
  maintainerWipeAttendanceAction,
  maintainerWipeOrdersAction,
  maintainerWipeFinanceAction,
  maintainerWipeLogsAction,
  maintainerMasterWipeAction,
  maintainerPingBenchmarkAction,
  type BenchmarkResult,
} from "@/app/actions/maintenance";
import { formatAngka } from "@/lib/pos";

type BranchOption = {
  id: string;
  name: string;
};

type ConfirmationConfig = {
  title: string;
  description: string;
  requiredKeyword: string;
  badgeLabel: string;
  isMaster?: boolean;
  onConfirm: () => Promise<void>;
};

export function MaintenanceView({
  branches,
  initialBenchmark,
  currentBranchId,
}: {
  branches: BranchOption[];
  initialBenchmark: BenchmarkResult | null;
  currentBranchId: string | null;
}) {
  const router = useRouter();
  const toast = useToast();

  const [selectedBranchId, setSelectedBranchId] = useState<string>(currentBranchId || "all");
  const [benchmark, setBenchmark] = useState<BenchmarkResult | null>(initialBenchmark);
  const [clientRoundtripMs, setClientRoundtripMs] = useState<number | null>(null);
  const [isBenchmarking, setIsBenchmarking] = useState(false);
  const [benchmarkLogs, setBenchmarkLogs] = useState<
    Array<{ time: string; roundtrip: number; dbDuration: number; status: string }>
  >([]);

  // Modal Confirmation State
  const [confirmModal, setConfirmModal] = useState<ConfirmationConfig | null>(null);
  const [typedKeyword, setTypedKeyword] = useState("");
  const [pendingAction, startTransition] = useTransition();

  // Master reset option: also delete master inventory items?
  const [masterDeleteItems, setMasterDeleteItems] = useState(false);
  // Stock reset option: delete master items?
  const [stockDeleteMaster, setStockDeleteMaster] = useState(false);

  const targetBranch = branches.find((b) => b.id === selectedBranchId);
  const targetScopeLabel = selectedBranchId === "all" ? "Seluruh Cabang (Semua)" : targetBranch?.name ?? "Cabang Terpilih";

  // --- Speed & Latency Benchmark Runner ---
  async function runSpeedTest() {
    setIsBenchmarking(true);
    const startClient = performance.now();

    const branchParam = selectedBranchId === "all" ? null : selectedBranchId;
    const res = await maintainerPingBenchmarkAction(branchParam);
    const endClient = performance.now();
    const roundtrip = Math.round((endClient - startClient) * 100) / 100;

    setIsBenchmarking(false);

    if (res.ok) {
      setBenchmark(res.data);
      setClientRoundtripMs(roundtrip);

      const statusDesc =
        roundtrip < 150 ? "Optimal (Cepat)" : roundtrip < 350 ? "Stabil (Normal)" : "Tinggi (Lagging)";

      setBenchmarkLogs((prev) => [
        {
          time: new Date().toLocaleTimeString("id-ID"),
          roundtrip,
          dbDuration: res.data.server_to_db_latency_ms,
          status: statusDesc,
        },
        ...prev.slice(0, 9),
      ]);

      toast.sukses("Benchmark Berhasil", `Roundtrip: ${roundtrip}ms | Server-to-DB: ${res.data.server_to_db_latency_ms}ms`);
    } else {
      toast.gagal("Benchmark Gagal", res.message);
    }
  }

  // --- Handlers for Wiping ---
  function openConfirm(config: ConfirmationConfig) {
    setTypedKeyword("");
    setConfirmModal(config);
  }

  function handleExecuteWipe() {
    if (!confirmModal) return;
    if (typedKeyword.trim().toUpperCase() !== confirmModal.requiredKeyword.toUpperCase()) {
      toast.gagal("Konfirmasi Salah", `Ketik kata "${confirmModal.requiredKeyword}" dengan tepat.`);
      return;
    }

    startTransition(async () => {
      try {
        await confirmModal.onConfirm();
        setConfirmModal(null);
        setTypedKeyword("");
        // Otomatis refresh benchmark setelah pembersihan
        void runSpeedTest();
        router.refresh();
      } catch (err: any) {
        toast.gagal("Gagal Eksekusi", err.message || "Terjadi kesalahan");
      }
    });
  }

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto flex flex-col gap-6 w-full">
      {/* ─── Header & Scope Selector ─── */}
      <section className="clay-card p-5 sm:p-6 flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between border-l-4 border-l-brand-600">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <span className="px-2.5 py-0.5 rounded-full bg-brand-50 text-brand-700 font-micro-badge text-micro-badge font-bold uppercase tracking-wider">
              Khusus Maintainer & Owner
            </span>
            <span className="px-2.5 py-0.5 rounded-full bg-surface-container text-text-secondary font-micro-badge text-micro-badge">
              Checkpoint & Renewal Hub
            </span>
          </div>
          <h1 className="font-headline-2 text-headline-2 text-text-primary">
            Pusat Pemeliharaan & Reset Data
          </h1>
          <p className="font-caption text-caption text-text-secondary max-w-xl">
            Alat bantu khusus pengujian sistem: hapus data operasional testing per fitur atau seluruh cabang tanpa menghapus akun login dan pengaturan utama.
          </p>
        </div>

        {/* Branch Scope Dropdown */}
        <div className="flex flex-col gap-1 w-full sm:w-auto min-w-[220px]">
          <label className="font-label text-label text-text-muted">
            Target Cakupan Cabang:
          </label>
          <select
            value={selectedBranchId}
            onChange={(e) => setSelectedBranchId(e.target.value)}
            className="h-11 px-3 rounded-xl bg-surface-container-low border border-outline-variant font-body text-body text-text-primary outline-none focus:ring-2 focus:ring-brand-400"
          >
            <option value="all">🌐 Seluruh Cabang (Full System)</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                📍 {b.name}
              </option>
            ))}
          </select>
        </div>
      </section>

      {/* ─── Speed & Database Performance Diagnostic Box ─── */}
      <section className="clay-card p-5 sm:p-6 flex flex-col gap-4 bg-surface-container-low/40 border border-outline-variant/60">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-xl bg-brand-50 text-brand-600 flex items-center justify-center shrink-0">
              <Icon name="speed" className="text-[22px]" />
            </div>
            <div>
              <h2 className="font-body-bold text-body-bold text-text-primary flex items-center gap-2">
                Diagnostik Kecepatan & Latensi Sistem
                <span className="px-2 py-0.2 rounded-full text-[10px] font-bold bg-success-surface text-success-text">
                  Live Speed Test
                </span>
              </h2>
              <p className="font-caption text-caption text-text-muted">
                Uji jumping/lag roundtrip dari client browser ke server Vercel dan Supabase PostgreSQL.
              </p>
            </div>
          </div>

          <button
            type="button"
            disabled={isBenchmarking}
            onClick={runSpeedTest}
            className="w-full sm:w-auto h-11 px-5 rounded-xl primary-gradient text-on-primary font-body-bold text-body-bold flex items-center justify-center gap-2 active:scale-95 transition-transform disabled:opacity-60 shadow-sm"
          >
            <Icon name={isBenchmarking ? "hourglass_top" : "refresh"} className="text-[18px]" />
            {isBenchmarking ? "Menguji Latensi..." : "Uji Kecepatan Sekarang"}
          </button>
        </div>

        {/* Speed Cards Metrics */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {/* Card 1: Total Roundtrip */}
          <div className="p-4 rounded-2xl bg-surface border border-outline-variant/60 flex flex-col justify-between shadow-2xs">
            <div className="flex items-center justify-between text-text-muted font-caption text-caption">
              <span>Browser ➔ Server Roundtrip</span>
              <Icon name="dns" className="text-[16px]" />
            </div>
            <div className="flex items-baseline gap-1 mt-2">
              <span
                className={`font-headline-1 text-headline-1 font-bold ${
                  clientRoundtripMs === null
                    ? "text-text-muted"
                    : clientRoundtripMs < 150
                    ? "text-success-text"
                    : clientRoundtripMs < 350
                    ? "text-warning-text"
                    : "text-danger-text"
                }`}
              >
                {clientRoundtripMs !== null ? `${clientRoundtripMs}` : "---"}
              </span>
              <span className="font-caption text-caption text-text-secondary font-bold">ms</span>
            </div>
            <div className="mt-1 text-[11px] text-text-muted">
              {clientRoundtripMs === null
                ? "Klik uji kecepatan untuk mulai"
                : clientRoundtripMs < 150
                ? "🟢 Sangat Cepat & Responsif"
                : clientRoundtripMs < 350
                ? "🟡 Normal & Stabil"
                : "🔴 Ada Indikasi Lag Jaringan"}
            </div>
          </div>

          {/* Card 2: Server to Database Latency */}
          <div className="p-4 rounded-2xl bg-surface border border-outline-variant/60 flex flex-col justify-between shadow-2xs">
            <div className="flex items-center justify-between text-text-muted font-caption text-caption">
              <span>Server ➔ Database Supabase</span>
              <Icon name="database" className="text-[16px]" />
            </div>
            <div className="flex items-baseline gap-1 mt-2">
              <span
                className={`font-headline-1 text-headline-1 font-bold ${
                  !benchmark
                    ? "text-text-muted"
                    : benchmark.server_to_db_latency_ms < 100
                    ? "text-success-text"
                    : benchmark.server_to_db_latency_ms < 250
                    ? "text-warning-text"
                    : "text-danger-text"
                }`}
              >
                {benchmark ? `${benchmark.server_to_db_latency_ms}` : "---"}
              </span>
              <span className="font-caption text-caption text-text-secondary font-bold">ms</span>
            </div>
            <div className="mt-1 text-[11px] text-text-muted">
              Internal Query: {benchmark ? `${benchmark.db_internal_query_ms} ms` : "---"}
            </div>
          </div>

          {/* Card 3: Node Environment & Status */}
          <div className="p-4 rounded-2xl bg-surface border border-outline-variant/60 flex flex-col justify-between shadow-2xs">
            <div className="flex items-center justify-between text-text-muted font-caption text-caption">
              <span>Status Koneksi Node & DB</span>
              <Icon name="check_circle" className="text-[16px] text-success-base" />
            </div>
            <div className="flex items-center gap-2 mt-2">
              <span className="font-headline-3 text-headline-3 font-bold text-text-primary uppercase">
                {benchmark?.status ?? "ONLINE"}
              </span>
            </div>
            <div className="mt-1 text-[11px] text-text-muted truncate">
              Node {benchmark?.node_version ?? process.version} | Next.js 16.4.6
            </div>
          </div>
        </div>

        {/* Database Record Live Counters */}
        {benchmark && (
          <div className="p-3.5 rounded-2xl bg-surface-container border border-outline-variant/40 flex flex-col gap-2">
            <span className="text-[11px] font-bold text-text-muted uppercase tracking-wider">
              Jumlah Data Tersimpan Saat Ini ({targetScopeLabel}):
            </span>
            <div className="grid grid-cols-2 sm:grid-cols-6 gap-2 text-center text-xs">
              <div className="p-2 rounded-xl bg-surface">
                <span className="text-text-muted block text-[10px]">Item Stok</span>
                <span className="font-bold text-text-primary text-sm">{formatAngka(benchmark.counts.inventory_items)}</span>
              </div>
              <div className="p-2 rounded-xl bg-surface">
                <span className="text-text-muted block text-[10px]">Resep Racikan</span>
                <span className="font-bold text-text-primary text-sm">{formatAngka(benchmark.counts.bundle_items)}</span>
              </div>
              <div className="p-2 rounded-xl bg-surface">
                <span className="text-text-muted block text-[10px]">Transaksi Order</span>
                <span className="font-bold text-text-primary text-sm">{formatAngka(benchmark.counts.orders)}</span>
              </div>
              <div className="p-2 rounded-xl bg-surface">
                <span className="text-text-muted block text-[10px]">Log Absensi</span>
                <span className="font-bold text-text-primary text-sm">{formatAngka(benchmark.counts.attendances)}</span>
              </div>
              <div className="p-2 rounded-xl bg-surface">
                <span className="text-text-muted block text-[10px]">Mutasi Kas</span>
                <span className="font-bold text-text-primary text-sm">{formatAngka(benchmark.counts.cash_flow)}</span>
              </div>
              <div className="p-2 rounded-xl bg-surface">
                <span className="text-text-muted block text-[10px]">Akun Staf</span>
                <span className="font-bold text-text-primary text-sm">{formatAngka(benchmark.counts.profiles)}</span>
              </div>
            </div>
          </div>
        )}

        {/* Benchmark Test History Log */}
        {benchmarkLogs.length > 0 && (
          <div className="flex flex-col gap-1.5 pt-1">
            <span className="text-[11px] font-medium text-text-muted">
              Riwayat Pengujian Terakhir:
            </span>
            <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none">
              {benchmarkLogs.map((log, i) => (
                <div
                  key={i}
                  className="px-2.5 py-1.5 rounded-xl bg-surface border border-outline-variant/40 text-[11px] whitespace-nowrap flex items-center gap-2 shrink-0"
                >
                  <span className="font-mono text-text-muted">{log.time}</span>
                  <span className="font-bold text-text-primary">{log.roundtrip} ms</span>
                  <span className="text-text-secondary">({log.status})</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* ─── MODULAR RESET: TOMBOL PER FITUR ─── */}
      <div className="flex flex-col gap-3">
        <h2 className="font-headline-3 text-headline-3 text-text-primary flex items-center gap-2">
          <Icon name="tune" className="text-[20px] text-brand-600" />
          Pembersihan Data Modular (Per Fitur)
        </h2>
        <p className="font-caption text-caption text-text-secondary">
          Pilih fitur tertentu yang ingin dikosongkan tanpa mengganggu modul lainnya.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* 1. Modul Stok & Racikan */}
          <div className="clay-card p-5 flex flex-col justify-between gap-4 border border-outline-variant/60">
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-brand-50 text-brand-600 flex items-center justify-center">
                  <Icon name="science" className="text-[18px]" />
                </div>
                <h3 className="font-body-bold text-body-bold text-text-primary">
                  Modul Stok & Racikan
                </h3>
              </div>
              <p className="font-caption text-caption text-text-secondary">
                Menghapus riwayat mutasi log stok, klaim pengajuan, draf opname, dan rekonsiliasi.
              </p>

              <label className="flex items-center gap-2 mt-1 p-2.5 rounded-xl bg-surface-container-low border border-outline-variant/40 cursor-pointer">
                <input
                  type="checkbox"
                  checked={stockDeleteMaster}
                  onChange={(e) => setStockDeleteMaster(e.target.checked)}
                  className="rounded text-brand-600 focus:ring-brand-400 w-4 h-4"
                />
                <span className="text-xs text-text-primary font-medium">
                  Hapus Bersih Total (+ Master Barang & Resep Racikan)
                </span>
              </label>
            </div>

            <button
              type="button"
              onClick={() =>
                openConfirm({
                  title: stockDeleteMaster
                    ? "Hapus Bersih Seluruh Master & Riwayat Stok"
                    : "Reset Mutasi & Nol-kan Saldo Stok",
                  description: stockDeleteMaster
                    ? `Perhatian: Seluruh master item gudang, botol racikan, dan riwayat mutasi di ${targetScopeLabel} akan DIHAPUS TOTAL (Clean Slate).`
                    : `Riwayat mutasi, klaim, dan opname di ${targetScopeLabel} akan dihapus. Master barang tetap ada dan saldo di-reset menjadi 0.`,
                  requiredKeyword: stockDeleteMaster ? "HAPUS TOTAL STOK" : "RESET STOK",
                  badgeLabel: "Modul Stok",
                  onConfirm: async () => {
                    const branchParam = selectedBranchId === "all" ? null : selectedBranchId;
                    const res = await maintainerWipeStockAction({
                      branchId: branchParam,
                      deleteMaster: stockDeleteMaster,
                    });
                    if (res.ok) {
                      toast.sukses("Stok Direset", "Data stok berhasil dibersihkan sesuai pilihan.");
                    } else {
                      throw new Error(res.message);
                    }
                  },
                })
              }
              className="w-full py-2.5 rounded-xl bg-surface-container hover:bg-surface-container-high text-danger-text font-label-bold text-label-bold border border-danger-base/30 flex items-center justify-center gap-1.5 transition-colors active:scale-95"
            >
              <Icon name="delete" className="text-[18px]" />
              {stockDeleteMaster ? "Hapus Total Master & Log Stok" : "Reset Log Mutasi & Saldo Stok"}
            </button>
          </div>

          {/* 2. Modul Presensi & Kehadiran */}
          <div className="clay-card p-5 flex flex-col justify-between gap-4 border border-outline-variant/60">
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-brand-50 text-brand-600 flex items-center justify-center">
                  <Icon name="how_to_reg" className="text-[18px]" />
                </div>
                <h3 className="font-body-bold text-body-bold text-text-primary">
                  Modul Presensi & Absensi SDM
                </h3>
              </div>
              <p className="font-caption text-caption text-text-secondary">
                Menghapus seluruh log clock-in/out, foto selfie, izin/cuti/sakit, dan jadwal shift. Akun login dan data profil karyawan tetap aman.
              </p>
            </div>

            <button
              type="button"
              onClick={() =>
                openConfirm({
                  title: "Reset Seluruh Data Presensi",
                  description: `Seluruh riwayat absensi, log biometrik, izin/cuti, dan jadwal shift di ${targetScopeLabel} akan dihapus bersih. Akun profil staf tetap utuh.`,
                  requiredKeyword: "RESET ABSENSI",
                  badgeLabel: "Modul Presensi",
                  onConfirm: async () => {
                    const branchParam = selectedBranchId === "all" ? null : selectedBranchId;
                    const res = await maintainerWipeAttendanceAction({ branchId: branchParam });
                    if (res.ok) {
                      toast.sukses("Presensi Direset", "Riwayat presensi dan cuti berhasil dibersihkan.");
                    } else {
                      throw new Error(res.message);
                    }
                  },
                })
              }
              className="w-full py-2.5 rounded-xl bg-surface-container hover:bg-surface-container-high text-danger-text font-label-bold text-label-bold border border-danger-base/30 flex items-center justify-center gap-1.5 transition-colors active:scale-95"
            >
              <Icon name="delete" className="text-[18px]" />
              Reset Seluruh Data Presensi
            </button>
          </div>

          {/* 3. Modul POS, Order & Garansi */}
          <div className="clay-card p-5 flex flex-col justify-between gap-4 border border-outline-variant/60">
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-brand-50 text-brand-600 flex items-center justify-center">
                  <Icon name="assignment" className="text-[18px]" />
                </div>
                <h3 className="font-body-bold text-body-bold text-text-primary">
                  Modul Order Transaksi & Garansi
                </h3>
              </div>
              <p className="font-caption text-caption text-text-secondary">
                Menghapus semua transaksi SPK, detail layanan, riwayat pembayaran invoice, foto inspeksi QC, pembagian komisi order, dan klaim garansi.
              </p>
            </div>

            <button
              type="button"
              onClick={() =>
                openConfirm({
                  title: "Reset Seluruh Transaksi Order & POS",
                  description: `Seluruh SPK pengerjaan order, tagihan, invoice, komisi, dan sertifikat garansi di ${targetScopeLabel} akan dihapus.`,
                  requiredKeyword: "RESET ORDER",
                  badgeLabel: "Modul Order",
                  onConfirm: async () => {
                    const branchParam = selectedBranchId === "all" ? null : selectedBranchId;
                    const res = await maintainerWipeOrdersAction({ branchId: branchParam });
                    if (res.ok) {
                      toast.sukses("Order Direset", "Seluruh data transaksi order berhasil dibersihkan.");
                    } else {
                      throw new Error(res.message);
                    }
                  },
                })
              }
              className="w-full py-2.5 rounded-xl bg-surface-container hover:bg-surface-container-high text-danger-text font-label-bold text-label-bold border border-danger-base/30 flex items-center justify-center gap-1.5 transition-colors active:scale-95"
            >
              <Icon name="delete" className="text-[18px]" />
              Reset Seluruh Transaksi Order
            </button>
          </div>

          {/* 4. Modul Kas & Keuangan */}
          <div className="clay-card p-5 flex flex-col justify-between gap-4 border border-outline-variant/60">
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-brand-50 text-brand-600 flex items-center justify-center">
                  <Icon name="payments" className="text-[18px]" />
                </div>
                <h3 className="font-body-bold text-body-bold text-text-primary">
                  Modul Keuangan & Kas
                </h3>
              </div>
              <p className="font-caption text-caption text-text-secondary">
                Menghapus catatan arus kas masuk/keluar operasional (Cash Flow) dan pencatatan kas kecil (Petty Cash).
              </p>
            </div>

            <button
              type="button"
              onClick={() =>
                openConfirm({
                  title: "Reset Seluruh Data Keuangan & Kas",
                  description: `Seluruh entri kas masuk, kas keluar, dan petty cash di ${targetScopeLabel} akan dikosongkan kembali ke awal.`,
                  requiredKeyword: "RESET KAS",
                  badgeLabel: "Modul Keuangan",
                  onConfirm: async () => {
                    const branchParam = selectedBranchId === "all" ? null : selectedBranchId;
                    const res = await maintainerWipeFinanceAction({ branchId: branchParam });
                    if (res.ok) {
                      toast.sukses("Keuangan Direset", "Seluruh data kas berhasil dikosongkan.");
                    } else {
                      throw new Error(res.message);
                    }
                  },
                })
              }
              className="w-full py-2.5 rounded-xl bg-surface-container hover:bg-surface-container-high text-danger-text font-label-bold text-label-bold border border-danger-base/30 flex items-center justify-center gap-1.5 transition-colors active:scale-95"
            >
              <Icon name="delete" className="text-[18px]" />
              Reset Seluruh Data Kas & Keuangan
            </button>
          </div>
        </div>
      </div>

      {/* ─── MASTER RESET: ALL DATA TESTING ZONE ─── */}
      <section className="clay-card p-6 sm:p-7 flex flex-col gap-5 border-2 border-danger-base/40 bg-danger-surface/10 rounded-3xl">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-danger text-white flex items-center justify-center shrink-0 shadow-sm">
              <Icon name="delete_forever" className="text-[26px]" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="px-2.5 py-0.5 rounded-full bg-danger text-white font-micro-badge text-micro-badge font-bold uppercase tracking-wider">
                  Zona Bahaya
                </span>
                <span className="text-xs font-bold text-danger-text">Master Reset</span>
              </div>
              <h2 className="font-headline-2 text-headline-2 text-text-primary mt-0.5">
                Reset Semua Data Testing (Clean State)
              </h2>
            </div>
          </div>
        </div>

        <div className="p-4 rounded-2xl bg-surface border border-outline-variant/60 flex flex-col gap-2.5 text-xs text-text-secondary">
          <p className="font-semibold text-text-primary">
            🛡️ Apa yang dihapus dan apa yang tetap aman?
          </p>
          <ul className="list-disc pl-5 flex flex-col gap-1 text-[11px]">
            <li>
              <strong>YANG DIHAPUS:</strong> Seluruh transaksi Order POS, invoice, kas keluar/masuk, riwayat absensi, shift, log mutasi stok, klaim, opname, dan activity logs di <strong>{targetScopeLabel}</strong>.
            </li>
            <li>
              <strong>100% AMAN (TIDAK DIHAPUS):</strong> Akun login staf & kredensial di <code>profiles</code>, daftar cabang di <code>branches</code>, nama bengkel & logo di <code>workshop_settings</code>, serta daftar master jasa layanan.
            </li>
          </ul>

          <label className="flex items-center gap-2 pt-2 border-t border-outline-variant/40 cursor-pointer">
            <input
              type="checkbox"
              checked={masterDeleteItems}
              onChange={(e) => setMasterDeleteItems(e.target.checked)}
              className="rounded text-danger focus:ring-danger w-4 h-4"
            />
            <span className="text-xs text-text-primary font-bold">
              Ikut hapus master barang gudang & resep racikan? (Jika tidak dicentang, master barang tetap ada dengan saldo 0)
            </span>
          </label>
        </div>

        <button
          type="button"
          onClick={() =>
            openConfirm({
              title: "MASTER RESET: Bersihkan Semua Data Testing",
              description: `Anda akan menghapus SELURUH transaksi order, pembayaran, absensi, kas, dan stok pada cakupan "${targetScopeLabel}". Akun login dan pengaturan cabang tetap aman. Tindakan ini tidak dapat dibatalkan!`,
              requiredKeyword: "DELETE ALL TESTING DATA",
              badgeLabel: "MASTER RESET",
              isMaster: true,
              onConfirm: async () => {
                const branchParam = selectedBranchId === "all" ? null : selectedBranchId;
                const res = await maintainerMasterWipeAction({
                  branchId: branchParam,
                  deleteInventoryItems: masterDeleteItems,
                });
                if (res.ok) {
                  toast.sukses("Master Reset Sukses", "Seluruh data operasional testing berhasil dibersihkan.");
                } else {
                  throw new Error(res.message);
                }
              },
            })
          }
          className="w-full py-4 rounded-2xl bg-danger hover:bg-danger/90 text-white font-headline-3 text-headline-3 flex items-center justify-center gap-2 active:scale-95 transition-all shadow-md"
        >
          <Icon name="delete_forever" className="text-[22px]" />
          Reset Semua Data Testing Sekarang
        </button>
      </section>

      {/* ─── TWO-STEP CONFIRMATION MODAL ─── */}
      {confirmModal && (
        <Modal
          open
          onClose={() => {
            if (!pendingAction) setConfirmModal(null);
          }}
          title={confirmModal.title}
        >
          <div className="flex flex-col gap-4">
            <div className="p-3.5 rounded-2xl bg-danger-surface text-danger-text text-xs flex flex-col gap-1 border border-danger-base/30">
              <span className="font-bold flex items-center gap-1.5">
                <Icon name="warning" className="text-[16px]" />
                Tindakan Berbahaya & Permanen!
              </span>
              <span>{confirmModal.description}</span>
            </div>

            <div className="flex flex-col gap-2">
              <label className="text-xs font-medium text-text-primary">
                Untuk melanjutkan, ketik kata konfirmasi di bawah ini:
              </label>
              <div className="p-2 rounded-xl bg-surface-container font-mono text-center font-bold text-sm tracking-widest select-all border border-outline-variant">
                {confirmModal.requiredKeyword}
              </div>
              <input
                type="text"
                autoFocus
                value={typedKeyword}
                onChange={(e) => setTypedKeyword(e.target.value)}
                placeholder="Ketik persis seperti teks di atas..."
                className="h-11 px-3 rounded-xl border border-outline-variant bg-surface text-text-primary font-mono text-center outline-none focus:border-danger uppercase"
              />
            </div>

            <div className="flex gap-2 pt-2">
              <button
                type="button"
                disabled={pendingAction}
                onClick={() => setConfirmModal(null)}
                className="flex-1 py-3 rounded-xl bg-surface-container text-text-secondary font-body-bold text-body-bold active:scale-95 transition-transform disabled:opacity-50"
              >
                Batal
              </button>
              <button
                type="button"
                disabled={
                  pendingAction ||
                  typedKeyword.trim().toUpperCase() !== confirmModal.requiredKeyword.toUpperCase()
                }
                onClick={handleExecuteWipe}
                className="flex-1 py-3 rounded-xl bg-danger text-white font-body-bold text-body-bold flex items-center justify-center gap-1.5 active:scale-95 transition-transform disabled:opacity-40 disabled:pointer-events-none shadow-sm"
              >
                <Icon name={pendingAction ? "hourglass_top" : "delete"} className="text-[18px]" />
                {pendingAction ? "Membersihkan Data..." : "Konfirmasi & Hapus"}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
