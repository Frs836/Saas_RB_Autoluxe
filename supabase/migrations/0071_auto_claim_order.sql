-- 0071: allow free karyawan to claim queued order without team (auto-assign as lead)
--
-- Problem: start_order_work requires team to be pre-assigned. Free karyawan
-- cannot claim a queued order without team.
--
-- Fix: Modify start_order_work to auto-assign caller as lead when:
--   - Order is queued
--   - No team assigned yet
--   - Caller is free karyawan (not in another order)
--   - Caller is in the same branch

CREATE OR REPLACE FUNCTION public.start_order_work(p_order_id uuid)
RETURNS public.order_status
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_profile_id uuid;
  v_is_staff   boolean;
  v_order      public.orders%rowtype;
  v_next       public.order_status;
  v_team       uuid[];
  v_caller_busy boolean;
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN
    RAISE EXCEPTION 'Order hanya bisa diubah oleh pengguna yang sudah masuk.';
  END IF;

  v_profile_id := (SELECT public.current_profile_id());
  IF v_profile_id IS NULL THEN
    RAISE EXCEPTION 'Sesi tidak valid.';
  END IF;

  v_is_staff := COALESCE((
    SELECT public.has_role(ARRAY['owner', 'admin_kasir', 'maintainer']::public.user_role[])
  ), false);

  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order tidak ditemukan.';
  END IF;

  IF NOT COALESCE(public.can_access_branch(v_order.branch_id), false) THEN
    RAISE EXCEPTION 'Order ini berada di luar cabang Anda.';
  END IF;

  IF NOT v_is_staff THEN
    IF v_order.created_by IS DISTINCT FROM v_profile_id
       AND NOT EXISTS (
         SELECT 1 FROM public.order_team_members t
          WHERE t.order_id = v_order.id AND t.profile_id = v_profile_id
       ) THEN
      RAISE EXCEPTION 'Anda hanya bisa memulai order yang Anda buat atau menjadi anggota timnya.';
    END IF;
  END IF;

  -- Ambil tim yang sudah ada (jika ada)
  SELECT array_agg(t.profile_id) INTO v_team
    FROM public.order_team_members t
    JOIN public.profiles p ON p.id = t.profile_id
   WHERE t.order_id = v_order.id
     AND p.is_active
     AND p.role = 'karyawan'::public.user_role;

  -- Cek apakah caller sudah sibuk di order lain
  SELECT EXISTS (
    SELECT 1 FROM public.orders o
    JOIN public.order_team_members t ON t.order_id = o.id
    WHERE t.profile_id = v_profile_id
      AND o.status IN ('in_progress', 'qc_review')
      AND o.id <> p_order_id
  ) INTO v_caller_busy;

  -- Jika belum ada tim, coba auto-assign caller sebagai lead
  IF array_length(v_team, 1) IS NULL THEN
    -- Harus karyawan (bukan staff)
    IF v_is_staff THEN
      RAISE EXCEPTION 'Staff tidak bisa auto-claim order. Assign tim dulu lewat "Atur Tim".';
    END IF;

    -- Caller harus free (tidak di order lain)
    IF v_caller_busy THEN
      RAISE EXCEPTION 'Anda masih mengerjakan unit lain. Selesaikan dulu sebelum claim order baru.';
    END IF;

    -- Caller harus di cabang yang sama
    IF NOT EXISTS (
      SELECT 1 FROM public.profiles
       WHERE id = v_profile_id
         AND branch_id = v_order.branch_id
         AND role = 'karyawan'::public.user_role
         AND is_active
    ) THEN
      RAISE EXCEPTION 'Anda tidak termasuk karyawan cabang order ini.';
    END IF;

    -- Caller tidak boleh sudah di tim order ini (redundan tapi aman)
    IF EXISTS (
      SELECT 1 FROM public.order_team_members
       WHERE order_id = v_order.id AND profile_id = v_profile_id
    ) THEN
      RAISE EXCEPTION 'Anda sudah berada di tim order ini.';
    END IF;

    -- Auto-assign caller sebagai lead
    INSERT INTO public.order_team_members (order_id, profile_id, is_lead)
    VALUES (v_order.id, v_profile_id, true);

    v_team := ARRAY[v_profile_id];
  END IF;

  -- Validasi tim tidak kosong
  IF array_length(v_team, 1) IS NULL THEN
    RAISE EXCEPTION 'Pilih minimal satu teknisi aktif sebelum memulai pengerjaan.';
  END IF;

  -- Cek status order
  IF v_order.status <> 'queued'::public.order_status THEN
    RAISE EXCEPTION 'Order hanya bisa dimulai dari status Dalam Antrean.';
  END IF;

  -- Cek ketersediaan semua teknisi di tim
  PERFORM public.assert_staff_available(p_order_id, v_team);

  PERFORM pg_catalog.set_config('app.trusted_order_write', 'on', true);

  UPDATE public.orders
     SET status     = 'in_progress'::public.order_status,
         started_by = v_profile_id,
         started_at = now()
   WHERE id = v_order.id
  RETURNING status INTO v_next;

  PERFORM pg_catalog.set_config('app.trusted_order_write', 'off', true);

  RETURN v_next;
END;
$function$;

REVOKE ALL ON FUNCTION public.start_order_work(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.start_order_work(uuid) TO authenticated;