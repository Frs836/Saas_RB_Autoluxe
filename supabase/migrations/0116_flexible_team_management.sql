-- 0116_flexible_team_management.sql
-- Flexible Team Management: tambah/lepas anggota tim order yang sedang berjalan.
-- Memperbolehkan kepala_karyawan mengelola tim.

-- ---------------------------------------------------------------------------
-- A1. Kolom tambahan di order_team_members (opsional, untuk audit)
-- ---------------------------------------------------------------------------
ALTER TABLE public.order_team_members
  ADD COLUMN IF NOT EXISTS left_at timestamptz,
  ADD COLUMN IF NOT EXISTS left_reason text;
-- CATATAN: tidak pakai is_active karena primary key (order_id, profile_id)
-- sudah mencegah duplikat — cukup hapus baris saat keluar dan log ke activity_logs

-- ---------------------------------------------------------------------------
-- A2. add_order_team_member: tambah anggota ke order yang sedang berjalan
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.add_order_team_member(
  p_order_id    uuid,
  p_profile_ids uuid[]
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_order_branch uuid;
  v_order_status public.order_status;
  v_ids          uuid[] := COALESCE(p_profile_ids, ARRAY[]::uuid[]);
  v_id           uuid;
  v_role         public.user_role;
  v_aktif        boolean;
  v_branch       uuid;
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN
    RAISE EXCEPTION 'Hanya pengguna yang sudah masuk yang bisa menambah anggota tim.';
  END IF;

  IF NOT COALESCE((SELECT public.has_role(
       ARRAY['owner','admin_kasir','maintainer','manager','kepala_karyawan']::public.user_role[])), false) THEN
    RAISE EXCEPTION 'Hanya owner, admin kasir, maintainer, manager, dan kepala karyawan yang bisa menambah anggota tim.';
  END IF;

  SELECT branch_id, status INTO v_order_branch, v_order_status
    FROM public.orders
   WHERE id = p_order_id
     FOR UPDATE;

  IF v_order_branch IS NULL THEN
    RAISE EXCEPTION 'Order tidak ditemukan.';
  END IF;

  IF v_order_status NOT IN ('in_progress'::public.order_status, 'qc_review'::public.order_status) THEN
    RAISE EXCEPTION 'Anggota hanya bisa ditambahkan ke order yang sedang dikerjakan (in_progress atau qc_review).';
  END IF;

  IF NOT COALESCE(public.can_access_branch(v_order_branch), false) THEN
    RAISE EXCEPTION 'Order ini berada di luar cabang Anda.';
  END IF;

  IF array_length(v_ids, 1) IS NULL THEN
    RETURN;
  END IF;

  FOREACH v_id IN ARRAY v_ids LOOP
    SELECT p.role, p.is_active, p.branch_id
      INTO v_role, v_aktif, v_branch
      FROM public.profiles p
     WHERE p.id = v_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Profil tidak ditemukan untuk id %', v_id;
    END IF;

    IF NOT COALESCE(v_aktif, false) THEN
      RAISE EXCEPTION 'Karyawan sudah tidak aktif dan tidak bisa ditugaskan.';
    END IF;

    IF v_role NOT IN ('karyawan'::public.user_role, 'kepala_karyawan'::public.user_role) THEN
      RAISE EXCEPTION 'Tim order hanya bisa diisi oleh karyawan atau kepala karyawan.';
    END IF;

    IF v_branch IS DISTINCT FROM v_order_branch THEN
      RAISE EXCEPTION 'Karyawan yang dipilih berada di cabang lain dari order ini.';
    END IF;

    -- Skip jika sudah ada di tim (bukan error)
    IF EXISTS (
      SELECT 1 FROM public.order_team_members
       WHERE order_id = p_order_id AND profile_id = v_id
    ) THEN
      CONTINUE;
    END IF;
  END LOOP;

  -- Cek ketersediaan semua profil yang belum di tim
  PERFORM public.assert_staff_available(
    p_order_id,
    ARRAY(
      SELECT v_id2
        FROM unnest(v_ids) AS v_id2
       WHERE NOT EXISTS (
         SELECT 1 FROM public.order_team_members
          WHERE order_id = p_order_id AND profile_id = v_id2
       )
    )
  );

  -- Insert yang belum ada
  INSERT INTO public.order_team_members (order_id, profile_id, is_lead)
  SELECT p_order_id, new_id, false
    FROM unnest(v_ids) AS new_id
   WHERE NOT EXISTS (
     SELECT 1 FROM public.order_team_members
      WHERE order_id = p_order_id AND profile_id = new_id
   );

  INSERT INTO public.activity_logs (actor_id, action, entity, entity_id, metadata)
  VALUES (
    public.current_profile_id(),
    'order.team_member_added',
    'orders', p_order_id,
    jsonb_build_object(
      'order_number', (SELECT order_number FROM public.orders WHERE id = p_order_id),
      'branch_id', v_order_branch,
      'added_profiles', to_jsonb(v_ids)
    )
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.add_order_team_member(uuid, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.add_order_team_member(uuid, uuid[]) TO authenticated;

-- ---------------------------------------------------------------------------
-- A3. remove_order_team_member: lepas anggota dari order yang sedang berjalan
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.remove_order_team_member(
  p_order_id   uuid,
  p_profile_id uuid,
  p_reason     text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_order_branch uuid;
  v_order_status public.order_status;
  v_is_lead      boolean;
  v_new_lead     uuid;
  v_member_count integer;
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN
    RAISE EXCEPTION 'Hanya pengguna yang sudah masuk yang bisa melepas anggota tim.';
  END IF;

  IF NOT COALESCE((SELECT public.has_role(
       ARRAY['owner','admin_kasir','maintainer','manager','kepala_karyawan']::public.user_role[])), false) THEN
    RAISE EXCEPTION 'Hanya owner, admin kasir, maintainer, manager, dan kepala karyawan yang bisa melepas anggota tim.';
  END IF;

  SELECT branch_id, status INTO v_order_branch, v_order_status
    FROM public.orders
   WHERE id = p_order_id
     FOR UPDATE;

  IF v_order_branch IS NULL THEN
    RAISE EXCEPTION 'Order tidak ditemukan.';
  END IF;

  IF v_order_status NOT IN ('in_progress'::public.order_status, 'qc_review'::public.order_status) THEN
    RAISE EXCEPTION 'Anggota hanya bisa dilepas dari order yang sedang dikerjakan (in_progress atau qc_review).';
  END IF;

  IF NOT COALESCE(public.can_access_branch(v_order_branch), false) THEN
    RAISE EXCEPTION 'Order ini berada di luar cabang Anda.';
  END IF;

  -- Hitung anggota yang tersisa setelah penghapusan
  SELECT COUNT(*) INTO v_member_count
    FROM public.order_team_members
   WHERE order_id = p_order_id
     AND profile_id <> p_profile_id;

  IF v_member_count < 1 THEN
    RAISE EXCEPTION 'Tidak bisa melepas anggota: harus ada minimal 1 anggota tim yang tersisa.';
  END IF;

  -- Cek apakah yang dihapus adalah lead
  SELECT is_lead INTO v_is_lead
    FROM public.order_team_members
   WHERE order_id = p_order_id AND profile_id = p_profile_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Anggota tidak ditemukan dalam tim order ini.';
  END IF;

  -- Jika lead dihapus, promote anggota pertama lainnya
  IF COALESCE(v_is_lead, false) THEN
    SELECT profile_id INTO v_new_lead
      FROM public.order_team_members
     WHERE order_id = p_order_id
       AND profile_id <> p_profile_id
     ORDER BY profile_id
     LIMIT 1;

    UPDATE public.order_team_members
       SET is_lead = true
     WHERE order_id = p_order_id
       AND profile_id = v_new_lead;

    PERFORM pg_catalog.set_config('app.trusted_order_write', 'on', true);
    UPDATE public.orders
       SET assigned_to = v_new_lead
     WHERE id = p_order_id;
    PERFORM pg_catalog.set_config('app.trusted_order_write', 'off', true);
  END IF;

  DELETE FROM public.order_team_members
   WHERE order_id = p_order_id
     AND profile_id = p_profile_id;

  INSERT INTO public.activity_logs (actor_id, action, entity, entity_id, metadata)
  VALUES (
    public.current_profile_id(),
    'order.team_member_removed',
    'orders', p_order_id,
    jsonb_build_object(
      'order_number', (SELECT order_number FROM public.orders WHERE id = p_order_id),
      'branch_id', v_order_branch,
      'removed_profile', p_profile_id,
      'reason', COALESCE(p_reason, 'Dilepas dari tim'),
      'was_lead', COALESCE(v_is_lead, false),
      'new_lead', v_new_lead
    )
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.remove_order_team_member(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.remove_order_team_member(uuid, uuid, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- A4. Update set_order_team: izinkan kepala_karyawan dan manager
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_order_team(
  p_order_id uuid,
  p_profile_ids uuid[]
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_order_branch uuid;
  v_ids          uuid[] := COALESCE(p_profile_ids, ARRAY[]::uuid[]);
  v_lead         uuid;
BEGIN
  v_lead := v_ids[1];

  IF (SELECT auth.uid()) IS NULL THEN
    RAISE EXCEPTION 'Penugasan tim hanya bisa dilakukan oleh pengguna yang sudah masuk.';
  END IF;

  IF NOT COALESCE((SELECT public.has_role(
       ARRAY['owner','admin_kasir','maintainer','manager','kepala_karyawan']::public.user_role[])), false) THEN
    RAISE EXCEPTION 'Hanya owner, admin kasir, maintainer, manager, dan kepala karyawan yang bisa menugaskan tim.';
  END IF;

  SELECT branch_id INTO v_order_branch
    FROM public.orders WHERE id = p_order_id
     FOR UPDATE;

  IF v_order_branch IS NULL THEN
    RAISE EXCEPTION 'Order tidak ditemukan.';
  END IF;

  IF NOT COALESCE(public.can_access_branch(v_order_branch), false) THEN
    RAISE EXCEPTION 'Order ini berada di luar cabang Anda.';
  END IF;

  PERFORM public.assert_order_team(v_order_branch, v_ids);
  PERFORM public.assert_staff_available(p_order_id, v_ids);

  DELETE FROM public.order_team_members WHERE order_id = p_order_id;

  INSERT INTO public.order_team_members (order_id, profile_id, is_lead)
  SELECT p_order_id, member, member = v_lead
    FROM unnest(v_ids) AS member;

  PERFORM pg_catalog.set_config('app.trusted_order_write', 'on', true);
  UPDATE public.orders
     SET assigned_to = v_lead
   WHERE id = p_order_id;
  PERFORM pg_catalog.set_config('app.trusted_order_write', 'off', true);

  INSERT INTO public.activity_logs (actor_id, action, entity, entity_id, metadata)
  VALUES (
    public.current_profile_id(),
    'order.team_assigned',
    'orders', p_order_id,
    jsonb_build_object(
      'order_number', (SELECT order_number FROM public.orders WHERE id = p_order_id),
      'branch_id', v_order_branch,
      'team', to_jsonb(v_ids),
      'lead', v_lead
    )
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.set_order_team(uuid, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_order_team(uuid, uuid[]) TO authenticated;

-- ---------------------------------------------------------------------------
-- A5. Update assert_order_team: izinkan kepala_karyawan sebagai anggota tim
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.assert_order_team(
  p_branch uuid,
  p_ids uuid[]
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_target uuid;
  v_role   public.user_role;
  v_aktif  boolean;
  v_branch uuid;
BEGIN
  FOREACH v_target IN ARRAY COALESCE(p_ids, ARRAY[]::uuid[]) LOOP
    SELECT p.role, p.is_active, p.branch_id
      INTO v_role, v_aktif, v_branch
      FROM public.profiles p
     WHERE p.id = v_target;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Karyawan tidak ditemukan.';
    END IF;

    IF NOT COALESCE(v_aktif, false) THEN
      RAISE EXCEPTION 'Karyawan sudah tidak aktif dan tidak bisa ditugaskan.';
    END IF;

    IF v_role NOT IN ('karyawan'::public.user_role, 'kepala_karyawan'::public.user_role) THEN
      RAISE EXCEPTION 'Tim order hanya bisa diisi oleh karyawan atau kepala karyawan.';
    END IF;

    IF v_branch IS DISTINCT FROM p_branch THEN
      RAISE EXCEPTION 'Karyawan yang dipilih berada di cabang lain dari order ini.';
    END IF;
  END LOOP;
END;
$function$;

REVOKE ALL ON FUNCTION public.assert_order_team(uuid, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.assert_order_team(uuid, uuid[]) TO authenticated;
