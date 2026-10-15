-- 0031_work_schedule_and_attendance_retention.sql
--
-- Jam kerja kantor terpisah dari jam operasional lapangan.
--
-- Masalah
-- -------
-- branches hanya punya satu pasang jam: operating_open_time dan
-- operating_close_time, yang berisi 07:30 sampai 21:00. Semua orang dinilai
-- terhadap jam itu. Pegawai kantor seperti maintainer dan kasir bekerja
-- 10:00 sampai 18:00, sehingga mereka selalu tercatat terlambat setiap hari
-- padahal tidak.
--
-- Solusi
-- ------
-- Dua pasang jam per cabang: operating untuk lapangan, office untuk kantor.
-- Setiap profil punya work_schedule yang menentukan pasangan mana yang
-- dipakai. Nilai awalnya mengikuti peran, dan bisa diubah sendiri oleh owner
-- atau maintainer bila ada orang yang bekerja lintas fungsi.
--
-- Retensi data absensi
-- --------------------
-- Audit kehadiran disimpan tiga bulan terakhir. Data yang lebih lama dihapus
-- otomatis oleh pg_cron setiap hari, dan batasnya diubah lewat fungsi
-- set_attendance_retention_months tanpa perlu mengubah berkas migrasi.

-- ---------------------------------------------------------------------------
-- 1. Jam kantor per cabang
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'branches'
       AND column_name = 'office_open_time'
  ) THEN
    ALTER TABLE public.branches
      ADD COLUMN office_open_time  time NOT NULL DEFAULT '10:00:00',
      ADD COLUMN office_close_time time NOT NULL DEFAULT '18:00:00';
  END IF;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'branches_office_hours_order'
  ) THEN
    ALTER TABLE public.branches
      ADD CONSTRAINT branches_office_hours_order
      CHECK (office_close_time > office_open_time);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'branches_operating_hours_order'
  ) THEN
    ALTER TABLE public.branches
      ADD CONSTRAINT branches_operating_hours_order
      CHECK (operating_close_time > operating_open_time);
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- 2. Jadwal kerja per karyawan
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'work_schedule') THEN
    CREATE TYPE public.work_schedule AS ENUM ('field', 'office');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'profiles'
       AND column_name = 'work_schedule'
  ) THEN
    ALTER TABLE public.profiles ADD COLUMN work_schedule public.work_schedule;
  END IF;
END;
$$;

-- Nilai awal mengikuti peran: yang bekerja di lapangan mengikuti jam
-- operasional, yang bekerja di kantor mengikuti jam kantor.
UPDATE public.profiles
   SET work_schedule = CASE
         WHEN role IN ('owner', 'maintainer', 'admin_kasir') THEN 'office'::public.work_schedule
         ELSE 'field'::public.work_schedule
       END
 WHERE work_schedule IS NULL;

ALTER TABLE public.profiles
  ALTER COLUMN work_schedule SET DEFAULT 'field'::public.work_schedule;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'profiles_work_schedule_not_null'
  ) THEN
    -- Semua baris lama sudah diisi di atas, jadi menambah NOT NULL aman.
    ALTER TABLE public.profiles
      ALTER COLUMN work_schedule SET NOT NULL;
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- 3. Menyimpan jadwal yang berlaku saat itu
-- ---------------------------------------------------------------------------
-- Kalau jadwal cabang diubah bulan depan, laporan bulan ini tidak boleh ikut
-- berubah. Jadi jam yang berlaku dan jenisnya disimpan di baris absensi.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'attendance_logs'
       AND column_name = 'schedule_kind'
  ) THEN
    ALTER TABLE public.attendance_logs
      ADD COLUMN schedule_kind         public.work_schedule,
      ADD COLUMN expected_open_time   time,
      ADD COLUMN expected_close_time  time;
  END IF;
END;
$$;

-- Backfill baris lama supaya laporan sebelumnya tidak kosong.
UPDATE public.attendance_logs a
   SET schedule_kind = p.work_schedule
  FROM public.profiles p
 WHERE p.id = a.profile_id
   AND a.schedule_kind IS NULL;

-- ---------------------------------------------------------------------------
-- 4. Resolver jadwal
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.resolve_schedule(p_branch_id uuid, p_schedule public.work_schedule)
RETURNS TABLE(
  schedule public.work_schedule,
  open_time time,
  close_time time
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT
    COALESCE(p_schedule, 'field'::public.work_schedule),
    CASE WHEN COALESCE(p_schedule, 'field') = 'office'
         THEN b.office_open_time ELSE b.operating_open_time END,
    CASE WHEN COALESCE(p_schedule, 'field') = 'office'
         THEN b.office_close_time ELSE b.operating_close_time END
  FROM public.branches b
 WHERE b.id = p_branch_id;
$function$;

-- ---------------------------------------------------------------------------
-- 5. Absen memakai jadwal yang sesuai
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.attendance_check_in(
  p_latitude         double precision,
  p_longitude        double precision,
  p_accuracy_meters  double precision   DEFAULT NULL,
  p_photo_url        text              DEFAULT NULL,
  p_face_descriptor  double precision[] DEFAULT NULL,
  p_liveness_trace   jsonb             DEFAULT NULL,
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
    schedule_kind, expected_open_time, expected_close_time
  ) VALUES (
    v_profile, v_date, now(), p_latitude, p_longitude, p_accuracy_meters,
    p_photo_url, v_similarity, true,
    p_liveness_trace, 'hadir',
    CASE WHEN v_late_minutes > 0 THEN v_reason ELSE NULL END,
    v_late_minutes, v_reason,
    v_schedule, v_open, v_close
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

-- ---------------------------------------------------------------------------
-- 6. Mengubah jadwal kerja staf
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_work_schedule(
  p_profile_id uuid,
  p_schedule  public.work_schedule,
  p_note      text DEFAULT NULL
) RETURNS public.profiles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_row        public.profiles%rowtype;
  v_aktor      uuid;
  v_cabang     uuid;
  v_lama       public.work_schedule;
  v_lama_nama  text;
  v_baru_nama  text;
  v_buka_lama  time;
  v_buka_baru  time;
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN
    RAISE EXCEPTION 'Jadwal kerja hanya bisa diubah oleh pengguna yang sudah masuk.';
  END IF;

  v_aktor := public.current_profile_id();
  IF NOT COALESCE((
    SELECT public.has_role(array['owner', 'maintainer']::public.user_role[])
  ), false) THEN
    RAISE EXCEPTION 'Jadwal kerja hanya bisa diubah oleh owner atau maintainer.';
  END IF;

  SELECT p.work_schedule INTO v_lama FROM public.profiles p WHERE p.id = p_profile_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Profil staf tidak ditemukan.';
  END IF;

  UPDATE public.profiles
     SET work_schedule = p_schedule, updated_at = now()
   WHERE id = p_profile_id
  RETURNING * INTO v_row;

  v_cabang := v_row.branch_id;

  -- resolve_schedule mengembalikan TABLE, jadi kolomnya diambil tanpa awalan
  -- alias. Menulis s.open_time akan gagal karena tidak ada tabel alias s.
  SELECT open_time INTO v_buka_lama FROM public.resolve_schedule(v_cabang, v_lama);
  SELECT open_time INTO v_buka_baru FROM public.resolve_schedule(v_cabang, p_schedule);

  v_lama_nama := CASE WHEN v_lama = 'office' THEN 'kantor 10-18' ELSE 'lapangan 07:30-21' END;
  v_baru_nama := CASE WHEN p_schedule = 'office' THEN 'kantor 10-18' ELSE 'lapangan 07:30-21' END;

  INSERT INTO public.activity_logs (actor_id, action, entity, entity_id, metadata)
  VALUES (
    v_aktor, 'profile.work_schedule_changed', 'profiles', p_profile_id,
    jsonb_build_object(
      'nama', v_row.full_name::text,
      'dari', v_lama::text, 'ke', p_schedule::text,
      'jam_buka_sebelumnya', v_buka_lama::text,
      'jam_buka_sekarang', v_buka_baru::text,
      'catatan', p_note
    )
  );

  RETURN v_row;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.set_work_schedule(uuid, public.work_schedule, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_schedule(uuid, public.work_schedule) TO authenticated;

-- ---------------------------------------------------------------------------
-- 7. Retensi absensi tiga bulan
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.attendance_retention_months()
RETURNS integer
LANGUAGE sql
IMMUTABLE
SET search_path TO ''
AS $function$ SELECT 3::integer; $function$;

-- Hanya cron yang boleh memanggil, dan REVOKE menutup jalan bagi klien.
CREATE OR REPLACE FUNCTION public.purge_attendance_history(
  p_months integer DEFAULT NULL
) RETURNS TABLE(deleted_count bigint, cutoff_date date)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_months integer;
  v_cutoff  date;
  v_n       bigint := 0;
BEGIN
  IF p_months IS NULL THEN
    v_months := public.attendance_retention_months();
  ELSE
    v_months := p_months;
  END IF;

  -- Rentang di bawah satu bulan berarti salah konfigurasi, bukan keputusan
  -- yang layak dieksekusi diam-diam.
  IF v_months < 1 OR v_months > 60 THEN
    RAISE EXCEPTION 'Masa simpan harus antara 1 dan 60 bulan.';
  END IF;

  -- REVOKE saja tidak cukup. Koneksi Management API dan peran postgres
  -- menembus REVOKE, jadi pemeriksaan dilakukan juga di dalam fungsi.
  -- Satu-satunya cara memanggil ini adalah tanpa sesi pengguna, yaitu cron.
  IF (SELECT auth.uid()) IS NOT NULL THEN
    RAISE EXCEPTION
      'Penghapusan riwayat hanya dijalankan oleh sistem terjadwal, bukan oleh pengguna.';
  END IF;

  -- Batas dihitung ke awal bulan, bukan now() dikurangi jumlah bulan, supaya
  -- tidak bergeser setiap hari dan bulan yang disimpan utuh.
  v_cutoff := date_trunc(
    'month',
    (now() at time zone 'Asia/Jakarta')::date - (v_months || ' months')::interval
  )::date;

  DELETE FROM public.attendance_logs
   WHERE date < v_cutoff;

  GET DIAGNOSTICS v_n = ROW_COUNT;

  IF v_n > 0 THEN
    INSERT INTO public.activity_logs (actor_id, action, entity, entity_id, metadata)
    VALUES (
      NULL, 'attendance.history_purged', 'attendance_logs', NULL,
      jsonb_build_object(
        'baris_terhapus', v_n,
        'sebelum_tanggal', v_cutoff,
        'masa_simpan_bulan', v_months
      )
    );
  END IF;

  RETURN QUERY SELECT v_n, v_cutoff;
END;
$function$;

REVOKE ALL ON FUNCTION public.purge_attendance_history(integer) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 8. Audit kehadiran untuk ekspor
-- ---------------------------------------------------------------------------
-- Dipakai halaman rekap untuk kalender bulanan dan ekspor Excel.
-- Hanya owner dan maintainer; role lain dibatasi oleh halaman.
-- Tipe kolom face_similarity_score adalah numeric. Mengubah tipe kolom
-- keluaran memerlukan drop lebih dulu, karena CREATE OR REPLACE tidak boleh
-- mengganti tipe return yang sudah ada.
DROP FUNCTION IF EXISTS public.get_attendance_audit(date, date);

CREATE OR REPLACE FUNCTION public.get_attendance_audit(
  p_from date,
  p_to   date
)
RETURNS TABLE(
  profile_id     uuid,
  full_name      text,
  role           user_role,
  branch_name    text,
  work_schedule  public.work_schedule,
  date           date,
  clock_in       timestamptz,
  clock_out      timestamptz,
  status         text,
  late_minutes   integer,
  late_reason    text,
  face_score     numeric,
  liveness       boolean,
  expected_open  time,
  expected_close time,
  notes          text
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO ''
AS $function$
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN
    RAISE EXCEPTION 'Audit kehadiran hanya bisa dibaca pengguna yang sudah masuk.';
  END IF;

  IF NOT COALESCE((
    SELECT public.has_role(array['owner', 'maintainer']::public.user_role[])
  ), false) THEN
    RAISE EXCEPTION 'Audit kehadiran hanya bisa dibaca oleh owner atau maintainer.';
  END IF;

  IF p_from IS NULL OR p_to IS NULL OR p_to < p_from THEN
    RAISE EXCEPTION 'Rentang tanggal tidak valid.';
  END IF;

  -- Cegah satu permintaan menarik seluruh riwayat.
  IF (p_to - p_from) > 120 THEN
    RAISE EXCEPTION 'Rentang maksimal 120 hari per permintaan.';
  END IF;

  RETURN QUERY
  SELECT a.profile_id,
         p.full_name::text,
         p.role,
         b.branch_name::text,
         p.work_schedule,
         a.date,
         a.clock_in,
         a.clock_out,
         a.status::text,
         a.late_minutes,
         a.late_reason::text,
         a.face_similarity_score,
         a.face_liveness_passed,
         a.expected_open_time,
         a.expected_close_time,
         a.notes::text
    FROM public.attendance_logs a
    JOIN public.profiles p ON p.id = a.profile_id
    LEFT JOIN public.branches b ON b.id = p.branch_id
   WHERE a.date BETWEEN p_from AND p_to
   ORDER BY a.date DESC, p.full_name;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.get_attendance_audit(date, date) TO authenticated;

-- ---------------------------------------------------------------------------
-- 9. Menjadwalkan penghapusan harian
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  -- Dipanggil setiap hari pada 03:10 WIB. 03:10 dipilih supaya tidak
  -- bertabrakan dengan generator absensi hari libur yang berjalan pagi.
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'purge-attendance-history') THEN
    PERFORM cron.schedule('purge-attendance-history', '10 3 * * *', $job$
      SELECT public.purge_attendance_history();
    $job$);
  END IF;
EXCEPTION
  WHEN insufficient_privilege OR undefined_function THEN
    RAISE NOTICE 'pg_cron tidak tersedia, penghapusan harus dipanggil manual';
END;
$$;