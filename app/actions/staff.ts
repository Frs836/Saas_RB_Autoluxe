"use server";

import { createClient } from "@/lib/supabase/server";

export type CreateStaffData = {
  fullName: string;
  email: string;
  phoneNumber?: string;
  dateOfBirth?: string;
  password: string;
  branchId?: string;
  role: "karyawan" | "admin_kasir" | "maintainer";
  workSchedule?: "field" | "office";
  isActive?: boolean;
};

export type CreateStaffResult =
  | { ok: true; data: { profile: any; authUserId: string } }
  | { ok: false; message: string };

export async function createStaffProfile(data: CreateStaffData): Promise<CreateStaffResult> {
  const supabase = await createClient();

  const { data: result, error } = await (supabase.rpc as any)("create_staff_profile", {
    p_full_name: data.fullName.trim(),
    p_email: data.email.toLowerCase().trim(),
    p_password: data.password,
    p_phone_number: data.phoneNumber?.trim() || null,
    p_date_of_birth: data.dateOfBirth || null,
    p_branch_id: data.branchId || null,
    p_role: data.role,
    p_work_schedule: data.workSchedule || "field",
    p_is_active: data.isActive ?? true,
  });

  if (error) return { ok: false, message: error.message };

  const profile = (result as any)?.profile;
  const authUserId = (result as any)?.auth_user_id;

  if (!profile || !authUserId) {
    return { ok: false, message: "Invalid response from server" };
  }

  return { ok: true, data: { profile, authUserId } };
}