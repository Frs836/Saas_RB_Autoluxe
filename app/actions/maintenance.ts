"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getSessionProfile } from "@/lib/rbac-guard";

type ActionResult<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; message: string };

async function verifyMaintainerRole() {
  const session = await getSessionProfile();
  if (!session) {
    throw new Error("Sesi tidak valid. Silakan login kembali.");
  }
  if (session.role !== "maintainer" && session.role !== "owner") {
    throw new Error(`Akses ditolak: Hanya Maintainer dan Owner yang memiliki akses (Role Anda: ${session.role}).`);
  }
  return session;
}

function revalidateAllAppPaths() {
  const paths = [
    "/stok",
    "/stok/racikan",
    "/stok/opname",
    "/stok/racikan/opname",
    "/pos",
    "/pos/orders",
    "/absensi",
    "/izin",
    "/kas",
    "/dashboard",
    "/rekap",
    "/laporan",
    "/laporan/produksi",
    "/laporan/cashflow",
    "/pengaturan/resep",
  ];
  for (const p of paths) {
    try {
      revalidatePath(p);
    } catch {
      // ignore
    }
  }
}

/** 1. Reset / Hapus Data Stok */
export async function maintainerWipeStockAction(params: {
  branchId: string | null;
  deleteMaster: boolean;
}): Promise<ActionResult> {
  try {
    await verifyMaintainerRole();
    const supabase = await createClient();

    const { data, error } = await (supabase as any).rpc("maintainer_wipe_stock", {
      p_branch_id: params.branchId || null,
      p_delete_master: params.deleteMaster,
    });

    if (error) return { ok: false, message: error.message };

    revalidateAllAppPaths();
    return { ok: true, data };
  } catch (err: any) {
    return { ok: false, message: err.message || "Gagal mereset data stok" };
  }
}

/** 2. Reset / Hapus Data Presensi & SDM */
export async function maintainerWipeAttendanceAction(params: {
  branchId: string | null;
}): Promise<ActionResult> {
  try {
    await verifyMaintainerRole();
    const supabase = await createClient();

    const { data, error } = await (supabase as any).rpc("maintainer_wipe_attendance", {
      p_branch_id: params.branchId || null,
    });

    if (error) return { ok: false, message: error.message };

    revalidateAllAppPaths();
    return { ok: true, data };
  } catch (err: any) {
    return { ok: false, message: err.message || "Gagal mereset data presensi" };
  }
}

/** 3. Reset / Hapus Data Order POS & Garansi */
export async function maintainerWipeOrdersAction(params: {
  branchId: string | null;
}): Promise<ActionResult> {
  try {
    await verifyMaintainerRole();
    const supabase = await createClient();

    const { data, error } = await (supabase as any).rpc("maintainer_wipe_orders", {
      p_branch_id: params.branchId || null,
    });

    if (error) return { ok: false, message: error.message };

    revalidateAllAppPaths();
    return { ok: true, data };
  } catch (err: any) {
    return { ok: false, message: err.message || "Gagal mereset data order" };
  }
}

/** 4. Reset / Hapus Data Kas & Keuangan */
export async function maintainerWipeFinanceAction(params: {
  branchId: string | null;
}): Promise<ActionResult> {
  try {
    await verifyMaintainerRole();
    const supabase = await createClient();

    const { data, error } = await (supabase as any).rpc("maintainer_wipe_finance", {
      p_branch_id: params.branchId || null,
    });

    if (error) return { ok: false, message: error.message };

    revalidateAllAppPaths();
    return { ok: true, data };
  } catch (err: any) {
    return { ok: false, message: err.message || "Gagal mereset data keuangan" };
  }
}

/** 5. Reset / Hapus Log Aktivitas & Notifikasi */
export async function maintainerWipeLogsAction(params: {
  branchId: string | null;
}): Promise<ActionResult> {
  try {
    await verifyMaintainerRole();
    const supabase = await createClient();

    const { data, error } = await (supabase as any).rpc("maintainer_wipe_logs", {
      p_branch_id: params.branchId || null,
    });

    if (error) return { ok: false, message: error.message };

    revalidateAllAppPaths();
    return { ok: true, data };
  } catch (err: any) {
    return { ok: false, message: err.message || "Gagal mereset activity logs" };
  }
}

/** 6. Master Reset: Bersihkan Seluruh Data Testing Kecuali Akun & Role */
export async function maintainerMasterWipeAction(params: {
  branchId: string | null;
  deleteInventoryItems: boolean;
}): Promise<ActionResult> {
  try {
    await verifyMaintainerRole();
    const supabase = await createClient();

    const { data, error } = await (supabase as any).rpc("maintainer_master_wipe", {
      p_branch_id: params.branchId || null,
      p_delete_inventory_items: params.deleteInventoryItems,
    });

    if (error) return { ok: false, message: error.message };

    revalidateAllAppPaths();
    return { ok: true, data };
  } catch (err: any) {
    return { ok: false, message: err.message || "Gagal melakukan Master Reset" };
  }
}

export type BenchmarkResult = {
  server_timestamp: string;
  server_to_db_latency_ms: number;
  db_internal_query_ms: number;
  status: string;
  counts: {
    inventory_items: number;
    bundle_items: number;
    orders: number;
    attendances: number;
    cash_flow: number;
    profiles: number;
  };
  node_version: string;
  env: string;
};

/** 7. Benchmark / Speed & Latency Test Diagnostic */
export async function maintainerPingBenchmarkAction(
  branchId: string | null,
): Promise<ActionResult<BenchmarkResult>> {
  try {
    await verifyMaintainerRole();
    const supabase = await createClient();

    const tStart = performance.now();
    const { data, error } = await (supabase as any).rpc("maintainer_ping_system", {
      p_branch_id: branchId || null,
    });
    const tEnd = performance.now();

    if (error) return { ok: false, message: error.message };

    const serverToDbLatency = Math.round((tEnd - tStart) * 100) / 100;

    return {
      ok: true,
      data: {
        server_timestamp: data?.server_timestamp ?? new Date().toISOString(),
        server_to_db_latency_ms: serverToDbLatency,
        db_internal_query_ms: Number(data?.db_query_duration_ms ?? 0),
        status: data?.status ?? "healthy",
        counts: data?.counts ?? {
          inventory_items: 0,
          bundle_items: 0,
          orders: 0,
          attendances: 0,
          cash_flow: 0,
          profiles: 0,
        },
        node_version: process.version,
        env: process.env.NODE_ENV ?? "production",
      },
    };
  } catch (err: any) {
    return { ok: false, message: err.message || "Gagal menjalankan tes kecepatan" };
  }
}
