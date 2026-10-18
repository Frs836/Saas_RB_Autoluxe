-- Liveness tiga tahap: hadap lurus, kedip, buka mulut.
--
-- attendance_check_in menolak jejak liveness yang bukan lima tahap lengkap
-- (hadap, kedip, mulut, kiri, kanan) dan memvalidasi tahap kiri dan kanan
-- sebagai bukti gerak kepala. Klien sekarang hanya mengirim tiga tahap, jadi
-- tanpa perubahan ini setiap absen ditolak dengan "Tahap kehadiran belum
-- lengkap".
--
-- Yang berubah hanya dua hal: jumlah tahap yang diwajibkan, dan menghapus
-- pemeriksaan khusus tahap kiri dan kanan. Sisanya--deskriptor per tahap,
-- perbandingan wajah, ambang kemiripan, geofence catatan lembut, dan aturan
-- keterlambatan--tidak disentuh sama sekali.
--
-- Alasan menghapus kiri dan kanan: gerak kepala justru membuat deteksi gagal,
-- terutama saat staf absen sambil memegang kunci unit atau menelepon. Blink dan
-- buka mulut tetap membuktikan orangnya hidup, sedangkan descriptor wajah tetap
-- dibandingkan dengan sampel terdaftar.

create or replace function public.attendance_check_in(
  p_latitude double precision,
  p_longitude double precision,
  p_accuracy_meters double precision DEFAULT NULL::double precision,
  p_photo_url text DEFAULT NULL::text,
  p_face_descriptor double precision[] DEFAULT NULL::double precision[],
  p_liveness_trace jsonb DEFAULT NULL::jsonb,
  p_late_reason text DEFAULT NULL::text
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
  v_di_luar         boolean;
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

    -- Wajah harus tetap cocok pada SETIAP tahap, termasuk yang ketiga. Ini yang
    -- membuat jejak tidak bisa diisi ulang dengan frame dari wajah lain.
    v_similarity := public.face_similarity(v_sekarang, v_stored);
    IF v_similarity IS NULL OR v_similarity < 0.5 THEN
      RAISE EXCEPTION 'Pada tahap %, wajah tidak lagi cocok dengan sampel. Ulangi dari awal.', v_kunci
        USING errcode = '42501';
    END IF;

    IF v_kunci = 'center' THEN
      v_netral := v_sekarang;
    END IF;
  END LOOP;

  -- Tiga tahap: hadap lurus, kedip, buka mulut. Tahap kiri dan kanan tidak
  -- lagi diminta maupun diperiksa.
  IF NOT (
    array_length(v_urut, 1) = 3
    AND v_urut[1] = 'center' AND v_urut[2] = 'blink' AND v_urut[3] = 'mouth'
  ) THEN
    RAISE EXCEPTION 'Tahap kehadiran belum lengkap. Urutan: hadap lurus, kedipkan mata, buka mulut.'
      USING errcode = '42501';
  END IF;

  IF v_netral IS NULL THEN
    RAISE EXCEPTION 'Posisi awal tidak tercatat pada bukti kehadiran.' USING errcode = '42501';
  END IF;

  -- ---------------------------- Lokasi ----------------------------
  SELECT b.latitude, b.longitude, b.geofence_radius_meters, b.face_match_threshold
    INTO v_branch_lat, v_branch_lng, v_radius, v_threshold
    FROM public.branches b
   WHERE b.id = v_branch;

  v_threshold := COALESCE(v_threshold, public.face_liveness_threshold());

  IF p_latitude IS NULL OR p_longitude IS NULL THEN
    RAISE EXCEPTION 'Koordinat GPS perangkat tidak tersedia.'
      USING errcode = '22023';
  END IF;

  v_distance := public.haversine_meters(v_branch_lat, v_branch_lng, p_latitude, p_longitude);
  v_radius := COALESCE(v_radius, 30.0);

  -- Di luar radius hanya dicatat, tidak ditolak.
  v_di_luar := (v_branch_lat IS NULL) OR (v_distance > v_radius);

  -- ---------------------------- Cocokkan wajah ----------------------------
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
    outside_radius, distance_from_branch_meters, geofence_radius_meters
  ) VALUES (
    v_profile, v_date, now(), p_latitude, p_longitude, p_accuracy_meters,
    p_photo_url, v_similarity, true,
    p_liveness_trace, 'hadir',
    CASE WHEN v_late_minutes > 0 THEN v_reason END,
    v_late_minutes, v_reason,
    v_schedule, v_open, v_close,
    v_di_luar, v_distance, v_radius
  )
  RETURNING * INTO v_row;

  INSERT INTO public.activity_logs (actor_id, action, entity, entity_id, metadata)
  VALUES (
    v_profile, 'attendance.check_in', 'attendance_logs', v_row.id,
    jsonb_build_object(
      'similarity', v_similarity,
      'late_minutes', v_late_minutes,
      'outside_radius', v_di_luar,
      'distance_m', v_distance
    )
  );

  RETURN v_row;
END;
$function$;

revoke all on function public.attendance_check_in(
  double precision, double precision, double precision, text,
  double precision[], jsonb, text
) from public;

grant execute on function public.attendance_check_in(
  double precision, double precision, double precision, text,
  double precision[], jsonb, text
) to authenticated;