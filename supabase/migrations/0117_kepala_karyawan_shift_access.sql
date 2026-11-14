-- =============================================================================
-- Migration 0117: Berikan kepala_karyawan akses buka/tutup kasir shift
--
-- Tujuan: Tambahkan role 'kepala_karyawan' ke pemeriksaan has_role pada
--         fungsi open_shift_handoff dan close_shift_handoff sehingga
--         kepala karyawan dapat membuka dan menutup shift kasir seperti
--         admin_kasir. Tidak ada perubahan logika lain pada kedua fungsi.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. open_shift_handoff
--    Sumber: 0082_fix_open_shift_handoff_uuid.sql
--    Perubahan: 'kepala_karyawan' ditambahkan ke array has_role
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.open_shift_handoff(
  p_date         date,
  p_opening_cash numeric,
  p_notes        text,
  p_shift_id     uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_profile   uuid;
  v_branch_id uuid;
  v_expected  numeric;
  v_unknown   numeric;
  v_id        uuid;
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN
    RAISE EXCEPTION 'Serah terima kas hanya bisa dibuka oleh pengguna yang sudah masuk.';
  END IF;

  IF NOT (SELECT public.has_role(
    ARRAY['owner', 'admin_kasir', 'maintainer', 'kepala_karyawan']::public.user_role[]
  )) THEN
    RAISE EXCEPTION 'Hanya owner, admin kasir, dan maintainer yang bisa melakukan serah terima kas.';
  END IF;

  v_profile := (SELECT public.current_profile_id());
  IF v_profile IS NULL THEN
    RAISE EXCEPTION 'Sesi tidak valid.';
  END IF;

  IF p_opening_cash IS NULL OR p_opening_cash < 0 THEN
    RAISE EXCEPTION 'Kas awal tidak boleh negatif.';
  END IF;

  IF p_shift_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.shifts s WHERE s.id = p_shift_id) THEN
    RAISE EXCEPTION 'Shift tidak ditemukan.';
  END IF;

  v_branch_id := COALESCE(
    (SELECT p.branch_id FROM public.profiles p WHERE p.id = v_profile),
    (SELECT b.id FROM public.branches b WHERE b.is_active ORDER BY b.created_at LIMIT 1)
  );

  SELECT p_opening_cash + COALESCE(f.cash_in, 0) - COALESCE(f.cash_out, 0),
         COALESCE(f.unknown_method, 0)
    INTO v_expected, v_unknown
  FROM public.expected_cash_for_date(p_date, p_opening_cash, v_branch_id) f;

  INSERT INTO public.shift_handoffs (
    shift_date, shift_id, opening_cash, expected_cash, unknown_method_cash,
    status, notes, opened_by, branch_id
  )
  VALUES (
    p_date, p_shift_id, p_opening_cash, v_expected, v_unknown,
    'open'::public.shift_handoff_status,
    NULLIF(BTRIM(COALESCE(p_notes, '')), ''), v_profile, v_branch_id
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.open_shift_handoff(date, numeric, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.open_shift_handoff(date, numeric, text, uuid) TO authenticated;

COMMENT ON FUNCTION public.open_shift_handoff(date, numeric, text, uuid) IS
  'Buka serah terima kas shift. p_shift_id opsional (nullable, parameter terakhir). Validasi UUID jika diisi. kepala_karyawan diizinkan sejak 0117.';

-- ---------------------------------------------------------------------------
-- 2. close_shift_handoff
--    Sumber: 0017_security_hardening.sql
--    Perubahan: 'kepala_karyawan' ditambahkan ke array has_role
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.close_shift_handoff(
  p_handoff_id  uuid,
  p_actual_cash numeric,
  p_notes       text
)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_profile  uuid;
  v_row      public.shift_handoffs%rowtype;
  v_expected numeric;
  v_unknown  numeric;
  v_diff     numeric;
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN
    RAISE EXCEPTION 'Serah terima kas hanya bisa ditutup oleh pengguna yang sudah masuk.';
  END IF;

  IF NOT (SELECT public.has_role(
    ARRAY['owner', 'admin_kasir', 'maintainer', 'kepala_karyawan']::public.user_role[]
  )) THEN
    RAISE EXCEPTION 'Hanya owner, admin kasir, dan maintainer yang bisa melakukan serah terima kas.';
  END IF;

  v_profile := (SELECT public.current_profile_id());
  IF v_profile IS NULL THEN
    RAISE EXCEPTION 'Sesi tidak valid.';
  END IF;

  IF p_actual_cash IS NULL OR p_actual_cash < 0 THEN
    RAISE EXCEPTION 'Jumlah uang fisik tidak boleh kosong atau negatif.';
  END IF;

  SELECT * INTO v_row
    FROM public.shift_handoffs
   WHERE id = p_handoff_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Catatan serah terima kas tidak ditemukan.';
  END IF;

  IF v_row.status = 'closed'::public.shift_handoff_status THEN
    RAISE EXCEPTION 'Serah terima kas ini sudah ditutup pada %.',
      TO_CHAR(v_row.closed_at AT TIME ZONE 'Asia/Jakarta', 'DD/MM/YYYY HH24:MI');
  END IF;

  -- Admin kasir hanya boleh menutup catatan cabangnya sendiri. Owner dan
  -- maintainer boleh lintas cabang.
  IF NOT public.can_access_branch(v_row.branch_id) THEN
    RAISE EXCEPTION 'Catatan serah terima kas ini milik cabang lain.';
  END IF;

  SELECT v_row.opening_cash + COALESCE(f.cash_in, 0) - COALESCE(f.cash_out, 0),
         COALESCE(f.unknown_method, 0)
    INTO v_expected, v_unknown
  FROM public.expected_cash_for_date(v_row.shift_date, v_row.opening_cash, v_row.branch_id) f;

  v_diff := p_actual_cash - v_expected;

  UPDATE public.shift_handoffs
     SET actual_cash         = p_actual_cash,
         expected_cash       = v_expected,
         unknown_method_cash = v_unknown,
         difference          = v_diff,
         status              = 'closed'::public.shift_handoff_status,
         closed_by           = v_profile,
         closed_at           = now(),
         notes               = v_row.notes,
         updated_at          = now()
   WHERE id = p_handoff_id;

  -- Ditulis terpisah agar nilai lama tetap dipakai bila p_notes kosong.
  IF NULLIF(BTRIM(COALESCE(p_notes, '')), '') IS NOT NULL THEN
    UPDATE public.shift_handoffs
       SET notes = BTRIM(p_notes)
     WHERE id = p_handoff_id;
  END IF;

  RETURN v_diff;
END;
$function$;

REVOKE ALL ON FUNCTION public.close_shift_handoff(uuid, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.close_shift_handoff(uuid, numeric, text) TO authenticated;

COMMENT ON FUNCTION public.close_shift_handoff(uuid, numeric, text) IS
  'Tutup serah terima kas shift. kepala_karyawan diizinkan sejak 0117.';
