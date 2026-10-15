"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/rbac";

export type BranchSettingsResult =
  | { ok: true; message: string }
  | { ok: false; message: string };

type Payload = {
  branchId: string;
  branchName: string;
  address: string;
  latitude: number | null;
  longitude: number | null;
  radiusMeters: number | null;
  openTime: string;
  closeTime: string;
  setCoordinates: boolean;
  /**
   * null berarti status aktif tidak ikut diubah.
   *
   * Sakelar ini punya syarat sendiri, yaitu tidak boleh dimatikan sementara
   * masih ada staf. Kalau ikut dikirim bersama data lain, kegagalan di
   * sakelar membatalkan seluruh simpanan, termasuk nama, deskripsi, dan
   * koordinat yang tidak ada hubungannya dengan staffing.
   */
  isActive: boolean | null;
};

export async function saveBranchSettings(payload: Payload): Promise<BranchSettingsResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("auth_id", user.id)
    .maybeSingle();

  if (!profile || !can(profile.role, "branch.manage")) {
    return {
      ok: false,
      message: "Hanya owner dan maintainer yang bisa mengubah konfigurasi cabang.",
    };
  }

  const toTime = (value: string) => (value.includes(":") ? value : `${value}:00`);

  const { error } = await supabase.rpc("update_branch_settings", {
    p_branch_id: payload.branchId,
    p_branch_name: payload.branchName,
    p_address: payload.address,
    p_latitude: payload.latitude,
    p_longitude: payload.longitude,
    p_radius_meters: payload.radiusMeters,
    p_open_time: toTime(payload.openTime),
    p_close_time: toTime(payload.closeTime),
    p_set_coordinates: payload.setCoordinates,
    p_is_active: payload.isActive,
  });

  if (error) {
    return { ok: false, message: error.message };
  }

  revalidatePath("/pengaturan/cabang");
  revalidatePath("/", "layout");

  return { ok: true, message: "Konfigurasi cabang tersimpan." };
}