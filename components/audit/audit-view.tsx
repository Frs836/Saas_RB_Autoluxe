"use client";

import { useState, useTransition } from "react";
import { createClient } from "@/lib/supabase/client";
import { Icon } from "@/components/ui/icon";
import { formatRupiah } from "@/lib/format";

type AuditRow = {
  id: string;
  created_at: string;
  action: string;
  category: string;
  actor_id: string | null;
  actor_name: string;
  actor_role: string;
  entity: string;
  entity_id: string | null;
  metadata: Record<string, unknown> | null;
  label: string;
  order_number: string | null;
  target_name: string | null;
};

const CATEGORY_FILTERS = [
  { key: "all",        label: "Semua",       icon: "apps"           },
  { key: "order",      label: "Order",       icon: "assignment"     },
  { key: "payment",    label: "Pembayaran",  icon: "payments"       },
  { key: "staff",      label: "Staf",        icon: "groups"         },
  { key: "time_off",   label: "Izin/Cuti",   icon: "event_busy"     },
  { key: "stock",      label: "Stok",        icon: "inventory_2"    },
  { key: "attendance", label: "Absensi",     icon: "how_to_reg"     },
  { key: "system",     label: "Sistem",      icon: "settings"       },
];

const CATEGORY_COLORS: Record<string, string> = {
  order:      "bg-brand-50 text-brand-700",
  payment:    "bg-success-surface text-success-text",
  staff:      "bg-purple-50 text-purple-700",
  time_off:   "bg-warning-surface text-warning-text",
  stock:      "bg-orange-50 text-orange-700",
  attendance: "bg-surface-container text-text-secondary",
  system:     "bg-surface-container text-text-secondary",
};

const CATEGORY_ICONS: Record<string, string> = {
  order:      "assignment",
  payment:    "payments",
  staff:      "groups",
  time_off:   "event_busy",
  stock:      "inventory_2",
  attendance: "how_to_reg",
  system:     "settings",
};

const ROLE_LABELS: Record<string, string> = {
  owner:           "Owner",
  maintainer:      "Maintainer",
  manager:         "Manager",
  admin_kasir:     "Admin Kasir",
  finance:         "Finance",
  kepala_karyawan: "Kepala Karyawan",
  karyawan:        "Karyawan",
};

// Normalize a raw DB row (snake_case json) to AuditRow
function normalizeRow(r: any): AuditRow {
  return {
    id:           r.id           ?? "",
    created_at:   r.created_at   ?? "",
    action:       r.action       ?? "",
    category:     r.category     ?? "system",
    actor_id:     r.actor_id     ?? null,
    actor_name:   r.actor_name   ?? "Sistem",
    actor_role:   r.actor_role   ?? "-",
    entity:       r.entity       ?? "",
    entity_id:    r.entity_id    ?? null,
    metadata:     r.metadata     ?? null,
    label:        r.label        ?? r.action ?? "",
    order_number: r.order_number ?? null,
    target_name:  r.target_name  ?? null,
  };
}

function formatDateTime(iso: string) {
  return new Intl.DateTimeFormat("id-ID", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Jakarta",
  }).format(new Date(iso));
}

function formatDate(d: Date) { return d.toISOString().slice(0, 10); }

export function AuditView({
  initialRows,
  branchId,
  defaultFrom,
  defaultTo,
  error: initialError,
}: {
  initialRows: AuditRow[];
  branchId: string | null;
  defaultFrom: string;
  defaultTo: string;
  error: string | null;
}) {
  const [rows,     setRows]     = useState<AuditRow[]>(initialRows.map(normalizeRow));
  const [category, setCategory] = useState("all");
  const [from,     setFrom]     = useState(defaultFrom);
  const [to,       setTo]       = useState(defaultTo);
  const [search,   setSearch]   = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [error,    setError]    = useState<string | null>(initialError);
  const [pending,  startTransition] = useTransition();

  function applyPreset(preset: "today" | "week" | "month") {
    const now = new Date();
    let f: Date;
    if (preset === "today") f = new Date(now); // same day
    else if (preset === "week") f = new Date(now.getTime() - 7  * 86400000);
    else                        f = new Date(now.getTime() - 30 * 86400000);
    if (preset === "today") f.setHours(0,0,0,0);
    setFrom(formatDate(f));
    setTo(formatDate(now));
    fetchRows(category, formatDate(f), formatDate(now));
  }

  function fetchRows(cat: string, f: string, t: string) {
    startTransition(async () => {
      setError(null);
      const supabase = createClient();
      const { data, error: rpcErr } = await (supabase as any).rpc("get_audit_trail", {
        ...(branchId ? { p_branch_id: branchId } : {}),
        p_category: cat,
        p_from: f,
        p_to: t,
        p_limit: 200,
        p_offset: 0,
      });
      if (rpcErr) { setError(rpcErr.message); return; }
      // RPC returns SETOF json — each row is a plain JSON object
      setRows(((data ?? []) as any[]).map(normalizeRow));
    });
  }

  const filtered = rows.filter((r) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      r.actor_name.toLowerCase().includes(q) ||
      (r.order_number ?? "").toLowerCase().includes(q) ||
      (r.target_name  ?? "").toLowerCase().includes(q) ||
      r.label.toLowerCase().includes(q)
    );
  });

  // Summary counts per category
  const counts = rows.reduce((acc, r) => {
    acc[r.category] = (acc[r.category] ?? 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  return (
    <div className="px-gutter py-4 flex flex-col gap-4">

      {/* Filter periode */}
      <div className="clay-card p-4 flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="font-headline-2 text-headline-2 text-text-primary">Filter</h2>
          {pending && <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />}
        </div>
        <div className="flex gap-2 flex-wrap">
          {(["today","week","month"] as const).map((p) => (
            <button key={p} type="button" onClick={() => applyPreset(p)}
              className="px-3 h-9 rounded-full bg-surface-container-low text-text-secondary font-caption text-caption active:scale-95 transition-transform">
              {p === "today" ? "Hari Ini" : p === "week" ? "7 Hari" : "30 Hari"}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1">
            <span className="font-caption text-caption text-text-muted">Dari</span>
            <input type="date" value={from}
              onChange={(e) => { setFrom(e.target.value); fetchRows(category, e.target.value, to); }}
              className="h-11 px-3 rounded-xl bg-surface-container-low font-body text-body text-text-primary outline-none focus:ring-2 focus:ring-brand-400" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-caption text-caption text-text-muted">Sampai</span>
            <input type="date" value={to}
              onChange={(e) => { setTo(e.target.value); fetchRows(category, from, e.target.value); }}
              className="h-11 px-3 rounded-xl bg-surface-container-low font-body text-body text-text-primary outline-none focus:ring-2 focus:ring-brand-400" />
          </label>
        </div>
      </div>

      {/* Category filter tabs */}
      <div className="flex gap-2 overflow-x-auto no-scrollbar -mx-gutter px-gutter">
        {CATEGORY_FILTERS.map((f) => (
          <button key={f.key} type="button"
            onClick={() => { setCategory(f.key); fetchRows(f.key, from, to); }}
            className={`shrink-0 px-3 h-9 rounded-full font-caption text-caption flex items-center gap-1.5 active:scale-95 transition-transform ${
              category === f.key ? "bg-primary text-white" : "bg-surface-container-low text-text-secondary"
            }`}>
            <Icon name={f.icon} className="text-[14px]" />
            {f.label}
            {f.key !== "all" && counts[f.key] ? (
              <span className="text-[10px] bg-white/20 px-1 rounded-full">{counts[f.key]}</span>
            ) : null}
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="relative">
        <Icon name="search" className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted text-[20px]" />
        <input value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder="Cari nama, no. order, atau aksi..."
          className="w-full h-11 pl-10 pr-3 rounded-xl bg-surface-container-low font-body text-body text-text-primary outline-none focus:ring-2 focus:ring-brand-400" />
      </div>

      {/* Summary */}
      <p className="font-caption text-caption text-text-muted">
        <b className="text-text-primary">{filtered.length}</b> log ditemukan
      </p>

      {error && (
        <div className="p-3 rounded-xl bg-danger-surface text-danger-text font-caption text-caption flex items-center gap-2">
          <Icon name="error" className="text-[18px] shrink-0" />
          {error}
        </div>
      )}

      {/* Log list */}
      {filtered.length === 0 && !error ? (
        <div className="clay-card p-8 flex flex-col items-center text-center gap-2">
          <Icon name="inbox" className="text-[40px] text-text-muted" />
          <p className="font-body text-body text-text-secondary">Tidak ada log pada filter ini.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {filtered.map((row) => {
            const isOpen = expanded === row.id;
            const catColor = CATEGORY_COLORS[row.category] ?? "bg-surface-container text-text-secondary";
            const catIcon  = CATEGORY_ICONS[row.category]  ?? "info";
            return (
              <div key={row.id} className="clay-card overflow-hidden">
                <button type="button" onClick={() => setExpanded(isOpen ? null : row.id)}
                  className="w-full p-3 flex items-start gap-3 text-left active:bg-surface-container-low transition-colors">

                  {/* Icon kategori */}
                  <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${catColor}`}>
                    <Icon name={catIcon} className="text-[18px]" />
                  </div>

                  {/* Main info */}
                  <div className="flex-1 min-w-0">
                    <p className="font-body-bold text-body-bold text-text-primary leading-tight truncate">
                      {row.label}
                    </p>
                    <div className="flex flex-wrap items-center gap-1.5 mt-0.5">
                      {/* Actor */}
                      <span className="font-caption text-caption text-brand-600">{row.actor_name}</span>
                      <span className="font-micro-badge text-micro-badge text-text-muted">·</span>
                      <span className="font-caption text-caption text-text-muted">
                        {ROLE_LABELS[row.actor_role] ?? row.actor_role}
                      </span>
                      {/* Order number */}
                      {row.order_number && (
                        <>
                          <span className="font-micro-badge text-micro-badge text-text-muted">·</span>
                          <span className="font-micro-badge text-micro-badge text-text-secondary font-mono">{row.order_number}</span>
                        </>
                      )}
                      {/* Target name */}
                      {row.target_name && (
                        <>
                          <span className="font-micro-badge text-micro-badge text-text-muted">·</span>
                          <span className="font-caption text-caption text-text-secondary">{row.target_name}</span>
                        </>
                      )}
                    </div>
                    <p className="font-micro-badge text-micro-badge text-text-muted mt-0.5">
                      {formatDateTime(row.created_at)}
                    </p>
                  </div>

                  <Icon name={isOpen ? "expand_more" : "chevron_right"} className="text-text-muted text-[18px] shrink-0 mt-1" />
                </button>

                {/* Expanded detail */}
                {isOpen && row.metadata && Object.keys(row.metadata).length > 0 && (
                  <div className="px-3 pb-3 border-t border-outline-variant/40">
                    <p className="font-caption text-caption text-text-muted mt-2 mb-1.5">Detail</p>
                    <div className="rounded-xl bg-surface-container/60 p-3 flex flex-col gap-1.5">
                      {Object.entries(row.metadata).map(([key, val]) => {
                        if (val === null || val === undefined) return null;
                        // Format amount fields
                        const isAmount = ["amount","total_price","paid_amount"].includes(key);
                        const label = key.replace(/_/g," ");
                        return (
                          <div key={key} className="flex items-start justify-between gap-2">
                            <span className="font-micro-badge text-micro-badge text-text-muted capitalize">{label}</span>
                            <span className="font-caption text-caption text-text-primary text-right max-w-[60%] break-words">
                              {isAmount ? formatRupiah(Number(val)) : String(val)}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
