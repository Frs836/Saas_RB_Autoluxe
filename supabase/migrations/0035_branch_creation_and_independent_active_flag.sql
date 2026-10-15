-- 0035_branch_creation_and_independent_active_flag.sql
--
-- Dua masalah pada pengaturan cabang.
--
-- 1. Menyimpan apa pun gagal kalau ada staf aktif
--    Fungsi update_branch_settings menolak seluruh permintaan kalau sakelar
--    aktif dimatikan sementara cabang masih punya staf. Padahal yang diminta
--    biasanya hanya nama, deskripsi, atau titik koordinat. Satu field yang
--    gagal membatalkan semuanya, jadi tidak ada satu pun yang bisa diubah.
--
--    Pemeriksaan staf aktif dipindah ke fungsi tersendiri. Simpanan nama,
--    alamat, koordinat, dan jam selalu berhasil, dan hanya sakelar aktif
--    yang bisa ditolak, dengan pesan yang menyebut jumlahnya.
--
-- 2. Tidak ada cara membuat cabang
--    Hanya ada fungsi untuk mengubah cabang yang sudah ada. Tidak ada
--    Tidak ada jalur untuk membuat, sehingga tidak ada tombol tambah cabang di
--    antarmuka, dan cabang kedua tidak pernah bisa dibuat.
--
--    Skema sudah siap: branches punya koordinat, radius, jam operasional,
--    jam kantor, dan ambang kecocokan wajah. profiles, orders, dan tabel lain
--    sudah menunjuk branch_id. Yang belum ada hanya jalan masuknya.

-- ---------------------------------------------------------------------------
-- 1. Simpanan tidak lagi gagal gara-gara sakelar aktif
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.update_branch_settings(
  p_branch_id uuid,
  p_branch_name text,
  p_address text,
  p_latitude numeric DEFAULT NULL::numeric,
  p_longitude numeric DEFAULT NULL::numeric,
  p_radius_meters numeric DEFAULT NULL::numeric,
  p_open_time time DEFAULT NULL::time,
  p_close_time time DEFAULT NULL::time,
  p_set_coordinates boolean DEFAULT false,
  p_is_active boolean DEFAULT NULL::boolean
)
RETURNS branches
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_profile  uuid;
  v_branch   public.branches%rowtype;
  v_name     text;
  v_latitude numeric;
  v_longitude numeric;
  v_row      public.branches%rowtype;
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN
    RAISE EXCEPTION 'Konfigurasi cabang hanya bisa diubah pengguna yang sudah masuk.';
  END IF;

  v_profile := (SELECT public.current_profile_id());
  IF v_profile IS NULL THEN
    RAISE EXCEPTION 'Sesi tidak valid.';
  END IF;

  IF NOT COALESCE((
    SELECT public.has_role(array['owner', 'maintainer']::public.user_role[])
  ), false) THEN
    RAISE EXCEPTION 'Hanya owner dan maintainer yang bisa mengubah konfigurasi cabang.';
  END IF;

  SELECT * INTO v_branch FROM public.branches WHERE id = p_branch_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cabang tidak ditemukan.';
  END IF;

  v_name := NULLIF(btrim(coalesce(p_branch_name, '')), '');
  IF v_name IS NULL THEN
    RAISE EXCEPTION 'Nama cabang wajib diisi.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.branches b
     WHERE lower(b.branch_name) = lower(v_name)
       AND b.id <> p_branch_id
  ) THEN
    RAISE EXCEPTION 'Sudah ada cabang bernama "%".', v_name;
  END IF;

  IF p_open_time IS NOT NULL AND p_close_time IS NOT NULL THEN
    IF p_close_time <= p_open_time THEN
      RAISE EXCEPTION 'Jam tutup harus lebih besar dari jam buka.';
    END IF;
  END IF;

  IF COALESCE(p_set_coordinates, false) THEN
    IF p_latitude IS NULL OR p_longitude IS NULL THEN
      RAISE EXCEPTION 'Latitude dan longitude wajib diisi saat geofence diaktifkan.';
    END IF;

    IF p_latitude < -90 OR p_latitude > 90 THEN
      RAISE EXCEPTION 'Latitude harus antara -90 sampai 90.';
    END IF;

    IF p_longitude < -180 OR p_longitude > 180 THEN
      RAISE EXCEPTION 'Longitude harus antara -180 sampai 180.';
    END IF;

    IF p_latitude = 0 AND p_longitude = 0 THEN
      RAISE EXCEPTION 'Koordinat 0,0 bukan lokasi workshop.';
    END IF;

    v_latitude := p_latitude;
    v_longitude := p_longitude;
  ELSE
    v_latitude := NULL;
    v_longitude := NULL;
  END IF;

  IF v_latitude IS NOT NULL THEN
    IF p_radius_meters IS NULL OR p_radius_meters < 5 OR p_radius_meters > 5000 THEN
      RAISE EXCEPTION 'Radius geofence harus antara 5 sampai 5000 meter.';
    END IF;
  END IF;

  UPDATE public.branches
     SET branch_name            = v_name,
         address                = COALESCE(NULLIF(btrim(COALESCE(p_address, '')), ''), ''),
         latitude               = v_latitude,
         longitude              = v_longitude,
         geofence_radius_meters = CASE
                                   WHEN v_latitude IS NULL THEN 30
                                   ELSE round(p_radius_meters, 2)
                                 END,
         operating_open_time    = COALESCE(p_open_time, v_branch.operating_open_time),
         operating_close_time   = COALESCE(p_close_time, v_branch.operating_close_time),
         updated_at             = now()
   WHERE id = p_branch_id
  RETURNING * INTO v_row;

  /*
   * Sakelar aktif sengaja tidak ikut di sini.
   *
   * Sebelumnya sakelar ini ikut di parameter yang sama, dan kalau dimatikan
   * sementara masih ada staf, seluruh permintaan ditolak. Nama, deskripsi,
   * dan koordinat ikut hilang padahal tidak ada hubungannya dengan staffing.
   * Sekarang keduanya terpisah: perubahan data selalu tersimpan, dan hanya
   *status aktif yang punya syarat sendiri lewat set_branch_active.
   */
  IF p_is_active IS NOT NULL AND p_is_active <> v_branch.is_active THEN
    PERFORM public.set_branch_active(p_branch_id, p_is_active);
    SELECT * INTO v_row FROM public.branches WHERE id = p_branch_id;
  END IF;

  RETURN v_row;
END;
$function$;

-- ---------------------------------------------------------------------------
-- Sakelar aktif, terpisah supaya syaratnya tidak mencemari simpanan lain
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_branch_active(
  p_branch_id uuid,
  p_active    boolean
)
RETURNS public.branches
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_staff integer;
  v_row   public.branches%rowtype;
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN
    RAISE EXCEPTION 'Konfigurasi cabang hanya bisa diubah pengguna yang sudah masuk.';
  END IF;

  IF NOT COALESCE((
    SELECT public.has_role(array['owner', 'maintainer']::public.user_role[])
  ), false) THEN
    RAISE EXCEPTION 'Hanya owner dan maintainer yang bisa mengubah status cabang.';
  END IF;

  IF NOT p_active THEN
    SELECT count(*) INTO v_staff
      FROM public.profiles
     WHERE branch_id = p_branch_id
       AND is_active;

    IF v_staff > 0 THEN
      -- Pinat ada di daftar siapa, supaya tidak hanya jumurnya.
      RAISE EXCEPTION 'Cabang masih punya % staf aktif: %. Pindahkan mereka ke cabang lain atau nonaktifkan akunnya lebih dulu.',
        v_staff,
        (SELECT string_agg(pp.full_name, ', ' ORDER BY pp.full_name)
           FROM public.profiles pp
          WHERE pp.branch_id = p_branch_id AND pp.is_active);
    END IF;
  END IF;

  UPDATE public.branches
     SET is_active = p_active, updated_at = now()
   WHERE id = p_branch_id
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cabang tidak ditemukan.';
  END IF;

  RETURN v_row;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 2. Membuat cabang
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_branch(
  p_branch_name text,
  p_address text DEFAULT '',
  p_latitude numeric DEFAULT NULL::numeric,
  p_longitude numeric DEFAULT NULL::numeric,
  p_radius_meters numeric DEFAULT 30,
  p_open_time time DEFAULT '07:30'::time,
  p_close_time time DEFAULT '21:00'::time,
  p_office_open_time time DEFAULT '10:00'::time,
  p_office_close_time time DEFAULT '18:00'::time,
  p_face_match_threshold double precision DEFAULT 0.8
)
RETURNS public.branches
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_profile uuid;
  v_name   text;
  v_row    public.branches%rowtype;
  v_ambang double precision;
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN
    RAISE EXCEPTION 'Cabang hanya bisa dibuat pengguna yang sudah masuk.';
  END IF;

  v_profile := (SELECT public.current_profile_id());
  IF v_profile IS NULL THEN
    RAISE EXCEPTION 'Sesi tidak valid.';
  END IF;

  IF NOT COALESCE((
    SELECT public.has_role(array['owner', 'maintainer']::public.user_role[])
  ), false) THEN
    RAISE EXCEPTION 'Hanya owner dan maintainer yang bisa membuat cabang baru.';
  END IF;

  v_name := NULLIF(btrim(COALESCE(p_branch_name, '')), '');
  IF v_name IS NULL THEN
    RAISE EXCEPTION 'Nama cabang wajib diisi.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.branches WHERE lower(branch_name) = lower(v_name)
  ) THEN
    RAISE EXCEPTION 'Sudah ada cabang bernama "%".', v_name;
  END IF;

  IF p_close_time <= p_open_time THEN
    RAISE EXCEPTION 'Jam tutup harus lebih besar dari jam buka.';
  END IF;

  IF p_office_close_time <= p_office_open_time THEN
    RAISE EXCEPTION 'Jam pulang kantor harus lebih besar dari jam masuk kantor.';
  END IF;

  IF p_latitude IS NOT NULL OR p_longitude IS NOT NULL THEN
    IF p_latitude IS NULL OR p_longitude IS NULL THEN
      RAISE EXCEPTION 'Isi latitude dan longitude, atau kosongkan keduanya.';
    END IF;

    IF p_latitude < -90 OR p_latitude > 90 THEN
      RAISE EXCEPTION 'Latitude harus antara -90 sampai 90.';
    END IF;

    IF p_longitude < -180 OR p_longitude > 180 THEN
      RAISE EXCEPTION 'Longitude harus antara -180 sampai 180.';
    END IF;

    IF p_latitude = 0 AND p_longitude = 0 THEN
      RAISE EXCEPTION 'Koordinat 0,0 bukan lokasi workshop.';
    END IF;
  END IF;

  IF p_radius_meters IS NULL OR p_radius_meters < 5 OR p_radius_meters > 5000 THEN
    RAISE EXCEPTION 'Radius geofence harus antara 5 sampai 5000 meter.';
  END IF;

  v_ambang := COALESCE(p_face_match_threshold, 0.8);
  IF v_ambang < 0.5 OR v_ambang > 0.99 THEN
    RAISE EXCEPTION 'Ambang kecocokan wajah harus antara 0,5 sampai 0,99.';
  END IF;

  INSERT INTO public.branches (
    branch_name, address, latitude, longitude, geofence_radius_meters,
    operating_open_time, operating_close_time,
    office_open_time, office_close_time, face_match_threshold, is_active
  ) VALUES (
    v_name, COALESCE(NULLIF(btrim(COALESCE(p_address, '')), ''), ''),
    p_latitude, p_longitude, p_radius_meters,
    p_open_time, p_close_time,
    p_office_open_time, p_office_close_time, v_ambang, true
  )
  RETURNING * INTO v_row;

  INSERT INTO public.activity_logs (actor_id, action, entity, entity_id, metadata)
  VALUES (
    v_profile, 'branch.created', 'branches', v_row.id,
    jsonb_build_object(
      'nama', v_name,
      'latitude', p_latitude,
      'longitude', p_longitude,
      'radius', p_radius_meters,
      'lapangan', p_open_time::text || '-' || p_close_time::text,
      'kantor', p_office_open_time::text || '-' || p_office_close_time::text
    )
  );

  RETURN v_row;
END;
$function$;

REVOKE ALL ON FUNCTION public.create_branch(text, text, numeric, numeric, numeric, time, time, time, time, double precision) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_branch(text, text, numeric, numeric, numeric, time, time, time, time, double precision) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_branch_active(uuid, boolean) TO authenticated;