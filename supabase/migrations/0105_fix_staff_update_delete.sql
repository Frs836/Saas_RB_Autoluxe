-- 0105: Fix update_staff_profile overload + fix delete_staff_profile FK cascade
--
-- Bug 1: PGRST203 "Could not choose the best candidate function"
--   Migration 0103 CREATE OR REPLACE tapi versi lama masih ada karena
--   signature berbeda (ada parameter p_full_name, p_phone_number, dll).
--   Fix: DROP semua overload lama dulu, lalu CREATE satu versi canonical.
--
-- Bug 2: delete_staff_profile gagal karena notifications.created_by_fkey
--   Tabel notifications punya FK ke profiles(id) tanpa ON DELETE CASCADE.
--   Fix: hapus notifikasi milik user sebelum hapus profil.

-- ---------------------------------------------------------------------------
-- 1. DROP semua overload update_staff_profile yang ada
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.update_staff_profile(uuid, public.user_role, uuid, boolean, public.work_schedule, integer);
DROP FUNCTION IF EXISTS public.update_staff_profile(uuid, text, uuid, boolean, text, integer);
DROP FUNCTION IF EXISTS public.update_staff_profile(uuid);
-- Drop versi lama yang mungkin punya signature berbeda
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT p.oid, p.proname, pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'update_staff_profile'
  LOOP
    EXECUTE 'DROP FUNCTION IF EXISTS public.update_staff_profile(' || r.args || ')';
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 2. Satu canonical update_staff_profile
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.update_staff_profile(
  p_profile_id    uuid,
  p_role          public.user_role DEFAULT NULL,
  p_branch_id     uuid DEFAULT NULL,
  p_is_active     boolean DEFAULT NULL,
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
  IF v_caller_id IS NULL THEN RAISE EXCEPTION 'Sesi tidak valid.'; END IF;

  SELECT role INTO v_caller_role FROM public.profiles WHERE id = v_caller_id;

  IF v_caller_role NOT IN ('owner','maintainer','manager') THEN
    RAISE EXCEPTION 'Hanya owner, maintainer, atau manager yang boleh mengubah profil staf.';
  END IF;

  SELECT * INTO v_target FROM public.profiles WHERE id = p_profile_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Profil tidak ditemukan.'; END IF;

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
    role            = COALESCE(p_role, role),
    branch_id       = COALESCE(p_branch_id, branch_id),
    is_active       = COALESCE(p_is_active, is_active),
    work_schedule   = COALESCE(p_work_schedule, work_schedule),
    default_off_day = COALESCE(p_default_off_day, default_off_day),
    updated_at      = now()
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
-- 3. Fix delete_staff_profile — hapus data terkait dulu sebelum hapus profil
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.delete_staff_profile(uuid);

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
BEGIN
  v_caller_id := (SELECT public.current_profile_id());
  IF v_caller_id IS NULL THEN RAISE EXCEPTION 'Sesi tidak valid.'; END IF;

  SELECT role INTO v_caller_role FROM public.profiles WHERE id = v_caller_id;

  IF v_caller_role NOT IN ('owner','maintainer') THEN
    RAISE EXCEPTION 'Hanya owner dan maintainer yang boleh menghapus akun staf.';
  END IF;

  IF p_profile_id = v_caller_id THEN
    RAISE EXCEPTION 'Tidak bisa menghapus akun sendiri.';
  END IF;

  SELECT * INTO v_target FROM public.profiles WHERE id = p_profile_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Profil tidak ditemukan.'; END IF;

  IF v_target.role = 'owner' AND v_caller_role <> 'maintainer' THEN
    RAISE EXCEPTION 'Hanya maintainer yang bisa menghapus akun owner.';
  END IF;

  -- Activity log sebelum hapus
  INSERT INTO public.activity_logs (actor_id, action, entity, entity_id, metadata)
  VALUES (
    v_caller_id, 'staff.delete', 'profile', p_profile_id,
    jsonb_build_object(
      'deleted_name', v_target.full_name,
      'deleted_role', v_target.role::text,
      'caller_role',  v_caller_role::text
    )
  );

  -- Hapus semua data terkait secara berurutan (FK constraints)
  -- 1. Notifikasi yang dibuat oleh user ini
  DELETE FROM public.notifications    WHERE created_by = p_profile_id;
  -- 2. Notifikasi yang ditujukan ke user ini
  DELETE FROM public.notifications    WHERE recipient_id = p_profile_id;
  -- 3. Attendance logs
  DELETE FROM public.attendance_logs  WHERE profile_id = p_profile_id;
  -- 4. Time off requests
  DELETE FROM public.time_off_requests WHERE profile_id = p_profile_id;
  -- 5. Kas titipan (set null — bukan hapus, agar rekam jejak kas tetap ada)
  UPDATE public.orders SET
    cash_hold_profile_id = NULL
  WHERE cash_hold_profile_id = p_profile_id;
  -- 6. Order team members
  DELETE FROM public.order_team_members WHERE profile_id = p_profile_id;
  -- 7. Hapus profil (CASCADE akan handle sisanya)
  DELETE FROM public.profiles WHERE id = p_profile_id;

END;
$$;

REVOKE ALL ON FUNCTION public.delete_staff_profile(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_staff_profile(uuid) TO authenticated;

COMMENT ON FUNCTION public.delete_staff_profile IS
  '0105: Hapus profil staf + semua data terkait (notif, absen, tim order). Satu canonical overload update_staff_profile.';
