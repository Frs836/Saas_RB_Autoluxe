"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { formatRupiah } from "@/lib/format";
import { Icon } from "@/components/ui/icon";

export type KomisiRow = {
  profileId:     string;
  fullName:      string;
  role:          string;
  branchName:    string;
  totalOrders:   number;
  leadOrders:    number;
  memberOrders:  number;
  totalRevenue:  number;
  leadRevenue:   number;
  washOrders:    number;
  coatingOrders: number;
  polesOrders:   number;
  otherOrders:   number;
};

const ROLE_LABELS: Record<string, string> = {
  karyawan:    "Karyawan",
  admin_kasir: "Admin Kasir",
  maintainer:  "Maintainer",
  owner:       "Owner",
};

function initials(name: string) {
  return name.split(/\s+/).slice(0, 2).map((p) => p[0]).join("").toUpperCase();
}

function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function KomisiView({
  initialRows,
  branchId,
  defaultFrom,
  defaultTo,
}: {
  initialRows: KomisiRow[];
  branchId: string | null;
  defaultFrom: string;
  defaultTo: string;
}) {
  const [rows,   setRows]   = useState<KomisiRow[]>(initialRows);
  const [from,   setFrom]   = useState(defaultFrom);
  const [to,     setTo]     = useState(defaultTo);
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Quick preset buttons
  function applyPreset(preset: "bulan_ini" | "bulan_lalu" | "3bulan") {
    const now = new Date();
    let f: Date, t: Date;
    if (preset === "bulan_ini") {
      f = new Date(now.getFullYear(), now.getMonth(), 1);
      t = now;
    } else if (preset === "bulan_lalu") {
      f = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      t = new Date(now.getFullYear(), now.getMonth(), 0);
    } else {
      f = new Date(now.getFullYear(), now.getMonth() - 2, 1);
      t = now;
    }
    setFrom(formatDate(f));
    setTo(formatDate(t));
    fetchReport(formatDate(f), formatDate(t));
  }

  function fetchReport(f: string, t: string) {
    startTransition(async () => {
      const supabase = createClient();
      const { data } = await (supabase as any).rpc("get_staff_commission_report", {
        ...(branchId ? { p_branch_id: branchId } : {}),
        p_from: f,
        p_to:   t,
      });
      if (data) {
        setRows((data as Record<string, unknown>[]).map((r) => ({
          profileId:     r.profile_id     as string,
          fullName:      r.full_name      as string,
          role:          r.role           as string,
          branchName:    r.branch_name    as string,
          totalOrders:   Number(r.total_orders   ?? 0),
          leadOrders:    Number(r.lead_orders    ?? 0),
          memberOrders:  Number(r.member_orders  ?? 0),
          totalRevenue:  Number(r.total_revenue  ?? 0),
          leadRevenue:   Number(r.lead_revenue   ?? 0),
          washOrders:    Number(r.wash_orders    ?? 0),
          coatingOrders: Number(r.coating_orders ?? 0),
          polesOrders:   Number(r.poles_orders   ?? 0),
          otherOrders:   Number(r.other_orders   ?? 0),
        })));
      }
    });
  }

  const filtered = rows.filter((r) =>
    search === "" ||
    r.fullName.toLowerCase().includes(search.toLowerCase()) ||
    r.branchName.toLowerCase().includes(search.toLowerCase())
  );

  // Totals
  const totalOrders  = filtered.reduce((s, r) => s + r.totalOrders,  0);
  const totalRevenue = filtered.reduce((s, r) => s + r.totalRevenue, 0);

  return (
    <div className="px-gutter py-4 flex flex-col gap-4">

      {/* Filter Tanggal */}
      <div className="clay-card p-4 flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="font-headline-2 text-headline-2 text-text-primary">Periode</h2>
          {pending && (
            <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          )}
        </div>

        {/* Quick presets */}
        <div className="flex gap-2 flex-wrap">
          {([
            { key: "bulan_ini",  label: "Bulan Ini"    },
            { key: "bulan_lalu", label: "Bulan Lalu"   },
            { key: "3bulan",     label: "3 Bulan"      },
          ] as const).map((p) => (
            <button
              key={p.key}
              type="button"
              onClick={() => applyPreset(p.key)}
              className="px-3 h-9 rounded-full bg-surface-container-low text-text-secondary font-caption text-caption active:scale-95 transition-transform"
            >
              {p.label}
            </button>
          ))}
        </div>

        {/* Custom range */}
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1">
            <span className="font-caption text-caption text-text-muted">Dari</span>
            <input
              type="date"
              value={from}
              onChange={(e) => { setFrom(e.target.value); fetchReport(e.target.value, to); }}
              className="h-11 px-3 rounded-xl bg-surface-container-low font-body text-body text-text-primary outline-none focus:ring-2 focus:ring-brand-400"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-caption text-caption text-text-muted">Sampai</span>
            <input
              type="date"
              value={to}
              onChange={(e) => { setTo(e.target.value); fetchReport(from, e.target.value); }}
              className="h-11 px-3 rounded-xl bg-surface-container-low font-body text-body text-text-primary outline-none focus:ring-2 focus:ring-brand-400"
            />
          </label>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-3">
        <div className="clay-card p-4 flex flex-col gap-1">
          <div className="w-9 h-9 rounded-xl bg-brand-50 flex items-center justify-center">
            <Icon name="groups" className="text-brand-600 text-[20px]" />
          </div>
          <p className="font-caption text-caption text-text-muted mt-2">Total Karyawan</p>
          <p className="font-headline-1 text-headline-1 text-text-primary">{filtered.length}</p>
          <p className="font-micro-badge text-micro-badge text-text-muted">aktif di periode ini</p>
        </div>
        <div className="clay-card p-4 flex flex-col gap-1">
          <div className="w-9 h-9 rounded-xl bg-brand-50 flex items-center justify-center">
            <Icon name="directions_car" className="text-brand-600 text-[20px]" />
          </div>
          <p className="font-caption text-caption text-text-muted mt-2">Total Unit</p>
          <p className="font-headline-1 text-headline-1 text-text-primary">{totalOrders}</p>
          <p className="font-micro-badge text-micro-badge text-brand-600">{formatRupiah(totalRevenue)}</p>
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <Icon name="search" className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted text-[20px]" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Cari nama karyawan atau cabang..."
          className="w-full h-12 pl-10 pr-3 rounded-2xl bg-surface-container-low font-body text-body text-text-primary outline-none focus:ring-2 focus:ring-brand-400"
        />
      </div>

      {/* Staff list */}
      {filtered.length === 0 ? (
        <div className="clay-card p-8 flex flex-col items-center text-center gap-2">
          <Icon name="inbox" className="text-[40px] text-text-muted" />
          <p className="font-body text-body text-text-secondary">
            Tidak ada data komisi pada periode ini.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {filtered.map((row) => {
            const isOpen = expanded === row.profileId;
            return (
              <div key={row.profileId} className="clay-card overflow-hidden">
                {/* Header row — klik untuk expand */}
                <button
                  type="button"
                  onClick={() => setExpanded(isOpen ? null : row.profileId)}
                  className="w-full p-4 flex items-center gap-3 text-left active:bg-surface-container-low transition-colors"
                >
                  {/* Avatar */}
                  <div className="w-11 h-11 rounded-full bg-brand-500 text-white flex items-center justify-center font-body-bold text-body-bold shrink-0">
                    {initials(row.fullName)}
                  </div>

                  {/* Name + role + branch */}
                  <div className="flex-1 min-w-0">
                    <p className="font-body-bold text-body-bold text-text-primary truncate">{row.fullName}</p>
                    <p className="font-caption text-caption text-text-muted truncate">
                      {ROLE_LABELS[row.role] ?? row.role} • {row.branchName}
                    </p>
                  </div>

                  {/* Total orders badge */}
                  <div className="flex flex-col items-end shrink-0">
                    <span className="font-headline-2 text-headline-2 text-text-primary">
                      {row.totalOrders}
                    </span>
                    <span className="font-micro-badge text-micro-badge text-text-muted">unit</span>
                  </div>

                  <Icon
                    name={isOpen ? "expand_more" : "chevron_right"}
                    className="text-text-muted text-[20px] shrink-0"
                  />
                </button>

                {/* Expanded detail */}
                {isOpen && (
                  <div className="px-4 pb-4 flex flex-col gap-3 border-t border-outline-variant">
                    {/* Revenue */}
                    <div className="pt-3 grid grid-cols-2 gap-2">
                      <div className="rounded-xl bg-surface-container/60 p-3">
                        <p className="font-caption text-caption text-text-muted">Total Revenue</p>
                        <p className="font-body-bold text-body-bold text-brand-600 mt-0.5">
                          {formatRupiah(row.totalRevenue)}
                        </p>
                      </div>
                      <div className="rounded-xl bg-surface-container/60 p-3">
                        <p className="font-caption text-caption text-text-muted">Revenue sebagai Lead</p>
                        <p className="font-body-bold text-body-bold text-text-primary mt-0.5">
                          {formatRupiah(row.leadRevenue)}
                        </p>
                      </div>
                    </div>

                    {/* Lead vs Member */}
                    <div className="grid grid-cols-2 gap-2">
                      <div className="rounded-xl bg-brand-50 p-3 flex items-center gap-2">
                        <Icon name="star" className="text-brand-600 text-[18px] shrink-0" />
                        <div>
                          <p className="font-caption text-caption text-brand-700">Lead</p>
                          <p className="font-body-bold text-body-bold text-brand-700">{row.leadOrders} unit</p>
                        </div>
                      </div>
                      <div className="rounded-xl bg-surface-container/60 p-3 flex items-center gap-2">
                        <Icon name="groups" className="text-text-secondary text-[18px] shrink-0" />
                        <div>
                          <p className="font-caption text-caption text-text-muted">Anggota Tim</p>
                          <p className="font-body-bold text-body-bold text-text-primary">{row.memberOrders} unit</p>
                        </div>
                      </div>
                    </div>

                    {/* Breakdown layanan */}
                    <div>
                      <p className="font-caption text-caption text-text-muted mb-2">Breakdown Layanan</p>
                      <div className="flex flex-col gap-1.5">
                        {[
                          { label: "Wash / Cuci",    value: row.washOrders,    icon: "water_drop",   color: "text-brand-600"   },
                          { label: "Coating / Nano", value: row.coatingOrders, icon: "auto_awesome",  color: "text-purple-600"  },
                          { label: "Poles / Detail", value: row.polesOrders,   icon: "healing",       color: "text-orange-600"  },
                          { label: "Lainnya",        value: row.otherOrders,   icon: "more_horiz",    color: "text-text-muted"  },
                        ].filter((s) => s.value > 0).map((s) => (
                          <div key={s.label} className="flex items-center justify-between py-1.5 border-b border-outline-variant last:border-0">
                            <div className="flex items-center gap-2">
                              <Icon name={s.icon} className={`${s.color} text-[16px]`} />
                              <span className="font-caption text-caption text-text-secondary">{s.label}</span>
                            </div>
                            <span className="font-body-bold text-body-bold text-text-primary">{s.value} unit</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Note untuk owner */}
                    <p className="font-micro-badge text-micro-badge text-text-muted text-center">
                      Data ini untuk referensi kalkulasi komisi oleh Owner.
                      Jumlah nominal komisi ditetapkan manual.
                    </p>
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
