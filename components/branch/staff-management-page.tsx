"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { StaffManagement } from "@/components/branch/staff-management";
import { StaffCreateForm } from "@/components/branch/staff-create-form";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { BottomNav } from "@/components/dashboard/bottom-nav";
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

export function StaffManagementPage({ session, branches, branchId }: Props) {
  const [activeTab, setActiveTab] = useState<"kelola" | "tambah">("kelola");
  const [staff, setStaff] = useState<ManagedStaff[]>([]);
  const [loading, setLoading] = useState(true);

  const branchOptions = branches.map((b) => ({ id: b.id, name: b.name }));

  const handleTabChange = (value: string) => {
    if (value === "kelola" || value === "tambah") {
      setActiveTab(value as "kelola" | "tambah");
    }
  };

  // Fetch staff data on mount
  useEffect(() => {
    async function fetchStaff() {
      if (!session || !branchId) {
        setStaff([]);
        setLoading(false);
        return;
      }
      const supabase = createClient();
      const { data, error } = await supabase
        .from("profiles")
        .select("id, full_name, role, branch_id, work_schedule, is_active, default_off_day, avatar_path, face_verification")
        .eq("branch_id", branchId)
        .eq("is_active", true)
        .order("full_name");

      if (error) {
        console.error("Failed to fetch staff:", error);
        setStaff([]);
      } else {
        const mapped = (data ?? []).map((p) => ({
          id: p.id,
          fullName: p.full_name ?? "Staf",
          role: p.role ?? "karyawan",
          roleLabel: p.role === "owner" ? "Pemilik" : p.role === "admin_kasir" ? "Admin Kasir" : p.role === "maintainer" ? "Maintainer" : "Karyawan",
          branchId: p.branch_id,
          branchName: branches.find((b) => b.id === p.branch_id)?.name ?? "Cabang Utama",
          workSchedule: p.work_schedule ?? "field",
          isActive: p.is_active ?? true,
          defaultOffDay: p.default_off_day,
          facePhotoUrl: p.avatar_path ? `/storage/v1/object/public/profile-avatars/${p.avatar_path}` : null,
          faceStatus: p.face_verification === "approved" ? "Terverifikasi" : p.face_verification === "pending" ? "Menunggu" : "Belum Daftar",
        }));
        setStaff(mapped);
      }
      setLoading(false);
    }
    fetchStaff();
  }, [session, branchId, branches]);

  if (!session) {
    return <div className="flex flex-col w-full min-h-screen items-center justify-center p-8">Loading...</div>;
  }

  if (loading) {
    return (
      <div className="flex flex-col w-full min-h-screen">
        <div className="flex flex-col w-full min-h-screen items-center justify-center p-8">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-brand-600" />
          <p className="mt-2 text-text-muted">Memuat data staf...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col w-full min-h-screen">
      <main className="flex-1">
        <Tabs value={activeTab} onValueChange={handleTabChange} className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="kelola">Kelola Staf</TabsTrigger>
            <TabsTrigger value="tambah">Tambah Staf</TabsTrigger>
          </TabsList>

          <TabsContent value="kelola">
            <StaffManagement
              staff={staff}
              branches={branchOptions}
              bisaUbahJabatan={session.role === "owner"}
            />
          </TabsContent>

          <TabsContent value="tambah">
            <StaffCreateForm branches={branchOptions} />
          </TabsContent>
        </Tabs>
      </main>
      <BottomNav role={session.role} />
    </div>
  );
}