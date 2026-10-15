-- 0032_branch_office_hours_editor.sql
--
-- Jam kantor sudah dibuat di 0031, tetapi belum bisa diubah dari antarmuka.
-- Fungsi update_branch_settings tidak diubah karena sudah dipakai dan sudah
-- lolos pengujian; menambah parameternya akan mengubah tandatanginya dan
--ificance pemanggil lama ikut hilang.
--
-- Karena itu jam kantor mendapat fungsi sendiri. Pemanggil baru harus
-- Jadi jam kantor mendapat fungsi sendiri dengan pemeriksaan yang sama seperti
-- update_branch_settings.

DROP FUNCTION IF EXISTS public.update_branch_office_hours(uuid, time, time);

CREATE OR REPLACE FUNCTION public.update_branch_office_hours(
  p_branch_id  uuid,
  p_open_time  time,
  p_close_time time
)
RETURNS public.branches
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_lapangan_buka  time;
  v_lapangan_tutup time;
  v_row           public.branches%rowtype;
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN
    RAISE EXCEPTION 'Konfigurasi cabang hanya bisa diubah pengguna yang sudah masuk.';
  END IF;

  IF (SELECT public.current_profile_id()) IS NULL THEN
    RAISE EXCEPTION 'Sesi tidak valid.';
  END IF;

  IF NOT COALESCE((
    SELECT public.has_role(array['owner', 'maintainer']::public.user_role[])
  ), false) THEN
    RAISE EXCEPTION 'Hanya owner dan maintainer yang bisa mengubah jam kerja kantor.';
  END IF;

  IF p_open_time IS NULL OR p_close_time IS NULL THEN
    RAISE EXCEPTION 'Jam masuk dan jam pulang kantor wajib diisi.';
  END IF;

  -- Jam pulang harus setelah jam masuk. Kalau tidak, siapa pun yang punya
  -- jadwal kantor akan selalu tercatat terlambat sepanjang hari.
  IF p_close_time <= p_open_time THEN
    RAISE EXCEPTION 'Jam pulang kantor harus setelah jam masuk. Sekarang jam masuk % dan jam pulang %.',
      p_open_time::text, p_close_time::text;
  END IF;

  SELECT b.operating_open_time, b.operating_close_time
    INTO v_lapangan_buka, v_lapangan_tutup
    FROM public.branches b
   WHERE b.id = p_branch_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cabang tidak ditemukan.';
  END IF;

  -- Jam kantor yang sama persis dengan jam lapangan membuat
  -- pilihan jadwal tidak berarti apa-apa, jadi itu ditolak lebih awal
  -- dengan pesan yang jelas.
  IF p_open_time = v_lapangan_buka AND p_close_time = v_lapangan_tutup THEN
    RAISE EXCEPTION
      'Jam kantor sama dengan jam lapangan. Kalau memang begitu, tidak perlu dipisah.';
  END IF;

  UPDATE public.branches
     SET office_open_time = p_open_time,
         office_close_time = p_close_time,
         updated_at = now()
   WHERE id = p_branch_id
  RETURNING * INTO v_row;

  INSERT INTO public.activity_logs (actor_id, action, entity, entity_id, metadata)
  VALUES (
    (SELECT public.current_profile_id()),
    'branch.office_hours_changed', 'branches', p_branch_id,
    jsonb_build_object(
      'kantor_masuk', p_open_time::text,
      'kantor_pulang', p_close_time::text,
      'lapangan_masuk', v_lapangan_buka::text,
      'lapangan_pulang', v_lapangan_tutup::text
    )
  );

  RETURN v_row;
END;
$function$;

REVOKE ALL ON FUNCTION public.update_branch_office_hours(uuid, time, time) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_branch_office_hours(uuid, time, time) TO authenticated;