"use client";

import { useState } from "react";
import { StaffManagement } from "@/components/branch/staff-management";
import { StaffCreateForm } from "@/components/branch/staff-create-form";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { SubPageHeader } from "@/components/pos/sub-page-header";
import { BottomNav } from "@/components/dashboard/bottom-nav";
import { getSessionProfile } from "@/lib/rbac-guard";

interface Props {
  session: Awaited<ReturnType<typeof getSessionProfile>>;
  branches: { id: string; name: string }[];
  branchId: string | null;
}

export function StaffManagementPage({ session, branches, branchId }: Props) {
  const [activeTab, setActiveTab] = useState<"kelola" | "tambah">("kelola");

  const branchOptions = branches.map((b) => ({ id: b.id, name: b.name }));

  const handleTabChange = (value: string) => {
    if (value === "kelola" || value === "tambah") {
      setActiveTab(value as "kelola" | "tambah");
    }
  };

  if (!session) {
    return <div className="flex flex-col w-full min-h-screen items-center justify-center p-8">Loading...</div>;
  }

  return (
    <div className="flex flex-col w-full min-h-screen">
      <SubPageHeader
        title="Manajemen Staf"
        branchName={session.branchScope === "all" ? "Seluruh Cabang" : "Cabang Utama"}
        backHref="/dashboard"
      />
      <main className="flex-1">
        <Tabs value={activeTab} onValueChange={handleTabChange} className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="kelola">Kelola Staf</TabsTrigger>
            <TabsTrigger value="tambah">Tambah Staf</TabsTrigger>
          </TabsList>

          <TabsContent value="kelola">
            <StaffManagement
              staff={[]}
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