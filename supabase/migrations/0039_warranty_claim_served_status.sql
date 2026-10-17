-- Klaim garansi untuk order yang sudah diserahkan.
--
-- Garansi terbit saat QC disetujui (status "completed"), lalu order berpindah
-- ke "menunggu_diambil" dan "diserahkan". Fungsi lama hanya menerima
-- "completed", sehingga begitu unit diserahkan klaim selalu ditolak meskipun
-- garansinya masih aktif. Cakupan diperluas ke ketiga status pasca-pengerjaan.

CREATE OR REPLACE FUNCTION public.create_warranty_claim(
  p_order_id           uuid,
  p_problem_description text,
  p_proof_photo_url    text DEFAULT NULL
)
RETURNS public.warranty_claims
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_profile   uuid;
  v_branch_id uuid;
  v_order     public.orders%rowtype;
  v_warranty  public.warranties%rowtype;
  v_today     date := (now() AT TIME ZONE 'Asia/Jakarta')::date;
  v_row       public.warranty_claims%rowtype;
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN
    RAISE EXCEPTION 'Klaim garansi hanya bisa diajukan oleh pengguna yang sudah masuk.';
  END IF;

  IF NOT COALESCE((SELECT public.has_role(
    ARRAY['owner', 'admin_kasir', 'maintainer']::public.user_role[]
  )), false) THEN
    RAISE EXCEPTION 'Hanya owner, admin kasir, dan maintainer yang bisa mengajukan klaim garansi.';
  END IF;

  v_profile := (SELECT public.current_profile_id());
  IF v_profile IS NULL THEN
    RAISE EXCEPTION 'Sesi tidak valid.';
  END IF;

  v_branch_id := (SELECT p.branch_id FROM public.profiles p WHERE p.id = v_profile);

  IF length(btrim(coalesce(p_problem_description, ''))) < 10 THEN
    RAISE EXCEPTION 'Detail keluhan minimal 10 karakter.';
  END IF;

  SELECT * INTO v_order FROM public.orders o WHERE o.id = p_order_id FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order tidak ditemukan.';
  END IF;

  IF v_order.status NOT IN (
    'completed'::public.order_status,
    'menunggu_diambil'::public.order_status,
    'diserahkan'::public.order_status
  ) THEN
    RAISE EXCEPTION 'Klaim garansi hanya bisa diajukan untuk order yang sudah selesai.';
  END IF;

  IF v_branch_id IS NULL OR v_order.branch_id <> v_branch_id THEN
    RAISE EXCEPTION 'Order ini bukan milik cabang Anda.';
  END IF;

  SELECT * INTO v_warranty
    FROM public.warranties w
   WHERE w.order_id = p_order_id
   ORDER BY w.created_at DESC
   LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order ini tidak memiliki sertifikat garansi.';
  END IF;

  IF v_warranty.end_date < v_today THEN
    RAISE EXCEPTION 'Masa garansi berakhir pada %s.',
      to_char(v_warranty.end_date, 'DD/MM/YYYY');
  END IF;

  IF v_warranty.status <> 'active'::public.warranty_status THEN
    RAISE EXCEPTION 'Sertifikat garansi berstatus %, tidak dapat diklaim.',
      v_warranty.status;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.warranty_claims c
     WHERE c.order_id = p_order_id
       AND c.status = 'pending'::public.warranty_claim_status
  ) THEN
    RAISE EXCEPTION 'Sudah ada klaim yang sedang diproses untuk order ini.';
  END IF;

  INSERT INTO public.warranty_claims (
    order_id, problem_description, proof_photo_url, status, created_by
  ) VALUES (
    p_order_id,
    btrim(p_problem_description),
    nullif(btrim(coalesce(p_proof_photo_url, '')), ''),
    'pending'::public.warranty_claim_status,
    v_profile
  ) RETURNING * INTO v_row;

  RETURN v_row;
END;
$function$;

REVOKE ALL ON FUNCTION public.create_warranty_claim(uuid, text, text)
  FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.create_warranty_claim(uuid, text, text)
  TO authenticated;
