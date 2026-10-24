-- 0072_team_claim_order.sql
-- Fitur: Karyawan claim order "Kerjakan Antrian Ini" + pilih rekan kerja (max 4 mobil, 3 motor)
-- Race condition fix: FOR UPDATE SKIP LOCKED + re-check status di dalam transaksi

CREATE OR REPLACE FUNCTION public.start_order_work(
  p_order_id uuid,
  p_team_ids uuid[] DEFAULT NULL
)
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
  v_max_team   integer;
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

  -- Kunci order dengan SKIP LOCKED: jika order sudah dikunci orang lain, langsung gagal cepat
  -- Ini mencegah race condition 2 karyawan klik "Kerjakan Antrian Ini" bersamaan
  SELECT * INTO v_order
  FROM public.orders
  WHERE id = p_order_id
  FOR UPDATE SKIP LOCKED;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order tidak ditemukan atau sedang diproses orang lain. Silakan refresh halaman.';
  END IF;

  IF NOT COALESCE(public.can_access_branch(v_order.branch_id), false) THEN
    RAISE EXCEPTION 'Order ini berada di luar cabang Anda.';
  END IF;

  -- Cek status order HARUS queued (masih di antrean)
  IF v_order.status <> 'queued'::public.order_status THEN
    RAISE EXCEPTION 'Order ini sudah tidak bisa dikerjakan (status: %).', v_order.status;
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

  -- Jika BELUM ada tim → ini claim baru (auto-assign caller sebagai lead + tambah rekan dari p_team_ids)
  IF array_length(v_team, 1) IS NULL THEN
    -- Harus karyawan (bukan staff)
    IF v_is_staff THEN
      RAISE EXCEPTION 'Staff tidak bisa auto-claim order. Assign tim dulu lewat "Atur Tim".';
    END IF;

    -- Caller harus free (tidak di order lain)
    IF v_caller_busy THEN
      RAISE EXCEPTION 'Anda masih mengerjakan unit lain. Selesaikan dulu sebelum claim order baru.';
    END IF;

    -- Caller harus di cabang yang sama & karyawan aktif
    IF NOT EXISTS (
      SELECT 1 FROM public.profiles
       WHERE id = v_profile_id
         AND branch_id = v_order.branch_id
         AND role = 'karyawan'::public.user_role
         AND is_active
    ) THEN
      RAISE EXCEPTION 'Anda tidak termasuk karyawan cabang order ini.';
    END IF;

    -- Tentukan max team berdasarkan ukuran kendaraan
    v_max_team := CASE
      WHEN v_order.vehicle_size::text LIKE 'Motor %' THEN 3
      ELSE 4
    END;

    -- Validasi p_team_ids (rekan kerja yang dipilih)
    IF p_team_ids IS NOT NULL AND array_length(p_team_ids, 1) > 0 THEN
      -- Batas jumlah total tim (caller + rekan)
      IF array_length(p_team_ids, 1) + 1 > v_max_team THEN
        RAISE EXCEPTION 'Maksimal % orang untuk % (termasuk Anda). Kurangi pilihan rekan kerja.',
          v_max_team,
          CASE WHEN v_order.vehicle_size::text LIKE 'Motor %' THEN 'motor' ELSE 'mobil' END;
      END IF;

      -- Semua rekan harus: karyawan aktif, cabang sama, tidak busy, bukan caller
      PERFORM public.assert_staff_available(p_order_id, p_team_ids);

      -- Cek tiap rekan tidak sama dengan caller & tidak duplikat
      IF v_profile_id = ANY(p_team_ids) THEN
        RAISE EXCEPTION 'Anda tidak bisa memilih diri sendiri sebagai rekan kerja.';
      END IF;

      -- Cek duplikat di p_team_ids
      IF (SELECT count(DISTINCT x) FROM unnest(p_team_ids) AS x) <> array_length(p_team_ids, 1) THEN
        RAISE EXCEPTION 'Ada rekan kerja yang dipilih dua kali.';
      END IF;
    END IF;

    -- Auto-assign caller sebagai lead
    INSERT INTO public.order_team_members (order_id, profile_id, is_lead)
    VALUES (v_order.id, v_profile_id, true);

    -- Tambah rekan kerja jika ada
    IF p_team_ids IS NOT NULL AND array_length(p_team_ids, 1) > 0 THEN
      INSERT INTO public.order_team_members (order_id, profile_id, is_lead)
      SELECT v_order.id, member, false
        FROM unnest(p_team_ids) AS member;
    END IF;

    -- Bangun array tim lengkap (caller di depan sebagai lead)
    v_team := ARRAY[v_profile_id] || COALESCE(p_team_ids, ARRAY[]::uuid[]);

  ELSE
    -- Sudah ada tim: caller HARUS menjadi anggota tim (atau pembuat order)
    IF NOT v_is_staff THEN
      IF v_order.created_by IS DISTINCT FROM v_profile_id
         AND NOT EXISTS (
           SELECT 1 FROM public.order_team_members t
            WHERE t.order_id = v_order.id AND t.profile_id = v_profile_id
         ) THEN
        RAISE EXCEPTION 'Anda hanya bisa memulai order yang Anda buat atau menjadi anggota timnya.';
      END IF;
    END IF;
  END IF;

  -- Validasi tim tidak kosong
  IF array_length(v_team, 1) IS NULL THEN
    RAISE EXCEPTION 'Pilih minimal satu teknisi aktif sebelum memulai pengerjaan.';
  END IF;

  -- Cek ketersediaan SEMUA teknisi di tim (termasuk caller & rekan)
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

REVOKE ALL ON FUNCTION public.start_order_work(uuid, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.start_order_work(uuid, uuid[]) TO authenticated;

-- Komentar: Overload lama (1 param) tetap jalan karena p_team_ids DEFAULT NULL
COMMENT ON FUNCTION public.start_order_work(uuid, uuid[]) IS 'Memulai pengerjaan order. Jika order queued tanpa tim, auto-assign caller sebagai lead + rekan dari p_team_ids. Race-safe dengan FOR UPDATE SKIP LOCKED.';