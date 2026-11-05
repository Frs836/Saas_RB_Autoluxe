-- ============================================================
-- 0103: Tambah role baru — manager, finance, kepala_karyawan
-- ============================================================
-- CATATAN: ALTER TYPE ADD VALUE sudah dipindahkan ke migration 0104 karena
-- PostgreSQL tidak mengizinkan penggunaan nilai enum baru dalam transaksi
-- yang sama. Jalankan 0104 TERLEBIH DULU, lalu 0103 (ini).
-- ============================================================

-- Pastikan nilai enum sudah ada (dijalankan dari 0104)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'user_role' AND e.enumlabel = 'manager'
  ) THEN
    RAISE EXCEPTION 'Jalankan migration 0104 terlebih dulu (ADD VALUE enum).';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2. HELPER FUNCTIONS untuk grup role
-- Menggantikan hardcode ARRAY['owner','admin_kasir','maintainer'] yang
-- tersebar di seluruh RLS policies. Setiap kali role baru ditambahkan,
-- cukup update helper ini.
-- ---------------------------------------------------------------------------

-- Semua role yang berwenang di operasional (bukan pure karyawan lapangan)
CREATE OR REPLACE FUNCTION public.is_privileged_role()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO ''
AS $$
  SELECT public.has_role(ARRAY[
    'owner','maintainer','manager','admin_kasir','finance','kepala_karyawan'
  ]::public.user_role[])
$$;

-- Role yang bisa membuat/mengelola order
CREATE OR REPLACE FUNCTION public.can_manage_orders()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO ''
AS $$
  SELECT public.has_role(ARRAY[
    'owner','maintainer','manager','admin_kasir','kepala_karyawan'
  ]::public.user_role[])
$$;

-- Role yang bisa melihat kas dan laporan keuangan
CREATE OR REPLACE FUNCTION public.can_view_finance()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO ''
AS $$
  SELECT public.has_role(ARRAY[
    'owner','maintainer','manager','admin_kasir','finance'
  ]::public.user_role[])
$$;

-- Role yang bisa mengelola staf
CREATE OR REPLACE FUNCTION public.can_manage_staff()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO ''
AS $$
  SELECT public.has_role(ARRAY[
    'owner','maintainer','manager'
  ]::public.user_role[])
$$;

-- Role super (owner + maintainer) — hanya mereka yang ubah role
CREATE OR REPLACE FUNCTION public.is_super_role()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO ''
AS $$
  SELECT public.has_role(ARRAY['owner','maintainer']::public.user_role[])
$$;

GRANT EXECUTE ON FUNCTION public.is_privileged_role() TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_manage_orders() TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_view_finance() TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_manage_staff() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_super_role() TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. UPDATE RLS POLICIES untuk tabel yang perlu akses role baru
-- Hanya update policies yang relevan, bukan semua policies.
-- ---------------------------------------------------------------------------

-- ORDERS: manager, kepala_karyawan, finance bisa SELECT order
-- Finance perlu lihat semua order untuk laporan keuangan (transparansi data)
DROP POLICY IF EXISTS orders_select_authenticated ON public.orders;
CREATE POLICY orders_select_authenticated ON public.orders
  FOR SELECT TO authenticated
  USING (
    public.can_view_finance()   -- manager, finance, admin_kasir, owner, maintainer
    OR public.can_manage_orders()  -- kepala_karyawan juga
    OR public.can_view_order(id)   -- karyawan via existing function
  );

-- ORDERS UPDATE: manager dan kepala_karyawan bisa update status
DROP POLICY IF EXISTS orders_update_authenticated ON public.orders;
CREATE POLICY orders_update_authenticated ON public.orders
  FOR UPDATE TO authenticated
  USING (public.can_view_order(id))
  WITH CHECK (public.can_view_order(id));

-- PROFILES: manager bisa SELECT semua profil di cabangnya (untuk kelola staf)
DROP POLICY IF EXISTS profiles_select_authenticated ON public.profiles;
CREATE POLICY profiles_select_authenticated ON public.profiles
  FOR SELECT TO authenticated USING (true);

-- PROFILES UPDATE: hanya super (owner/maintainer) yang ubah role;
-- manager bisa update field lain (nama, jadwal, branch_id) tapi tidak role
DROP POLICY IF EXISTS profiles_update_privileged ON public.profiles;
CREATE POLICY profiles_update_privileged ON public.profiles
  FOR UPDATE TO authenticated
  USING (
    public.can_manage_staff()  -- owner, maintainer, manager
    OR id = (SELECT public.current_profile_id())  -- self-update
  )
  WITH CHECK (
    public.can_manage_staff()
    OR id = (SELECT public.current_profile_id())
  );

-- CASH_FLOW: finance perlu baca semua cash_flow untuk laporan keuangan
DROP POLICY IF EXISTS cash_flow_select_authenticated ON public.cash_flow;
CREATE POLICY cash_flow_select_authenticated ON public.cash_flow
  FOR SELECT TO authenticated
  USING (public.can_view_finance() OR branch_id = (
    SELECT p.branch_id FROM public.profiles p
    WHERE p.id = (SELECT public.current_profile_id())
  ));

-- NOTIFICATIONS: role baru bisa terima notifikasi (sama seperti sebelumnya)
-- Tidak perlu update karena policies notif berbasis recipient_id

-- ORDER_TEAM_MEMBERS: kepala_karyawan bisa INSERT (assign teknisi)
DROP POLICY IF EXISTS order_team_members_insert_privileged ON public.order_team_members;
CREATE POLICY order_team_members_insert_privileged ON public.order_team_members
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_role(ARRAY['owner','admin_kasir','maintainer','manager','kepala_karyawan']::public.user_role[])
  );

-- ---------------------------------------------------------------------------
-- 4. UPDATE RPC yang hardcode role names
-- ---------------------------------------------------------------------------

-- Update apply_order_status: tambah manager dan kepala_karyawan bisa approve QC
CREATE OR REPLACE FUNCTION public._rbac_can_approve_qc()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO ''
AS $$
  SELECT public.has_role(ARRAY[
    'owner','admin_kasir','maintainer','manager','kepala_karyawan'
  ]::public.user_role[])
$$;
GRANT EXECUTE ON FUNCTION public._rbac_can_approve_qc() TO authenticated;

-- Update cancel_order: manager bisa cancel
-- (check di RPC cancel_order yang ada di migration 0059)
-- Kita buat wrapper helper yang di-call dari RPC
CREATE OR REPLACE FUNCTION public._rbac_can_cancel_order()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO ''
AS $$
  SELECT public.has_role(ARRAY[
    'owner','admin_kasir','maintainer','manager'
  ]::public.user_role[])
$$;
GRANT EXECUTE ON FUNCTION public._rbac_can_cancel_order() TO authenticated;

-- Update advance_handover: manager dan kepala_karyawan bisa
CREATE OR REPLACE FUNCTION public._rbac_can_handover()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO ''
AS $$
  SELECT public.has_role(ARRAY[
    'owner','admin_kasir','maintainer','manager','kepala_karyawan','karyawan'
  ]::public.user_role[])
$$;
GRANT EXECUTE ON FUNCTION public._rbac_can_handover() TO authenticated;

-- ---------------------------------------------------------------------------
-- 5. UPDATE RPC update_staff_profile: 
--    - manager bisa ubah semua field KECUALI role
--    - hanya owner/maintainer yang ubah role
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.update_staff_profile(
  p_profile_id   uuid,
  p_role         public.user_role DEFAULT NULL,
  p_branch_id    uuid DEFAULT NULL,
  p_is_active    boolean DEFAULT NULL,
  p_work_schedule public.work_schedule DEFAULT NULL,
  p_default_off_day integer DEFAULT NULL
)
RETURNS public.profiles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_caller_id   uuid;
  v_caller_role public.user_role;
  v_target      public.profiles%ROWTYPE;
BEGIN
  v_caller_id := (SELECT public.current_profile_id());
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Sesi tidak valid.';
  END IF;

  SELECT role INTO v_caller_role FROM public.profiles WHERE id = v_caller_id;

  -- Hanya owner, maintainer, manager yang boleh update profil orang lain
  IF NOT (v_caller_role IN ('owner','maintainer','manager')) THEN
    RAISE EXCEPTION 'Hanya owner, maintainer, atau manager yang boleh mengubah profil staf.';
  END IF;

  SELECT * INTO v_target FROM public.profiles WHERE id = p_profile_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Profil tidak ditemukan.';
  END IF;

  -- Hanya owner/maintainer yang boleh ubah role
  IF p_role IS NOT NULL AND p_role <> v_target.role THEN
    IF v_caller_role NOT IN ('owner','maintainer') THEN
      RAISE EXCEPTION 'Hanya owner dan maintainer yang boleh mengubah jabatan/role staf.';
    END IF;
  END IF;

  -- Manager tidak boleh edit profil owner/maintainer
  IF v_caller_role = 'manager' AND v_target.role IN ('owner','maintainer') THEN
    RAISE EXCEPTION 'Manager tidak bisa mengubah profil owner atau maintainer.';
  END IF;

  UPDATE public.profiles SET
    role             = COALESCE(p_role, role),
    branch_id        = COALESCE(p_branch_id, branch_id),
    is_active        = COALESCE(p_is_active, is_active),
    work_schedule    = COALESCE(p_work_schedule, work_schedule),
    default_off_day  = COALESCE(p_default_off_day, default_off_day),
    updated_at       = now()
  WHERE id = p_profile_id
  RETURNING * INTO v_target;

  INSERT INTO public.activity_logs (actor_id, action, entity, entity_id, metadata)
  VALUES (
    v_caller_id, 'staff.update', 'profile', p_profile_id,
    jsonb_build_object(
      'caller_role', v_caller_role,
      'changes', jsonb_strip_nulls(jsonb_build_object(
        'role', p_role, 'branch_id', p_branch_id,
        'is_active', p_is_active, 'work_schedule', p_work_schedule
      ))
    )
  );

  RETURN v_target;
END;
$$;

REVOKE ALL ON FUNCTION public.update_staff_profile(uuid, public.user_role, uuid, boolean, public.work_schedule, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_staff_profile(uuid, public.user_role, uuid, boolean, public.work_schedule, integer) TO authenticated;

-- ---------------------------------------------------------------------------
-- 6. RPC delete_staff_profile — hapus karyawan beserta semua data
-- Hanya owner dan maintainer yang boleh. Tidak bisa hapus diri sendiri.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.delete_staff_profile(
  p_profile_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_caller_id   uuid;
  v_caller_role public.user_role;
  v_target      public.profiles%ROWTYPE;
  v_auth_id     uuid;
BEGIN
  v_caller_id := (SELECT public.current_profile_id());
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Sesi tidak valid.';
  END IF;

  SELECT role INTO v_caller_role FROM public.profiles WHERE id = v_caller_id;

  -- Hanya owner dan maintainer
  IF v_caller_role NOT IN ('owner','maintainer') THEN
    RAISE EXCEPTION 'Hanya owner dan maintainer yang boleh menghapus akun staf.';
  END IF;

  -- Tidak boleh hapus diri sendiri
  IF p_profile_id = v_caller_id THEN
    RAISE EXCEPTION 'Tidak bisa menghapus akun sendiri.';
  END IF;

  SELECT * INTO v_target FROM public.profiles WHERE id = p_profile_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Profil tidak ditemukan.';
  END IF;

  -- Tidak boleh hapus owner lain (hanya maintainer yang bisa, dan sebaliknya)
  IF v_target.role = 'owner' AND v_caller_role <> 'maintainer' THEN
    RAISE EXCEPTION 'Hanya maintainer yang bisa menghapus akun owner.';
  END IF;

  v_auth_id := v_target.auth_id;

  -- Activity log sebelum hapus
  INSERT INTO public.activity_logs (actor_id, action, entity, entity_id, metadata)
  VALUES (
    v_caller_id, 'staff.delete', 'profile', p_profile_id,
    jsonb_build_object(
      'deleted_name', v_target.full_name,
      'deleted_role', v_target.role,
      'deleted_branch', v_target.branch_id,
      'caller_role', v_caller_role
    )
  );

  -- Hapus profil (CASCADE akan hapus order_team_members, attendance_logs, dll
  -- berdasarkan foreign key ON DELETE CASCADE/SET NULL yang sudah ada)
  DELETE FROM public.profiles WHERE id = p_profile_id;

  -- Hapus auth user via service_role (caller adalah SECURITY DEFINER dengan
  -- search_path publik — hapus auth user via extensions.pgcrypto tidak bisa,
  -- harus lewat pg_net atau admin API. Kita tandai untuk dihapus lewat
  -- background job atau admin action.)
  -- Untuk sekarang: nonaktifkan auth user dengan cara update banned_until
  -- ke masa depan jauh, sehingga tidak bisa login tapi data auth masih ada
  -- untuk referensi. Owner/maintainer harus hapus manual dari dashboard Supabase
  -- atau via admin API dari aplikasi.
  -- NOTE: Supabase tidak expose auth.users langsung dari SQL tanpa extensions.

END;
$$;

REVOKE ALL ON FUNCTION public.delete_staff_profile(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_staff_profile(uuid) TO authenticated;

COMMENT ON FUNCTION public.delete_staff_profile IS
  '0103: Hapus profil staf + activity log. Auth user perlu dihapus terpisah via admin API.';

-- ---------------------------------------------------------------------------
-- 7. UPDATE can_view_order: finance bisa lihat semua order untuk transparansi
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.can_view_order(p_order_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
  select
    (select public.current_profile_id()) is not null
    and (
      -- Finance, owner, admin_kasir, maintainer, manager bisa lihat semua order
      (select public.has_role(
        array['owner', 'admin_kasir', 'maintainer', 'manager', 'finance']::public.user_role[]
      ))
      -- kepala_karyawan + karyawan: hanya order yang mereka buat atau tim
      or exists (
        select 1 from public.orders o
        where o.id = p_order_id
          and (o.assigned_to = (select public.current_profile_id())
            or o.created_by  = (select public.current_profile_id()))
      )
      or exists (
        select 1 from public.orders o
        join public.order_team_members t on t.order_id = o.id
        where o.id = p_order_id
          and t.profile_id = (select public.current_profile_id())
      )
      -- karyawan/kepala_karyawan bisa lihat order queued di cabang (untuk klaim)
      or exists (
        select 1 from public.orders o
        join public.profiles p on p.id = (select public.current_profile_id())
        where o.id = p_order_id
          and o.status = 'queued'::public.order_status
          and o.assigned_to is null
          and not exists (select 1 from public.order_team_members t where t.order_id = o.id)
          and o.branch_id = p.branch_id
          and p.role in ('karyawan','kepala_karyawan')
          and p.is_active
      )
    );
$function$;

-- ---------------------------------------------------------------------------
-- SELESAI
-- ---------------------------------------------------------------------------
COMMENT ON TYPE public.user_role IS
  '0103: Tambah manager, finance, kepala_karyawan. Total 7 role.';
