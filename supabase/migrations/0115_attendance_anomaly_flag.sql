-- 0115_attendance_anomaly_flag.sql
--
-- Deteksi anomali device fingerprint pada absensi (pertahanan berlapis
-- terhadap titip absen).
--
-- Strategi (lihat CATATAN PENTING di task):
-- 1. Tambah kolom device_fingerprint, anomaly_flag, anomaly_reason ke
--    attendance_logs (IF NOT EXISTS).
-- 2. DROP attendance_check_in lama (signature tidak bisa diubah dengan
--    CREATE OR REPLACE), lalu CREATE ulang dengan parameter baru
--    p_device_fingerprint text DEFAULT NULL. Seluruh body disalin verbatim
--    dari 0031 — logika liveness/face/geofence/schedule tidak diubah sama
--    sekali; hanya menambah parameter dan menulis device_fingerprint ke
--    daftar kolom INSERT.
-- 3. Buat fungsi baru public.flag_attendance_anomaly(p_log_id uuid) yang
--    membandingkan fingerprint baris baru dengan 3 check-in terakhir
--    (profil+cabang sama, dalam 7 hari). Jika berbeda dari semuanya, set
--    anomaly_flag = true.
-- 4. AFTER INSERT trigger memanggil flag_attendance_anomaly otomatis.

-- ---------------------------------------------------------------------------
-- 1. Kolom baru di attendance_logs
-- ---------------------------------------------------------------------------
ALTER TABLE public.attendance_logs
  ADD COLUMN IF NOT EXISTS device_fingerprint text,
  ADD COLUMN IF NOT EXISTS anomaly_flag       boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS anomaly_reason     text;

-- ---------------------------------------------------------------------------
-- 2. Ganti attendance_check_in (harus DROP karena argumen berubah)
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.attendance_check_in(
  double precision,
  double precision,
  double precision,
  text,
  double precision[],
  jsonb,
  text
);

CREATE FUNCTION public.attendance_check_in(
  p_latitude            double precision,
  p_longitude           double precision,
  p_accuracy_meters     double precision   DEFAULT NULL,
  p_photo_url           text               DEFAULT NULL,
  p_face_descriptor     double precision[] DEFAULT NULL,
  p_liveness_trace      jsonb              DEFAULT NULL,
  p_late_reason         text               DEFAULT NULL,
  p_device_fingerprint  text               DEFAULT NULL
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
  v_threshold      double precision;
  v_schedule       public.work_schedule;
  v_open           time;
  v_close          time;
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
  v_tahap          jsonb;
  v_kunci          text;
  v_urut           text[] := ARRAY[]::text[];
  v_netral         double precision[];
  v_sekarang       double precision[];
  v_selisih        double precision;
  v_yaw_netral     double precision;
  v_yaw_sekarang   double precision;
BEGIN
  v_profile := public.current_profile_id();
  IF v_profile IS NULL THEN
    RAISE EXCEPTION 'Profil tidak ditemukan atau tidak aktif.' USING errcode = '42501';
  END IF;

  SELECT p.branch_id, COALESCE(p.work_schedule, 'field'::public.work_schedule)
    INTO v_branch, v_schedule
    FROM public.profiles p WHERE p.id = v_profile;

  IF v_branch IS NULL THEN
    RAISE EXCEPTION 'Profil Anda belum terhubung ke cabang.';
  END IF;

  -- Jam yang dipakai mengikuti jadwal orang ini, bukan jam operasional umum.
  SELECT s.schedule, s.open_time, s.close_time
    INTO v_schedule, v_open, v_close
    FROM public.resolve_schedule(v_branch, v_schedule) s;

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

  SELECT p.face_descriptor INTO v_stored FROM public.profiles p WHERE p.id = v_profile;

  IF v_stored IS NULL
     OR array_length(v_stored, 1) IS DISTINCT FROM public.face_descriptor_length() THEN
    RAISE EXCEPTION
      'Sampel wajah Anda terdaftar dengan format lama. Silakan daftar ulang di halaman absensi.'
      USING errcode = '42501';
  END IF;

  IF p_face_descriptor IS NULL OR array_length(p_face_descriptor, 1) IS NULL THEN
    RAISE EXCEPTION 'Wajah belum dipindai. Absensi tidak dapat dicatat tanpa scan wajah.'
      USING errcode = '42501';
  END IF;

  IF array_length(p_face_descriptor, 1) <> public.face_descriptor_length() THEN
    RAISE EXCEPTION 'Hasil pindai wajah tidak sesuai dengan format yang terdaftar.'
      USING errcode = '22023';
  END IF;

  -- ---------------------------- Liveness ----------------------------
  IF p_liveness_trace IS NULL OR jsonb_typeof(p_liveness_trace) <> 'object' THEN
    RAISE EXCEPTION 'Bukti kehadiran tidak dikirim. Ulangi dari awal.' USING errcode = '42501';
  END IF;

  IF NOT COALESCE((p_liveness_trace->>'selesai')::boolean, false) THEN
    RAISE EXCEPTION 'Tantangan kehadiran belum selesai. Kerjakan semua tahap lalu ulangi.'
      USING errcode = '42501';
  END IF;

  FOR v_tahap IN SELECT value FROM jsonb_array_elements(p_liveness_trace->'tahap') LOOP
    v_kunci := v_tahap->>'tahap';
    IF v_kunci IS NULL THEN
      RAISE EXCEPTION 'Bukti kehadiran tidak lengkap.' USING errcode = '42501';
    END IF;
    IF v_kunci = ANY(v_urut) THEN
      RAISE EXCEPTION 'Bukti kehadiran mengandung tahap % yang berulang.', v_kunci
        USING errcode = '42501';
    END IF;
    v_urut := v_urut || v_kunci;

    IF jsonb_typeof(v_tahap->'descriptor') <> 'array' THEN
      RAISE EXCEPTION 'Bukti kehadiran tahap % tidak memuat data wajah.', v_kunci
        USING errcode = '42501';
    END IF;

    SELECT array_agg((e #>> '{}')::double precision ORDER BY ord)
      INTO v_sekarang
      FROM jsonb_array_elements(v_tahap->'descriptor') WITH ORDINALITY AS t(e, ord);

    IF array_length(v_sekarang, 1) IS DISTINCT FROM public.face_descriptor_length() THEN
      RAISE EXCEPTION 'Data wajah pada tahap % tidak lengkap.', v_kunci USING errcode = '22023';
    END IF;

    v_similarity := public.face_similarity(v_sekarang, v_stored);
    IF v_similarity IS NULL OR v_similarity < 0.5 THEN
      RAISE EXCEPTION 'Pada tahap %, wajah tidak lagi cocok dengan sampel. Ulangi dari awal.', v_kunci
        USING errcode = '42501';
    END IF;

    IF v_kunci = 'center' THEN
      v_netral := v_sekarang;
      v_yaw_netral := COALESCE((v_tahap->>'yaw')::double precision, 0);
    END IF;
  END LOOP;

  IF NOT (
    array_length(v_urut, 1) = 5
    AND v_urut[1] = 'center' AND v_urut[2] = 'blink'
    AND v_urut[3] = 'mouth'   AND v_urut[4] = 'left'
    AND v_urut[5] = 'right'
  ) THEN
    RAISE EXCEPTION 'Tahap kehadiran belum lengkap. Urutan: hadap, kedip, mulut, kiri, kanan.'
      USING errcode = '42501';
  END IF;

  IF v_netral IS NULL THEN
    RAISE EXCEPTION 'Posisi awal tidak tercatat pada bukti kehadiran.' USING errcode = '42501';
  END IF;

  FOR v_tahap IN
    SELECT value FROM jsonb_array_elements(p_liveness_trace->'tahap')
    WHERE value->>'tahap' IN ('left', 'right')
  LOOP
    v_kunci := v_tahap->>'tahap';
    SELECT array_agg((e #>> '{}')::double precision ORDER BY ord)
      INTO v_sekarang
      FROM jsonb_array_elements(v_tahap->'descriptor') WITH ORDINALITY AS t(e, ord);

    v_selisih := 1 - COALESCE(public.face_similarity(v_sekarang, v_netral), 0);
    v_yaw_sekarang := COALESCE((v_tahap->>'yaw')::double precision, 0);

    IF v_selisih < public.face_liveness_min_change() THEN
      RAISE EXCEPTION 'Gerakan pada tahap % tidak terdeteksi. selisih % persen, minimal % persen. Ulangi dari awal.',
        v_kunci,
        pg_catalog.round(v_selisih * 100)::int,
        pg_catalog.round(public.face_liveness_min_change() * 100)::int
        USING errcode = '42501';
    END IF;

    IF v_selisih > public.face_liveness_max_change() THEN
      RAISE EXCEPTION 'Gerakan pada tahap % terlalu besar, wajah mungkin keluar bingkai.', v_kunci
        USING errcode = '42501';
    END IF;

    IF v_kunci = 'left' AND (v_yaw_sekarang - v_yaw_netral) > -6 THEN
      RAISE EXCEPTION 'Tahap % tidak terdeteksi. Putar kepala ke kiri, bukan ke kanan.', v_kunci
        USING errcode = '42501';
    END IF;
    IF v_kunci = 'right' AND (v_yaw_sekarang - v_yaw_netral) < 6 THEN
      RAISE EXCEPTION 'Tahap % tidak terdeteksi. Putar kepala ke kanan, bukan ke kiri.', v_kunci
        USING errcode = '42501';
    END IF;
  END LOOP;

  -- ------------------------ Geofence dan jam ------------------------
  SELECT b.latitude, b.longitude, b.geofence_radius_meters, b.face_match_threshold
    INTO v_branch_lat, v_branch_lng, v_radius, v_threshold
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
      'Wajah tidak cocok dengan sampel yang terdaftar. Kemiripan % persen, ambang % persen. Coba lagi di bawah cahaya yang lebih terang dan wajah menghadap lurus ke kamera.',
      pg_catalog.round(v_similarity * 100)::int,
      pg_catalog.round(v_threshold * 100)::int
      USING errcode = '42501';
  END IF;

  v_date := (now() at time zone 'Asia/Jakarta')::date;
  v_local_time := (now() at time zone 'Asia/Jakarta')::time;

  -- Keterlambatan dihitung terhadap jam buka milik jadwal orang ini, bukan
  -- jam operasional umum. Inilah yang membuat pegawai kantor tidak lagi
  -- tercatat terlambat setiap hari.
  IF v_open IS NOT NULL AND v_local_time > v_open THEN
    v_late_minutes := greatest(
      0,
      pg_catalog.floor(pg_catalog.date_part('epoch', v_local_time - v_open) / 60)::int
    );
  END IF;

  v_reason := NULLIF(btrim(coalesce(p_late_reason, '')), '');
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
    liveness_trace, status, notes, late_minutes, late_reason,
    schedule_kind, expected_open_time, expected_close_time,
    device_fingerprint
  ) VALUES (
    v_profile, v_date, now(), p_latitude, p_longitude, p_accuracy_meters,
    p_photo_url, v_similarity, true,
    p_liveness_trace, 'hadir',
    CASE WHEN v_late_minutes > 0 THEN v_reason ELSE NULL END,
    v_late_minutes, v_reason,
    v_schedule, v_open, v_close,
    p_device_fingerprint
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
      'schedule', v_schedule::text,
      'expected_open', v_open::text,
      'expected_close', v_close::text,
      'liveness_tahapan', v_urut,
      'face_matched_server_side', true
    )
  );

  RETURN v_row;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.attendance_check_in(
  double precision, double precision, double precision, text,
  double precision[], jsonb, text, text
) TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. Fungsi deteksi anomali device fingerprint
-- ---------------------------------------------------------------------------
-- Dipanggil oleh AFTER INSERT trigger. Bandingkan fingerprint baris baru
-- dengan 3 check-in terakhir (profil + cabang yang sama, dalam 7 hari).
-- Jika fingerprint berbeda dari semuanya, tandai anomaly_flag = true.
-- Jika device_fingerprint NULL, tidak ada yang bisa dibandingkan → tidak
-- ditandai (sesuai catatan: no fingerprint captured).
CREATE OR REPLACE FUNCTION public.flag_attendance_anomaly(p_log_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_profile     uuid;
  v_branch      uuid;
  v_fp          text;
  v_prev_count  integer;
BEGIN
  -- Ambil data baris yang baru saja diinsert
  SELECT a.profile_id, p.branch_id, a.device_fingerprint
    INTO v_profile, v_branch, v_fp
    FROM public.attendance_logs a
    JOIN public.profiles p ON p.id = a.profile_id
   WHERE a.id = p_log_id;

  -- Jika tidak ada fingerprint, tidak ada yang bisa dibandingkan
  IF v_fp IS NULL OR btrim(v_fp) = '' THEN
    RETURN;
  END IF;

  -- Jumlah check-in terakhir (dalam 7 hari, profil + cabang sama, punya
  -- fingerprint) selain baris ini.
  SELECT count(*)::integer
    INTO v_prev_count
    FROM public.attendance_logs a
    JOIN public.profiles p ON p.id = a.profile_id
   WHERE a.profile_id = v_profile
     AND p.branch_id  = v_branch
     AND a.id         <> p_log_id
     AND a.device_fingerprint IS NOT NULL
     AND a.clock_in   >= (now() - interval '7 days');

  -- Kurang dari 1 riwayat sebelumnya — belum cukup data untuk membandingkan
  IF v_prev_count < 1 THEN
    RETURN;
  END IF;

  -- Anomali: fingerprint sekarang tidak sama dengan satu pun dari 3 check-in
  -- terakhir (dalam 7 hari) profil + cabang yang sama → device berbeda.
  IF NOT EXISTS (
    SELECT 1
      FROM (
        SELECT a.device_fingerprint
          FROM public.attendance_logs a
          JOIN public.profiles p ON p.id = a.profile_id
         WHERE a.profile_id = v_profile
           AND p.branch_id  = v_branch
           AND a.id         <> p_log_id
           AND a.device_fingerprint IS NOT NULL
           AND a.clock_in   >= (now() - interval '7 days')
         ORDER BY a.clock_in DESC
         LIMIT 3
      ) AS recent
     WHERE recent.device_fingerprint = v_fp
  ) THEN
    UPDATE public.attendance_logs
       SET anomaly_flag   = true,
           anomaly_reason = 'device_changed'
     WHERE id = p_log_id;
  END IF;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 4. AFTER INSERT trigger
-- ---------------------------------------------------------------------------
DROP TRIGGER IF EXISTS attendance_anomaly_trigger ON public.attendance_logs;

CREATE OR REPLACE FUNCTION public.attendance_anomaly_trigger_fn()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
BEGIN
  PERFORM public.flag_attendance_anomaly(NEW.id);
  RETURN NULL;
END;
$function$;

CREATE TRIGGER attendance_anomaly_trigger
  AFTER INSERT ON public.attendance_logs
  FOR EACH ROW
  EXECUTE FUNCTION public.attendance_anomaly_trigger_fn();

COMMENT ON FUNCTION public.flag_attendance_anomaly IS
  '0115: Deteksi anomali device fingerprint — set anomaly_flag=true jika fingerprint berbeda dari 3 check-in terakhir dalam 7 hari.';

COMMENT ON FUNCTION public.attendance_anomaly_trigger_fn IS
  '0115: Trigger wrapper AFTER INSERT yang memanggil flag_attendance_anomaly.';
