-- ============================================================
-- 0148_fix_face_registration_and_reset.sql
-- 1. Perbaiki fungsi set_face_descriptor:
--    - Menghapus false-positive duplikasi wajah yang memblokir semua pendaftaran staf.
--    - Mengizinkan staf mendaftarkan sampel wajah dengan aman ke status 'pending'.
-- 2. Buat fungsi reset_staff_face:
--    - Memungkinkan Maintainer dan Owner untuk menghapus/mereset total sampel wajah
--      staf atau diri sendiri (mengosongkan descriptor, foto, dan status verifikasi).
-- 3. Bersihkan data wajah Faras hazid saat ini agar benar-benar bersih dan fresh.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Perbaiki set_face_descriptor
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_face_descriptor(
  p_descriptor double precision[],
  p_photo_url  text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile      uuid;
  v_len          integer;
  v_dup_name     text;
  v_similarity   double precision;
  v_other        RECORD;
BEGIN
  -- Ambil profile_id dari session
  v_profile := public.current_profile_id();
  IF v_profile IS NULL THEN
    RAISE EXCEPTION 'Sesi tidak valid.' USING errcode = '42501';
  END IF;

  -- Validasi panjang descriptor
  v_len := array_length(p_descriptor, 1);
  IF p_descriptor IS NULL OR v_len IS NULL OR v_len < 32 THEN
    RAISE EXCEPTION 'Sampel wajah tidak valid.';
  END IF;

  IF v_len <> public.face_descriptor_length() THEN
    RAISE EXCEPTION
      'Format sampel wajah sudah berubah. Pendaftaran ulang diperlukan untuk memakai pemindaian wajah yang sekarang.'
      USING errcode = '22023';
  END IF;

  -- Foto referensi wajib ada saat pendaftaran
  IF p_photo_url IS NULL OR btrim(p_photo_url) = '' THEN
    RAISE EXCEPTION 'Foto referensi wajib diunggah saat pendaftaran wajah.';
  END IF;

  -- CEK DUPLIKASI HANYA UNTUK IDENTIK EKSTREM (KLONING PERSIS > 0.9998)
  -- PADA AKUN LAIN YANG SUDAH APPROVED DAN AKTIF.
  -- Ini mencegah bug di mana topologi landmark wajah manusia yang mirip (>0.90)
  -- memblokir pendaftaran staf yang sah.
  FOR v_other IN
    SELECT p.id, p.full_name, p.face_descriptor
    FROM public.profiles p
    WHERE p.id <> v_profile
      AND p.is_active = true
      AND p.face_verification = 'approved'::public.face_verification_status
      AND p.face_descriptor IS NOT NULL
      AND array_length(p.face_descriptor, 1) = public.face_descriptor_length()
  LOOP
    v_similarity := public.face_similarity(p_descriptor, v_other.face_descriptor);
    -- Hanya tolak jika similarity identik ekstrem (foto/file dump yang sama persis)
    IF v_similarity >= 0.9998 THEN
      v_dup_name := COALESCE(v_other.full_name, 'akun lain');
      RAISE EXCEPTION
        'Wajah ini terdeteksi identik persis dengan akun "%". Satu wajah hanya boleh digunakan untuk satu akun.',
        v_dup_name
        USING errcode = '23505';
    END IF;
  END LOOP;

  -- Simpan descriptor baru & tandai status verifikasi 'pending' agar dinilai Maintainer
  UPDATE public.profiles
     SET face_descriptor           = p_descriptor,
         face_reference_photo_url  = p_photo_url,
         face_registered_at        = now(),
         face_verification         = 'pending'::public.face_verification_status,
         face_review_note          = NULL,
         face_reviewed_at          = NULL,
         face_reviewed_by          = NULL,
         updated_at                = now()
   WHERE id = v_profile;

  INSERT INTO public.activity_logs (actor_id, action, entity, entity_id, metadata)
  VALUES (
    v_profile, 'profile.face_registered', 'profiles', v_profile,
    jsonb_build_object('dimensions', v_len, 'has_reference_photo', true)
  );

  RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_face_descriptor(double precision[], text) TO authenticated;

-- ------------------------------------------------------------
-- 2. Fungsi reset_staff_face (Hard Reset Sampel Wajah Staf)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reset_staff_face(p_profile_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_reviewer   uuid;
  v_role       text;
  v_target_name text;
BEGIN
  v_reviewer := public.current_profile_id();
  IF v_reviewer IS NULL THEN
    RAISE EXCEPTION 'Sesi tidak valid.' USING errcode = '42501';
  END IF;

  SELECT role::text INTO v_role FROM public.profiles WHERE id = v_reviewer;
  IF v_role NOT IN ('owner', 'maintainer') THEN
    RAISE EXCEPTION 'Hanya owner atau maintainer yang dapat mereset data wajah.';
  END IF;

  SELECT full_name INTO v_target_name FROM public.profiles WHERE id = p_profile_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Profil staf tidak ditemukan.';
  END IF;

  -- Kosongkan seluruh data wajah
  UPDATE public.profiles
     SET face_descriptor          = NULL,
         face_reference_photo_url = NULL,
         face_registered_at       = NULL,
         face_verification        = NULL,
         face_review_note         = NULL,
         face_reviewed_at         = NULL,
         face_reviewed_by         = NULL,
         updated_at               = now()
   WHERE id = p_profile_id;

  INSERT INTO public.activity_logs (actor_id, action, entity, entity_id, metadata)
  VALUES (
    v_reviewer,
    'profile.face_reset',
    'profiles',
    p_profile_id,
    jsonb_build_object('target_name', v_target_name)
  );

  INSERT INTO public.notifications (recipient_id, title, body, category, payload)
  VALUES (
    p_profile_id,
    'Data Wajah Direset',
    'Data wajah Anda telah direset oleh maintainer. Silakan daftarkan ulang wajah Anda di menu Absensi.',
    'account',
    jsonb_build_object('action', 'face_reset')
  );

  RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION public.reset_staff_face(uuid) TO authenticated;

-- ------------------------------------------------------------
-- 3. Bersihkan data wajah Faras hazid saat ini
-- ------------------------------------------------------------
UPDATE public.profiles
   SET face_descriptor          = NULL,
       face_reference_photo_url = NULL,
       face_registered_at       = NULL,
       face_verification        = NULL,
       face_review_note         = NULL,
       face_reviewed_at         = NULL,
       face_reviewed_by         = NULL,
       updated_at               = now()
 WHERE id = '223e0225-9fd4-4079-b37f-9e8d900ab45d';
