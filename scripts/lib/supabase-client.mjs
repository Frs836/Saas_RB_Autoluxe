/**
 * Klien Supabase untuk pengujian integrasi.
 *
 * Satu proses membuat satu klien per akun uji dan Ingkeeperannya di memori
 * supaya setiap pemeriksaan RLS benar-benar dievaluasi terhadap sesi role itu,
 * bukan terhadap sesi service role.
 */
import { createClient } from "@supabase/supabase-js";

export function makeAuthClient(url, anonKey) {
  return createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function makeAdminClient(url, serviceRoleKey) {
  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function loginAs(url, anonKey, account) {
  const client = makeAuthClient(url, anonKey);
  const { data, error } = await client.auth.signInWithPassword({
    email: account.email,
    password: account.password,
  });

  if (error) {
    throw new Error(`Gagal login ${account.role} (${account.email}): ${error.message}`);
  }

  return { client, role: account.role, email: account.email, userId: data.user.id };
}

export async function profileIdOf(client) {
  const {
    data: { user },
  } = await client.auth.getUser();

  const { data, error } = await client
    .from("profiles")
    .select("id, branch_id, role")
    .eq("auth_id", user.id)
    .maybeSingle();

  if (error) throw new Error(`Gagal membaca profile: ${error.message}`);
  return data;
}

/** Nilai kembalian RPC yang selalu berupa objek tunggal, bukan array. */
export function singleRow(result) {
  const { data, error } = result;
  if (error) throw error;
  return Array.isArray(data) ? (data[0] ?? null) : data;
}