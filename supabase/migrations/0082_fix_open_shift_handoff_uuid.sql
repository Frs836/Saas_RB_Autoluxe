-- 0082: Fix open_shift_handoff - make p_shift_id nullable with proper validation
-- Frontend passes null when shift_id not provided, not empty string.
-- Move p_shift_id to end to satisfy PostgreSQL parameter default rules.

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
    ARRAY['owner', 'admin_kasir', 'maintainer']::public.user_role[]
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
  'Buka serah terima kas shift. p_shift_id opsional (nullable, parameter terakhir). Validasi UUID jika diisi.';