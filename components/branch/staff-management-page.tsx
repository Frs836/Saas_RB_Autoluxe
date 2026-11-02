"use client";

import { useState, useEffect, useMemo } from "react";
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
        .select("id, full_name, role, branch_id, work_schedule, is_active, default_off_day, avatar_path, face_verification")
        .order("full_name");

      // Kalau ada branchId terpilih, filter per cabang; kalau "Seluruh Cabang" ambil semua
      if (branchId) {
        query = query.eq("branch_id", branchId);
      }

      const { data, error } = await query;

      if (error) {
        setStaff([]);
      } else {
        setStaff((data ?? []).map((p) => ({
          id:           p.id,
          fullName:     p.full_name ?? "Staf",
          role:         p.role ?? "karyawan",
          roleLabel:    ROLE_LABELS[p.role ?? ""] ?? "Karyawan",
          branchId:     p.branch_id,
          branchName:   branches.find((b) => b.id === p.branch_id)?.name ?? "Cabang Utama",
          workSchedule: (p.work_schedule as "field" | "office") ?? "field",
          isActive:     p.is_active ?? true,
          defaultOffDay: p.default_off_day,
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
        <Tabs value={activeTab} onValueChange={handleTabChange} className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="kelola">Kelola Staf</TabsTrigger>
            {bisaKelolaStaf && <TabsTrigger value="tambah">Tambah Staf</TabsTrigger>}
          </TabsList>

          <TabsContent value="kelola" className="px-gutter py-4 flex flex-col gap-3">
            {/* Search */}
            <div className="relative">
              <Icon name="search" className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted text-[20px]" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Cari nama staf atau cabang..."
                className="w-full h-11 pl-10 pr-3 rounded-xl bg-surface-container-low font-body text-body text-text-primary outline-none focus:ring-2 focus:ring-brand-400"
              />
            </div>

            {/* Filter bar */}
            <div className="flex gap-2 overflow-x-auto no-scrollbar -mx-gutter px-gutter">
              {/* Filter cabang — hanya untuk lintas cabang */}
              {isAllBranches && branches.length > 0 && (
                <select
                  value={filterBranch}
                  onChange={(e) => setFilterBranch(e.target.value)}
                  className="shrink-0 h-9 px-3 rounded-full bg-surface-container-low font-caption text-caption text-text-secondary outline-none focus:ring-2 focus:ring-brand-400"
                >
                  <option value="all">Semua Cabang</option>
                  {branches.map((b) => (
                    <option key={b.id} value={b.id}>{b.name}</option>
                  ))}
                </select>
              )}

              {/* Filter role */}
              <select
                value={filterRole}
                onChange={(e) => setFilterRole(e.target.value)}
                className="shrink-0 h-9 px-3 rounded-full bg-surface-container-low font-caption text-caption text-text-secondary outline-none focus:ring-2 focus:ring-brand-400"
              >
                <option value="all">Semua Jabatan</option>
                <option value="karyawan">Karyawan</option>
                <option value="admin_kasir">Admin Kasir</option>
                <option value="maintainer">Maintainer</option>
                <option value="owner">Owner</option>
              </select>

              {/* Toggle nonaktif */}
              <button
                type="button"
                onClick={() => setShowInactive((v) => !v)}
                className={`shrink-0 h-9 px-3 rounded-full font-caption text-caption transition-colors ${
                  showInactive
                    ? "bg-warning-surface text-warning-text"
                    : "bg-surface-container-low text-text-secondary"
                }`}
              >
                {showInactive ? "Sembunyikan Nonaktif" : "Tampilkan Nonaktif"}
              </button>
            </div>

            {/* Summary badge */}
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
                bisaUbahJabatan={session.role === "owner"}
              />
            )}
          </TabsContent>

          {bisaKelolaStaf && (
            <TabsContent value="tambah" className="px-gutter py-4">
              <StaffCreateForm branches={branches} />
            </TabsContent>
          )}
        </Tabs>
      </main>
      <BottomNav role={session.role} />
    </div>
  );
}
