-- 0026_face_reference_and_matching.sql
--
-- Foto referensi wajah dan pencocokan di server.
--
-- Dua masalah yang diselesaikan
-- ----------------------------
-- 1. Maintainer memutuskan menerima atau menolak pendaftaran wajah tanpa pernah
--    melihat wajahnya. kartu di halaman verifikasi hanya berisi nama, role,
--    cabang, dan status. Daftarkan siapa pun dengan wajah yang salah bisa
--    lolos tanpa yang salahnya pernah terlihat.
--
-- 2. Skor kemiripan datang dari perangkat. attendance_check_in menerima
--    p_face_similarity_score dan menuliskannya apa adanya ke log absensi.
--    Artinya angka "Wajah cocok" di laporan bisa dikarang, dan absensi
--    tanpa scan wajah sama sekali tetap diterima karena skornya null.
--
-- Yang berubah
-- ------------
-- Pendaftaran menyimpan foto referensi sekali, terpisah dari foto absensi
-- harian. Pencocokan pindah ke server: perangkat mengirim vektor wajah hasil
-- pindai, server yang membandingkan dengan vektor yang tersimpan dan
-- memutuskan lulus atau tidak. Vektor tersimpan tidak pernah dikirim balik ke
-- perangkat, jadi tidak bisa diputar ulang.
--
-- Yang belum dikYXR
-- ----------------
-- Pemeriksaan ini membuktikan orang yang memindai memang pemilik sampel yang
-- tersimpan. Ia belum membuktikan orang itu masih hidup di depan kamera:
-- foto cetakan yang dipegang juga bisa lolos. Untuk menutupnya perlu
-- pemeriksaan hidup seperti tantangan pada perangkat, dan itu batasannya
-- bukan pada sisi server.

-- ---------------------------------------------------------------------------
-- 1. Foto referensi tersimpan sekali
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'profiles'
       AND column_name = 'face_reference_photo_url'
  ) THEN
    ALTER TABLE public.profiles ADD COLUMN face_reference_photo_url text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'profiles'
       AND column_name = 'face_registered_at'
  ) THEN
    ALTER TABLE public.profiles ADD COLUMN face_registered_at timestamptz;
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- 2. Kemiripan kosinus
-- ---------------------------------------------------------------------------
-- Nilai 1 berarti vektor identik, 0 berarti saling tegak lurus, negatif
-- berarti berlawanan arah. Dua orang berbeda umumnya di bawah 0,5; orang yang
-- sama biasanya di atas 0,65.
--
-- Yang dikembalikan adalah kosinus similarity itu sendiri, bukan jaraknya.
-- 0026 versi pertama memakai 1 - (a.b / |a||b|), yaitu jarak, sehingga wajah
-- yang persis sama bernilai paling rendah dan selalu ditolak. Rumus di bawah
-- sudah dikoreksi, dan 0027 nevertheless memeriksa nilainya.

CREATE OR REPLACE FUNCTION public.face_similarity(
  a double precision[],
  b double precision[]
) RETURNS double precision
LANGUAGE sql
IMMUTABLE
SET search_path TO ''
AS $function$
  SELECT CASE
    WHEN a IS NULL OR b IS NULL THEN NULL
    WHEN array_length(a, 1) IS NULL THEN NULL
    WHEN array_length(a, 1) <> array_length(b, 1) THEN NULL
    ELSE (
      SELECT pg_catalog.sum(a[i] * b[i])
             / NULLIF(
                 pg_catalog.sqrt(pg_catalog.sum(a[i] * a[i]))
                 * pg_catalog.sqrt(pg_catalog.sum(b[i] * b[i])),
               0)
      FROM pg_catalog.generate_subscripts(a, 1) AS g(i)
    )
  END;
$function$;

-- Ambang ini bisa diubah di sini bila kondisi pencahayaan cabang berbeda.
-- Naikkan membuat lebih ketat, turunkan lebih longgar.
CREATE OR REPLACE FUNCTION public.face_match_threshold()
RETURNS double precision
LANGUAGE sql
IMMUTABLE
SET search_path TO ''
AS $function$ SELECT 0.5::double precision; $function$;

-- ---------------------------------------------------------------------------
-- 3. Pendaftaran menyimpan foto referensi
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

  IF p_photo_url IS NULL OR btrim(p_photo_url) = '' THEN
    RAISE EXCEPTION 'Foto referensi wajib diunggah saat pendaftaran wajah.';
  END IF;

  -- Pendaftaran ulang mengembalikan status ke menunggu, supaya maintainer
  -- memeriksa ulang wajah yang baru.
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
-- 4. Daftar verifikasi menyertakan foto
-- ---------------------------------------------------------------------------
-- Tipe kembalian berubah, jadi fungsi lama harus dibuang lebih dulu.
-- CREATE OR REPLACE tidak bisa mengubah baris OUT pada fungsi yang sudah ada.
DROP FUNCTION IF EXISTS public.pending_face_registrations();

CREATE OR REPLACE FUNCTION public.pending_face_registrations()
RETURNS TABLE(
  profile_id              uuid,
  full_name               text,
  role                    user_role,
  branch_name             text,
  face_verification       face_verification_status,
  face_review_note        text,
  registered_at           timestamptz,
  reference_photo_url     text,
  has_descriptor          boolean
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO ''
AS $function$
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN
    RAISE EXCEPTION 'Daftar verifikasi wajah hanya bisa dibaca pengguna yang sudah masuk.';
  END IF;

  IF NOT COALESCE((
    SELECT public.has_role(array['maintainer']::public.user_role[])
  ), false) THEN
    RAISE EXCEPTION 'Daftar verifikasi wajah hanya bisa dibaca oleh maintainer.';
  END IF;

  RETURN QUERY
  SELECT p.id,
         p.full_name::text,
         p.role,
         b.branch_name::text,
         COALESCE(p.face_verification, 'pending'::public.face_verification_status),
         p.face_review_note::text,
         COALESCE(p.face_registered_at, p.updated_at),
         p.face_reference_photo_url::text,
         (p.face_descriptor IS NOT NULL)
    FROM public.profiles p
    LEFT JOIN public.branches b ON b.id = p.branch_id
   WHERE p.face_descriptor IS NOT NULL
   ORDER BY
     CASE COALESCE(p.face_verification, 'pending'::public.face_verification_status)
       WHEN 'pending' THEN 0
       WHEN 'rejected' THEN 1
       ELSE 2
     END,
     p.full_name;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 5. Absen mengScan, bukan membawa klaim
-- ---------------------------------------------------------------------------
-- Overload lama dicabut supaya tidak ada jalur yang menerima skor dari klien.
-- Tanda tangannya: parameter terakhir berubah dari p_face_similarity_score
-- menjadi p_face_descriptor, jadi keduanya bisa dibedakan.

CREATE OR REPLACE FUNCTION public.attendance_check_in(
  p_latitude         double precision,
  p_longitude        double precision,
  p_accuracy_meters  double precision DEFAULT NULL,
  p_photo_url        text              DEFAULT NULL,
  p_face_descriptor  double precision[] DEFAULT NULL,
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
  v_date           date;
  v_local_time     time;
  v_distance       double precision;
  v_late_minutes   integer := 0;
  v_reason         text;
  v_face_status    public.face_verification_status;
  v_stored         double precision[];
  v_similarity     double precision;
  v_threshold      double precision;
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

  -- Pencocokan. Ini bagian yang sebelumnya tidak ada sama sekali: perangkat
  -- mengirim vektor hasil pindai, server yang membandingkan.
  SELECT p.face_descriptor INTO v_stored
    FROM public.profiles p WHERE p.id = v_profile;

  IF p_face_descriptor IS NULL OR array_length(p_face_descriptor, 1) IS NULL THEN
    RAISE EXCEPTION
      'Wajah belum dipindai. Absensi tidak dapat dicatat tanpa scan wajah.'
      USING errcode = '42501';
  END IF;

  IF array_length(p_face_descriptor, 1) <> array_length(v_stored, 1) THEN
    RAISE EXCEPTION 'Hasil pindai wajah tidak sesuai dengan sampel yang terdaftar.'
      USING errcode = '22023';
  END IF;

  v_similarity := public.face_similarity(p_face_descriptor, v_stored);
  v_threshold  := public.face_match_threshold();

  IF v_similarity IS NULL OR v_similarity < v_threshold THEN
    RAISE EXCEPTION
      'Wajah tidak cocok dengan sampel yang terdaftar. Kemiripan % , ambang % . Silakan pindai ulang di bawah cahaya yang lebih terang.',
      pg_catalog.round(v_similarity * 100)::int,
      pg_catalog.round(v_threshold * 100)::int
      USING errcode = '42501';
  END IF;

  SELECT b.latitude, b.longitude, b.geofence_radius_meters, b.operating_open_time
    INTO v_branch_lat, v_branch_lng, v_radius, v_open
    FROM public.branches b
   WHERE b.id = v_branch;

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
    face_photo_url, face_similarity_score, status, notes, late_minutes, late_reason
  ) VALUES (
    v_profile, v_date, now(), p_latitude, p_longitude, p_accuracy_meters,
    p_photo_url, v_similarity, 'hadir',
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
      'face_matched_server_side', true
    )
  );

  RETURN v_row;
END;
$function$;

-- Tutup jalur lama yang menerima skor dari klien.
REVOKE ALL ON FUNCTION public.attendance_check_in(
  double precision, double precision, double precision, text, double precision, text
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.attendance_check_in(
  double precision, double precision, double precision, text, double precision[], text
) TO authenticated;

GRANT EXECUTE ON FUNCTION public.set_face_descriptor(double precision[], text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.face_similarity(double precision[], double precision[]) TO authenticated;

-- Overload satu-argumen dihapus supaya PostgREST tidak ambigu memilih kandidat
-- ketika dipanggil dengan nama argumen. DROP sudah ikut mencabut seluruh hak
-- eksekusinya, jadi tidak perlu REVOKE terpisah.
DROP FUNCTION IF EXISTS public.set_face_descriptor(double precision[]);

-- ---------------------------------------------------------------------------
-- 6. Maintainer boleh melihat foto referensi
-- ---------------------------------------------------------------------------
-- Bucket attendance-photos bersifat privat. Tanpa policy ini, maintainer
-- tidak bisa menampilkan wajah yang sedang dia nilai.

DROP POLICY IF EXISTS "maintainer read attendance photos" ON storage.objects;
CREATE POLICY "maintainer read attendance photos" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'attendance-photos'
    AND public.has_role(array['maintainer']::public.user_role[])
  );

-- Staf boleh melihat foto referensi dirinya sendiri.
DROP POLICY IF EXISTS "staff read own attendance photos" ON storage.objects;
CREATE POLICY "staff read own attendance photos" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'attendance-photos'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );