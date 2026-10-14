-- 0028_face_threshold_and_liveness.sql
--
-- Ambang kemiripan 80 persen, dapat diatur per cabang, dan catatan liveness.
--
-- Latar
-- -----
-- Vektor identitas sekarang berasal dari titik landmark MediaPipe, bukan lagi
-- gambar abu-abu 16x16. Panjang vektor berubah dari 256 menjadi 1434, jadi
-- semua sampel yang terdaftar sebelum perubahan ini tidak lagi bisa dipakai
-- dan staf harus mendaftar ulang. Pesan errornya disebutkan supaya tidak
--muncul sebagai kegagalan yang tidak dijelaskan.
--
-- Ambang memakai 0,8. Angka itu dapat di atur per cabang karena kondisi
-- pencahayaan berbeda antara ruangan bengkel dan gudang. Staff yang lebih
-- tinggi berarti lebih sulit lolos, lebih rendah berarti lebih mudah tetapi
-- juga lebih rawan salah kena orang.
--
-- Liveness dicatat terpisah dari kemiripan. Kedip yang tercatat tidak
-- membuktikan segalanya, tapi tanpa itu foto yang dipegang di depan kamera
-- bisa lolos selama Descriptor-nya mirip.

-- ---------------------------------------------------------------------------
-- 1. Ambang per cabang
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'branches'
       AND column_name = 'face_match_threshold'
  ) THEN
    ALTER TABLE public.branches
      ADD COLUMN face_match_threshold double precision NOT NULL DEFAULT 0.8;
  END IF;
END;
$$;

-- Panjang vektor yang sah. Sampel dengan panjang lain ditolak dengan
-- penjelasan, bukan diam-diam dianggap tidak cocok.
CREATE OR REPLACE FUNCTION public.face_descriptor_length()
RETURNS integer
LANGUAGE sql
IMMUTABLE
SET search_path TO ''
AS $function$ SELECT 1434::integer; $function$;

CREATE OR REPLACE FUNCTION public.face_liveness_threshold()
RETURNS double precision
LANGUAGE sql
IMMUTABLE
SET search_path TO ''
AS $function$ SELECT 0.8::double precision; $function$;

-- Catatan liveness pada absensi.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'attendance_logs'
       AND column_name = 'face_liveness_passed'
  ) THEN
    ALTER TABLE public.attendance_logs
      ADD COLUMN face_liveness_passed boolean NOT NULL DEFAULT false;
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- 2. Pendaftaran menolak vektor dengan panjang yang tidak dikenal
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_face_descriptor(
  p_descriptor double precision[],
  p_photo_url  text DEFAULT NULL
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_profile uuid;
  v_len integer;
BEGIN
  v_profile := public.current_profile_id();
  IF v_profile IS NULL THEN
    RAISE EXCEPTION 'Profil tidak ditemukan atau tidak aktif.' USING errcode = '42501';
  END IF;

  v_len := array_length(p_descriptor, 1);
  IF p_descriptor IS NULL OR v_len IS NULL OR v_len < 32 THEN
    RAISE EXCEPTION 'Sampel wajah tidak valid.';
  END IF;

  IF v_len <> public.face_descriptor_length() THEN
    RAISE EXCEPTION
      'Format sampel wajah sudah berubah. Pendaftaran ulang diperlukan untuk memakai pemindaian wajah yang sekarang.'
      USING errcode = '22023';
  END IF;

  IF p_photo_url IS NULL OR btrim(p_photo_url) = '' THEN
    RAISE EXCEPTION 'Foto referensi wajib diunggah saat pendaftaran wajah.';
  END IF;

  UPDATE public.profiles
     SET face_descriptor = p_descriptor,
         face_reference_photo_url = p_photo_url,
         face_registered_at = now(),
         face_verification = 'pending'::public.face_verification_status,
         face_review_note = NULL,
         face_reviewed_at = NULL,
         face_reviewed_by = NULL,
         updated_at = now()
   WHERE id = v_profile;

  INSERT INTO public.activity_logs (actor_id, action, entity, entity_id, metadata)
  VALUES (
    v_profile, 'profile.face_registered', 'profiles', v_profile,
    jsonb_build_object('dimensions', v_len, 'has_reference_photo', true)
  );

  RETURN true;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 3. Absen: ambang per cabang dan liveness wajib
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.attendance_check_in(
  p_latitude         double precision,
  p_longitude        double precision,
  p_accuracy_meters  double precision   DEFAULT NULL,
  p_photo_url        text              DEFAULT NULL,
  p_face_descriptor  double precision[] DEFAULT NULL,
  p_liveness_passed  boolean           DEFAULT false,
  p_late_reason      text              DEFAULT NULL
)
RETURNS attendance_logs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_profile        uuid;
  v_branch         uuid;
  v_branch_lat     double precision;
  v_branch_lng     double precision;
  v_radius         double precision;
  v_open           time;
  v_threshold      double precision;
  v_date           date;
  v_local_time     time;
  v_distance       double precision;
  v_late_minutes   integer := 0;
  v_reason         text;
  v_face_status    public.face_verification_status;
  v_stored         double precision[];
  v_similarity     double precision;
  v_existing       public.attendance_logs;
  v_row            public.attendance_logs;
BEGIN
  v_profile := public.current_profile_id();
  IF v_profile IS NULL THEN
    RAISE EXCEPTION 'Profil tidak ditemukan atau tidak aktif.' USING errcode = '42501';
  END IF;

  SELECT p.branch_id INTO v_branch FROM public.profiles p WHERE p.id = v_profile;
  IF v_branch IS NULL THEN
    RAISE EXCEPTION 'Profil Anda belum terhubung ke cabang.';
  END IF;

  v_face_status := public.face_status(v_profile);
  IF v_face_status IS NULL THEN
    RAISE EXCEPTION 'Sampel wajah belum terdaftar. Daftarkan terlebih dahulu pada halaman absensi.'
      USING errcode = '42501';
  END IF;

  IF v_face_status = 'rejected'::public.face_verification_status THEN
    RAISE EXCEPTION 'Sampel wajah Anda ditolak maintainer. Silakan mendaftarkan ulang.'
      USING errcode = '42501';
  END IF;

  IF v_face_status <> 'approved'::public.face_verification_status THEN
    RAISE EXCEPTION 'Sampel wajah Anda belum diverifikasi maintainer.'
      USING errcode = '42501';
  END IF;

  SELECT p.face_descriptor INTO v_stored
    FROM public.profiles p WHERE p.id = v_profile;

  -- Sampel lama dengan panjang 256 sudah tidak berlaku.
  IF v_stored IS NULL
     OR array_length(v_stored, 1) IS DISTINCT FROM public.face_descriptor_length() THEN
    RAISE EXCEPTION
      'Sampel wajah Anda terdaftar dengan format lama. Silakan daftar ulang di halaman absensi.'
      USING errcode = '42501';
  END IF;

  IF p_face_descriptor IS NULL OR array_length(p_face_descriptor, 1) IS NULL THEN
    RAISE EXCEPTION
      'Wajah belum dipindai. Absensi tidak dapat dicatat tanpa scan wajah.'
      USING errcode = '42501';
  END IF;

  IF array_length(p_face_descriptor, 1) <> public.face_descriptor_length() THEN
    RAISE EXCEPTION 'Hasil pindai wajah tidak sesuai dengan format yang terdaftar.'
      USING errcode = '22023';
  END IF;

  IF NOT COALESCE(p_liveness_passed, false) THEN
    RAISE EXCEPTION
      'Liveness belum terpenuhi. Kedipkan mata satu kali saat diminta lalu ulangi pemindaian.'
      USING errcode = '42501';
  END IF;

  SELECT b.latitude, b.longitude, b.geofence_radius_meters,
         b.operating_open_time, b.face_match_threshold
    INTO v_branch_lat, v_branch_lng, v_radius, v_open, v_threshold
    FROM public.branches b
   WHERE b.id = v_branch;

  v_threshold := COALESCE(v_threshold, public.face_liveness_threshold());

  IF v_branch_lat IS NULL OR v_branch_lng IS NULL THEN
    RAISE EXCEPTION 'Koordinat cabang belum dikonfigurasi oleh owner atau maintainer.';
  END IF;

  IF p_latitude IS NULL OR p_longitude IS NULL THEN
    RAISE EXCEPTION 'Koordinat GPS perangkat tidak tersedia.';
  END IF;

  v_distance := public.haversine_meters(v_branch_lat, v_branch_lng, p_latitude, p_longitude);
  v_radius := COALESCE(v_radius, 30.0);
  IF v_distance > v_radius THEN
    RAISE EXCEPTION 'Anda berada % meter dari cabang, di luar radius toleransi % meter.',
      pg_catalog.round(v_distance)::int, pg_catalog.round(v_radius)::int
      USING errcode = '22023';
  END IF;

  v_similarity := public.face_similarity(p_face_descriptor, v_stored);

  IF v_similarity IS NULL OR v_similarity < v_threshold THEN
    RAISE EXCEPTION
      'Wajah tidak cocok dengan sampel yang terdaftar. Kemiripan % persen, ambang % persen. Coba lagi di bawah cahaya yang lebih terang dandan wajah menghadap lurus ke kamera.',
      pg_catalog.round(v_similarity * 100)::int,
      pg_catalog.round(v_threshold * 100)::int
      USING errcode = '42501';
  END IF;

  v_date := (now() at time zone 'Asia/Jakarta')::date;
  v_local_time := (now() at time zone 'Asia/Jakarta')::time;
  IF v_open IS NOT NULL AND v_local_time > v_open THEN
    v_late_minutes := greatest(
      0,
      pg_catalog.floor(pg_catalog.date_part('epoch', v_local_time - v_open) / 60)::int
    );
  END IF;

  v_reason := nullif(btrim(coalesce(p_late_reason, '')), '');
  IF v_late_minutes > 0 AND length(coalesce(v_reason, '')) < 5 THEN
    RAISE EXCEPTION 'Alasan keterlambatan wajib diisi (minimal 5 karakter).';
  END IF;

  SELECT * INTO v_existing
    FROM public.attendance_logs a
   WHERE a.profile_id = v_profile AND a.date = v_date;

  IF found THEN
    IF v_existing.clock_in IS NOT NULL THEN
      RAISE EXCEPTION 'Anda sudah melakukan check-in hari ini.';
    ELSE
      RAISE EXCEPTION 'Hari ini sudah tercatat kehadiran dengan status %.', v_existing.status;
    END IF;
  END IF;

  INSERT INTO public.attendance_logs (
    profile_id, date, clock_in, gps_lat, gps_lng, gps_accuracy_meters,
    face_photo_url, face_similarity_score, face_liveness_passed,
    status, notes, late_minutes, late_reason
  ) VALUES (
    v_profile, v_date, now(), p_latitude, p_longitude, p_accuracy_meters,
    p_photo_url, v_similarity, true,
    'hadir',
    CASE WHEN v_late_minutes > 0 THEN v_reason ELSE NULL END,
    v_late_minutes, v_reason
  )
  RETURNING * INTO v_row;

  INSERT INTO public.activity_logs (actor_id, action, entity, entity_id, metadata)
  VALUES (
    v_profile, 'attendance.check_in', 'attendance_logs', v_row.id,
    jsonb_build_object(
      'late_minutes', v_late_minutes,
      'distance_m', pg_catalog.round(v_distance)::int,
      'face_similarity', pg_catalog.round(v_similarity * 1000) / 1000,
      'face_threshold', v_threshold,
      'face_liveness', true,
      'face_matched_server_side', true
    )
  );

  RETURN v_row;
END;
$function$;

-- Overload tanpa liveness dicabut agar tidak ada jalur yang melewatinya.
REVOKE ALL ON FUNCTION public.attendance_check_in(
  double precision, double precision, double precision, text, double precision[], text
) FROM PUBLIC, anon, authenticated;
DROP FUNCTION IF EXISTS public.attendance_check_in(
  double precision, double precision, double precision, text, double precision[], text
);

GRANT EXECUTE ON FUNCTION public.attendance_check_in(
  double precision, double precision, double precision, text, double precision[], boolean, text
) TO authenticated;

-- Batas ambang dipasang di kolom supaya tidak bisa diisi angka yang membuat
-- pemeriksaan jadi tidak berarti.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'branches_face_threshold_range'
  ) THEN
    ALTER TABLE public.branches
      ADD CONSTRAINT branches_face_threshold_range
      CHECK (face_match_threshold >= 0.5 AND face_match_threshold <= 0.99);
  END IF;
END;
$$;
