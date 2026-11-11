-- 0114_prevent_duplicate_face.sql
--
-- Tambahkan pengecekan duplikasi wajah di set_face_descriptor.
-- Sebelum menyimpan descriptor baru, bandingkan dengan semua descriptor
-- yang sudah ada (selain milik profil sendiri).
-- Jika ada yang similarity >= threshold (0.75), tolak dengan error yang jelas.
--
-- SQL-only migration — tidak ada perubahan pada kode Next.js.

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
  v_threshold    double precision := 0.75; -- threshold untuk deteksi duplikasi
  v_dup_name     text;
  v_similarity   double precision;
  v_other        RECORD;
BEGIN
  -- Ambil profile_id dari session
  v_profile := public.current_profile_id();
  IF v_profile IS NULL THEN
    RAISE EXCEPTION 'Sesi tidak valid.' USING errcode = '42501';
  END IF;

  -- Validasi panjang descriptor (gunakan fungsi face_descriptor_length() agar
  -- selalu sinkron dengan format yang berlaku, bukan nilai hardcode)
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

  -- CEK DUPLIKASI: bandingkan dengan semua descriptor yang sudah ada
  -- (selain milik profil sendiri dan yang belum punya descriptor)
  FOR v_other IN
    SELECT p.id, p.full_name, p.face_descriptor
    FROM public.profiles p
    WHERE p.id <> v_profile
      AND p.face_descriptor IS NOT NULL
      AND array_length(p.face_descriptor, 1) = public.face_descriptor_length()
  LOOP
    v_similarity := public.face_similarity(p_descriptor, v_other.face_descriptor);
    IF v_similarity >= v_threshold THEN
      v_dup_name := COALESCE(v_other.full_name, 'akun lain');
      RAISE EXCEPTION
        'Wajah ini sudah terdaftar di akun "%". Satu wajah hanya boleh digunakan untuk satu akun. Hubungi maintainer jika ini kesalahan.',
        v_dup_name
        USING errcode = '23505'; -- unique_violation
    END IF;
  END LOOP;

  -- Simpan descriptor (tidak ada duplikat ditemukan)
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
    jsonb_build_object('dimensions', v_len, 'has_reference_photo', true, 'duplicate_check', true)
  );

  RETURN true;
END;
$$;

COMMENT ON FUNCTION public.set_face_descriptor IS
  '0114: Registrasi sampel wajah dengan pengecekan duplikasi lintas akun. Tolak jika similarity >= 0.75 dengan descriptor yang sudah ada.';

GRANT EXECUTE ON FUNCTION public.set_face_descriptor(double precision[], text) TO authenticated;
