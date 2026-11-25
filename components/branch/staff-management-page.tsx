"use client";

import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { StaffManagement } from "@/components/branch/staff-management";
import { StaffCreateForm } from "@/components/branch/staff-create-form";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { BottomNav } from "@/components/dashboard/bottom-nav";
import { Icon } from "@/components/ui/icon";
import { getSessionProfile } from "@/lib/rbac-guard";

export type ManagedStaff = {
  id: string;
  fullName: string;
  role: string;
  roleLabel: string;
  branchId: string | null;
  branchName: string;
  workSchedule: "field" | "office";
  isActive: boolean;
  defaultOffDay: number | null;
  offInLieuBalance: number;
  facePhotoUrl: string | null;
  faceStatus: string;
};

interface Props {
  session: Awaited<ReturnType<typeof getSessionProfile>>;
  branches: { id: string; name: string }[];
  branchId: string | null;
}

const ROLE_LABELS: Record<string, string> = {
  owner: "Pemilik",
  admin_kasir: "Admin Kasir",
  maintainer: "Maintainer",
  karyawan: "Karyawan",
};

export function StaffManagementPage({ session, branches, branchId }: Props) {
  const [activeTab, setActiveTab]           = useState<"kelola" | "tambah">("kelola");
  const [staff, setStaff]                   = useState<ManagedStaff[]>([]);
  const [loading, setLoading]               = useState(true);
  const [filterBranch, setFilterBranch]     = useState<string>("all");
  const [filterRole, setFilterRole]         = useState<string>("all");
  const [search, setSearch]                 = useState("");
  const [showInactive, setShowInactive]     = useState(false);

  const bisaKelolaStaf = session ? ["owner", "maintainer"].includes(session.role) : false;
  // Lintas cabang hanya untuk owner/maintainer tanpa branchId terpilih
  const isAllBranches = !branchId;

  const handleTabChange = (value: string) => {
    if (value === "kelola" || value === "tambah") setActiveTab(value as "kelola" | "tambah");
  };

  useEffect(() => {
    if (!bisaKelolaStaf && activeTab === "tambah") setActiveTab("kelola");
  }, [bisaKelolaStaf, activeTab]);

  useEffect(() => {
    async function fetchStaff() {
      if (!session) { setStaff([]); setLoading(false); return; }

      setLoading(true);
      const supabase = createClient();

      let query = supabase
        .from("profiles")
        .select("id, full_name, role, branch_id, work_schedule, is_active, default_off_day, off_in_lieu_balance, avatar_path, face_verification")
        .order("full_name");

      // Kalau ada branchId terpilih, filter per cabang; kalau "Seluruh Cabang" ambil semua
      if (branchId) {
        query = query.eq("branch_id", branchId);
      }

      const { data, error } = await query;

      if (error) {
        setStaff([]);
      } else {
        setStaff((data ?? []).map((p: any) => ({
          id:           p.id,
          fullName:     p.full_name ?? "Staf",
          role:         p.role ?? "karyawan",
          roleLabel:    ROLE_LABELS[p.role ?? ""] ?? "Karyawan",
          branchId:     p.branch_id,
          branchName:   branches.find((b) => b.id === p.branch_id)?.name ?? "Cabang Utama",
          workSchedule: (p.work_schedule as "field" | "office") ?? "field",
          isActive:     p.is_active ?? true,
          defaultOffDay: p.default_off_day,
          offInLieuBalance: p.off_in_lieu_balance ?? 0,
          facePhotoUrl: p.avatar_path
            ? `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/profile-avatars/${p.avatar_path}`
            : null,
          faceStatus: p.face_verification === "approved" ? "Terverifikasi"
                    : p.face_verification === "pending"  ? "Menunggu"
                    : "Belum Daftar",
        })));
      }
      setLoading(false);
    }
    fetchStaff();
  }, [session, branchId, branches]);

  const filtered = useMemo(() => {
    return staff.filter((s) => {
      if (!showInactive && !s.isActive) return false;
      if (filterBranch !== "all" && s.branchId !== filterBranch) return false;
      if (filterRole   !== "all" && s.role    !== filterRole)    return false;
      if (search && !s.fullName.toLowerCase().includes(search.toLowerCase()) &&
          !s.branchName.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  }, [staff, filterBranch, filterRole, search, showInactive]);

  if (!session) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex flex-col w-full min-h-screen">
      <main className="flex-1">
        {/* Mobile: tabs layout */}
        <div className="lg:hidden">
          <Tabs value={activeTab} onValueChange={handleTabChange} className="w-full">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="kelola">Kelola Staf</TabsTrigger>
              {bisaKelolaStaf && <TabsTrigger value="tambah">Tambah Staf</TabsTrigger>}
            </TabsList>

            <TabsContent value="kelola" className="px-gutter py-4 flex flex-col gap-3">
              {/* Search */}
              <div className="relative">
                <Icon name="search" className="absolute left-3.5 top-1/2 -translate-y-1/2 text-text-muted text-[20px]" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Cari nama staf atau cabang..."
                  className="w-full h-11 pl-11 pr-3.5 rounded-[8px] border border-border bg-surface font-body text-body text-text-primary outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
                />
              </div>

              {/* Filter bar */}
              <div className="flex gap-2 overflow-x-auto no-scrollbar -mx-gutter px-gutter">
                {isAllBranches && branches.length > 0 && (
                  <select
                    value={filterBranch}
                    onChange={(e) => setFilterBranch(e.target.value)}
                    className="shrink-0 h-10 px-3 rounded-[8px] border border-border bg-surface font-caption text-caption text-text-secondary outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
                  >
                    <option value="all">Semua Cabang</option>
                    {branches.map((b) => (
                      <option key={b.id} value={b.id}>{b.name}</option>
                    ))}
                  </select>
                )}
                <select
                  value={filterRole}
                  onChange={(e) => setFilterRole(e.target.value)}
                  className="shrink-0 h-10 px-3 rounded-[8px] border border-border bg-surface font-caption text-caption text-text-secondary outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
                >
                  <option value="all">Semua Jabatan</option>
                  <option value="karyawan">Karyawan</option>
                  <option value="admin_kasir">Admin Kasir</option>
                  <option value="maintainer">Maintainer</option>
                  <option value="owner">Owner</option>
                </select>
                <button
                  type="button"
                  onClick={() => setShowInactive((v) => !v)}
                  className={`shrink-0 h-10 px-3.5 rounded-[8px] border font-caption text-caption transition-colors ${
                    showInactive
                      ? "bg-amber-50 text-amber-700 border-amber-200"
                      : "border-border bg-surface text-text-secondary hover:bg-surface-container"
                  }`}
                >
                  {showInactive ? "Sembunyikan Nonaktif" : "Tampilkan Nonaktif"}
                </button>
              </div>

              <p className="font-caption text-caption text-text-muted">
                Menampilkan <b className="text-text-primary">{filtered.length}</b> dari {staff.length} staf
                {filterBranch !== "all" && ` • ${branches.find(b => b.id === filterBranch)?.name}`}
                {filterRole   !== "all" && ` • ${ROLE_LABELS[filterRole] ?? filterRole}`}
              </p>

              {loading ? (
                <div className="flex items-center justify-center py-12">
                  <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                </div>
              ) : (
                <StaffManagement
                  staff={filtered}
                  branches={branches}
                  bisaUbahJabatan={session.role === "owner" || session.role === "maintainer"}
                  bisaHapus={session.role === "owner" || session.role === "maintainer"}
                />
              )}
            </TabsContent>

            {bisaKelolaStaf && (
              <TabsContent value="tambah" className="px-gutter py-4 flex flex-col gap-4">
                <div className="flex items-center justify-between p-3.5 rounded-[8px] bg-brand-50 border border-brand-200 text-brand-800">
                  <div className="flex items-center gap-2.5">
                    <div className="w-9 h-9 rounded-[6px] bg-brand-500/10 flex items-center justify-center text-brand-600 shrink-0">
                      <Icon name="table_view" className="text-[20px]" />
                    </div>
                    <div className="text-left min-w-0">
                      <p className="font-caption text-caption font-semibold">Punya banyak data staf?</p>
                      <p className="font-micro-badge text-micro-badge text-brand-700/80">Import sekaligus dari file Excel (.xlsx / .csv)</p>
                    </div>
                  </div>
                  <Link
                    href="/import?type=staff"
                    className="px-3.5 py-2 rounded-[8px] bg-brand-600 text-white font-caption text-caption flex items-center gap-1 shrink-0 hover:bg-brand-700 transition-colors shadow-sm"
                  >
                    <Icon name="upload" className="text-[16px]" />
                    Import Excel
                  </Link>
                </div>
                <StaffCreateForm branches={branches} />
              </TabsContent>
            )}
          </Tabs>
        </div>

        {/* Desktop: 2-column grid */}
        <div className="hidden lg:grid lg:grid-cols-3 lg:gap-6 lg:items-start lg:px-gutter lg:py-6">
          {/* LEFT - daftar staf */}
          <div className="lg:col-span-1 flex flex-col gap-3">
            <h2 className="font-headline-3 text-headline-3 text-text-primary">Kelola Staf</h2>

            {/* Search */}
            <div className="relative">
              <Icon name="search" className="absolute left-3.5 top-1/2 -translate-y-1/2 text-text-muted text-[20px]" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Cari nama staf atau cabang..."
                className="w-full h-11 pl-11 pr-3.5 rounded-[8px] border border-border bg-surface font-body text-body text-text-primary outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
              />
            </div>

            {/* Filter bar */}
            <div className="flex flex-col gap-2">
              {isAllBranches && branches.length > 0 && (
                <select
                  value={filterBranch}
                  onChange={(e) => setFilterBranch(e.target.value)}
                  className="h-10 px-3 rounded-[8px] border border-border bg-surface font-caption text-caption text-text-secondary outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
                >
                  <option value="all">Semua Cabang</option>
                  {branches.map((b) => (
                    <option key={b.id} value={b.id}>{b.name}</option>
                  ))}
                </select>
              )}
              <select
                value={filterRole}
                onChange={(e) => setFilterRole(e.target.value)}
                className="h-10 px-3 rounded-[8px] border border-border bg-surface font-caption text-caption text-text-secondary outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
              >
                <option value="all">Semua Jabatan</option>
                <option value="karyawan">Karyawan</option>
                <option value="admin_kasir">Admin Kasir</option>
                <option value="maintainer">Maintainer</option>
                <option value="owner">Owner</option>
              </select>
              <button
                type="button"
                onClick={() => setShowInactive((v) => !v)}
                className={`h-10 px-3.5 rounded-[8px] border font-caption text-caption transition-colors text-left ${
                  showInactive
                    ? "bg-amber-50 text-amber-700 border-amber-200"
                    : "border-border bg-surface text-text-secondary hover:bg-surface-container"
                }`}
              >
                {showInactive ? "Sembunyikan Nonaktif" : "Tampilkan Nonaktif"}
              </button>
            </div>

            <p className="font-caption text-caption text-text-muted">
              Menampilkan <b className="text-text-primary">{filtered.length}</b> dari {staff.length} staf
            </p>

            {loading ? (
              <div className="flex items-center justify-center py-12">
                <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
              </div>
            ) : (
              <StaffManagement
                staff={filtered}
                branches={branches}
                bisaUbahJabatan={session.role === "owner" || session.role === "maintainer"}
                bisaHapus={session.role === "owner" || session.role === "maintainer"}
              />
            )}
          </div>

          {/* RIGHT - form tambah staf atau placeholder */}
          <div className="lg:col-span-2">
            {bisaKelolaStaf ? (
              <div className="bg-surface rounded-[10px] clay-card p-6 flex flex-col gap-4">
                <div className="flex items-center justify-between pb-2 border-b border-border">
                  <div>
                    <h2 className="font-headline-3 text-headline-3 text-text-primary">Tambah Staf Baru</h2>
                    <p className="font-caption text-caption text-text-muted mt-0.5">Input perorangan atau import data sekaligus</p>
                  </div>
                  <Link
                    href="/import?type=staff"
                    className="px-3.5 py-2 rounded-[8px] bg-brand-50 hover:bg-brand-100 text-brand-700 border border-brand-200 font-caption text-caption font-semibold flex items-center gap-1.5 transition-colors"
                  >
                    <Icon name="upload_file" className="text-[18px]" />
                    Import Data Excel
                  </Link>
                </div>
                <StaffCreateForm branches={branches} />
              </div>
            ) : (
              <div className="bg-surface rounded-[10px] clay-card p-8 flex flex-col items-center justify-center gap-3 text-center min-h-[300px]">
                <Icon name="manage_accounts" className="text-[48px] text-text-tertiary" />
                <p className="font-body-bold text-body-bold text-text-primary">
                  Panel Manajemen Staf
                </p>
                <p className="font-caption text-caption text-text-muted max-w-xs">
                  Pilih staf dari daftar di sebelah kiri untuk melihat dan mengatur detail, atau gunakan tab Tambah Staf untuk mendaftarkan anggota baru.
                </p>
              </div>
            )}
          </div>
        </div>
      </main>
      <BottomNav role={session.role} />
    </div>
  );
}
