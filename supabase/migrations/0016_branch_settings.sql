-- ============================================================================
-- RB AUTOLUXE - Migrasi 0016: Konfigurasi Cabang & Geofence Manual
-- Proyek: qidtfssldidzvehssevk  |  Tanggal: 2026-10-13
-- Sifat: NON-DESTRUKTIF & IDEMPOTEN.
--
-- Latar:
--   1. Policy branches_maintainer_update hanya mengizinkan role maintainer.
--      Owner justru tidak bisa mengubah konfigurasi cabang meski mandate
--      multi-cabang menyebut keduanya memegang kendali. Policy itu diganti
--      oleh RPC yang memvalidasi isi koordinat dan jam operasional.
--
--   2. Geofence diisi dari sensor GPS perangkat. Indoor atau pada perangkat
--      lama koordinat bisa menyimpang jauh sehingga absensi tertolak. Karena
--      itu setter koordinat harus menerima nilai yang diketik manual dari
--      Google Maps, dengan validasi rentang yang tegas.
--
--   3. INSERT dan DELETE cabang tetap khusus maintainer karena keduanya
--      perubahan struktural yang berdampak ke seluruh data historis.
-- ============================================================================

set search_path = public;

-- ---------------------------------------------------------------------------
-- 1. Ganti policy update dengan yang menyertakan owner
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS branches_maintainer_update ON public.branches;

CREATE POLICY branches_officer_update
  ON public.branches FOR UPDATE TO authenticated
  USING ((SELECT public.has_role(ARRAY['owner', 'maintainer']::public.user_role[])))
  WITH CHECK ((SELECT public.has_role(ARRAY['owner', 'maintainer']::public.user_role[])));

-- ---------------------------------------------------------------------------
-- 2. RPC konfigurasi cabang
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.update_branch_settings(
  p_branch_id          uuid,
  p_branch_name        text,
  p_address            text,
  p_latitude           numeric DEFAULT NULL,
  p_longitude          numeric DEFAULT NULL,
  p_radius_meters      numeric DEFAULT NULL,
  p_open_time          time    DEFAULT NULL,
  p_close_time         time    DEFAULT NULL,
  p_set_coordinates    boolean  DEFAULT FALSE,
  p_is_active          boolean  DEFAULT NULL
)
RETURNS public.branches
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_profile uuid;
  v_branch  public.branches%rowtype;
  v_name    text;
  v_staff   integer;
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN
    RAISE EXCEPTION 'Konfigurasi cabang hanya bisa diubah pengguna yang sudah masuk.';
  END IF;

  v_profile := (SELECT public.current_profile_id());
  IF v_profile IS NULL THEN
    RAISE EXCEPTION 'Sesi tidak valid.';
  END IF;

  IF NOT COALESCE((
    SELECT public.has_role(ARRAY['owner', 'maintainer']::public.user_role[])
  ), false) THEN
    RAISE EXCEPTION 'Hanya owner dan maintainer yang bisa mengubah konfigurasi cabang.';
  END IF;

  SELECT * INTO v_branch FROM public.branches WHERE id = p_branch_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cabang tidak ditemukan.';
  END IF;

  v_name := NULLIF(btrim(COALESCE(p_branch_name, '')), '');
  IF v_name IS NULL THEN
    RAISE EXCEPTION 'Nama cabang wajib diisi.';
  END IF;

  -- Nama cabang unik. Pesan error menyebut nama yang bentrok supaya operator
  -- tidak perlu menebak menukar nama mana.
  IF EXISTS (
    SELECT 1 FROM public.branches b
     WHERE lower(b.branch_name) = lower(v_name)
       AND b.id <> p_branch_id
  ) THEN
    RAISE EXCEPTION 'Sudah ada cabang bernama "%".', v_name;
  END IF;

  -- Jam operasional harus berurutan dan di dalam rentang workshop.
  IF p_open_time IS NOT NULL AND p_close_time IS NOT NULL THEN
    IF p_close_time <= p_open_time THEN
      RAISE EXCEPTION 'Jam tutup harus lebih besar dari jam buka.';
    END IF;
    IF p_open_time < time '00:00' OR p_close_time > time '23:59' THEN
      RAISE EXCEPTION 'Jam operasional berada di luar rentang yang sah.';
    END IF;
  END IF;

  IF p_radius_meters IS NOT NULL THEN
    IF p_radius_meters < 5 OR p_radius_meters > 5000 THEN
      RAISE EXCEPTION 'Radius geofence harus antara 5 sampai 5000 meter.';
    END IF;
  END IF;

  -- Set koordinat hanya bila diminta. Latitude NULL berarti geofence sengaja
  -- dimatikan untuk cabang itu, bukan sekadar belum diisi.
  IF p_set_coordinates THEN
    IF p_latitude IS NULL OR p_longitude IS NULL THEN
      RAISE EXCEPTION 'Latitude dan longitude wajib diisi bersamaan.';
    END IF;
    IF p_latitude < -90 OR p_latitude > 90 THEN
      RAISE EXCEPTION 'Latitude harus berada antara -90 sampai 90.';
    END IF;
    IF p_longitude < -180 OR p_longitude > 180 THEN
      RAISE EXCEPTION 'Longitude harus berada antara -180 sampai 180.';
    END IF;
    -- Toleransi 0 dan sama sekali tidak toleran berarti titik asal; kemungkinan
    -- besar operator belum benar-benar menyalin koordinat.
    IF p_latitude = 0 AND p_longitude = 0 THEN
      RAISE EXCEPTION 'Koordinat 0,0 berarti lokasi DEFAULT. Salin koordinat yang benar dari Google Maps.';
    END IF;
  END IF;

  -- Nonaktifkan hanya bila tidak ada staf aktif yang tersisa di sana, supaya
  -- orang tidak terjebak tanpa cabang.
  IF p_is_active IS FALSE AND v_branch.is_active THEN
    SELECT count(*) INTO v_staff
      FROM public.profiles p
     WHERE p.branch_id = p_branch_id
       AND p.is_active;

    IF v_staff > 0 THEN
      RAISE EXCEPTION 'Cabang masih memiliki % staf aktif. Pindahkan staf dulu sebelum menonaktifkan.', v_staff;
    END IF;
  END IF;

  UPDATE public.branches
     SET branch_name            = v_name,
         address                = COALESCE(p_address, v_branch.address),
         latitude               = CASE WHEN p_set_coordinates THEN p_latitude ELSE v_branch.latitude END,
         longitude              = CASE WHEN p_set_coordinates THEN p_longitude ELSE v_branch.longitude END,
         geofence_radius_meters = COALESCE(p_radius_meters, v_branch.geofence_radius_meters),
         operating_open_time    = COALESCE(p_open_time, v_branch.operating_open_time),
         operating_close_time   = COALESCE(p_close_time, v_branch.operating_close_time),
         is_active              = COALESCE(p_is_active, v_branch.is_active),
         updated_at             = now()
   WHERE id = p_branch_id
  RETURNING * INTO v_branch;

  INSERT INTO public.activity_logs (actor_id, action, entity, entity_id, metadata)
  VALUES (
    v_profile, 'branch.settings.update', 'branch', p_branch_id,
    jsonb_build_object(
      'name',            v_name,
      'has_coordinates', (v_branch.latitude IS NOT NULL AND v_branch.longitude IS NOT NULL),
      'radius_meters',   v_branch.geofence_radius_meters,
      'open_time',       v_branch.operating_open_time::text,
      'close_time',      v_branch.operating_close_time::text,
      'is_active',       v_branch.is_active
    )
  );

  RETURN v_branch;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 3. RPC pembacaan geofence untuk validasi koordinat di sisi klien
--    Mengembalikan titik acuan beserta status apakah sudah terpasang.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_branch_geofence(p_branch_id uuid)
RETURNS TABLE (
  branch_name        text,
  latitude           numeric,
  longitude          numeric,
  radius_meters      numeric,
  has_coordinates    boolean,
  open_time          time,
  close_time         time
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN
    RAISE EXCEPTION 'Data geofence hanya bisa dibaca pengguna yang sudah masuk.';
  END IF;

  RETURN QUERY
  -- branches.branch_name bertipe varchar(100), sedangkan parameter OUT di atas
  -- bertipe text. Postgres menolak-runtime kalau keduanya tidak identik, jadi
  -- kolomnya dicast eksplisit.
  SELECT b.branch_name::text,
         b.latitude,
         b.longitude,
         b.geofence_radius_meters,
         (b.latitude IS NOT NULL AND b.longitude IS NOT NULL),
         b.operating_open_time,
         b.operating_close_time
    FROM public.branches b
   WHERE b.id = p_branch_id
   LIMIT 1;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 4. Hak eksekusi
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.update_branch_settings(
  uuid, text, text, numeric, numeric, numeric, time, time, boolean, boolean
) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.update_branch_settings(
  uuid, text, text, numeric, numeric, numeric, time, time, boolean, boolean
) TO authenticated;

REVOKE ALL ON FUNCTION public.get_branch_geofence(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_branch_geofence(uuid) TO authenticated;