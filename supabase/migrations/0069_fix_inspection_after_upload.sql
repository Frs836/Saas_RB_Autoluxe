-- 0069: fix add_order_inspection to allow "after" phase upload after QC approval
--
-- Problem: add_order_inspection only allows uploads when order status is
-- queued, in_progress, or qc_review. After QC approval (status = completed),
-- "after" phase upload fails with "Foto inspeksi hanya bisa diunggah pada
-- order yang sedang dikerjakan."
--
-- Fix: Allow uploads when order status is completed, menunggu_diambil,
-- or diserahkan for "after" phase. Keep existing restrictions for
-- "before" and "process" phases (only during active work).

CREATE OR REPLACE FUNCTION public.add_order_inspection(
  p_order_id  uuid,
  p_phase      public.inspection_phase,
  p_photo_path text,
  p_notes      text
)
RETURNS public.order_inspections
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_profile uuid;
  v_row     public.order_inspections%rowtype;
  v_phase    text;
  v_order    public.orders%rowtype;
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN
    RAISE EXCEPTION 'Foto inspeksi hanya bisa diunggah pengguna yang sudah masuk.';
  END IF;

  v_profile := (SELECT public.current_profile_id());
  IF v_profile IS NULL THEN
    RAISE EXCEPTION 'Sesi tidak valid.';
  END IF;

  -- Sama dengan policy order_inspections_select_authenticated: teknisi hanya
  -- boleh mengunggah untuk order yang bisa ia lihat.
  IF NOT (SELECT public.can_view_order(p_order_id)) THEN
    RAISE EXCEPTION 'Order ini bukan tugas Anda.';
  END IF;

  -- Ambil status order untuk validasi fase
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order tidak ditemukan.';
  END IF;

  v_phase := lower(COALESCE(p_phase::text, ''));
  IF v_phase NOT IN ('before', 'process', 'after') THEN
    RAISE EXCEPTION 'Tahap inspeksi harus before, process, atau after.';
  END IF;

  IF NULLIF(btrim(COALESCE(p_photo_path, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Foto kondisi kendaraan wajib dilampirkan.';
  END IF;

  IF length(btrim(COALESCE(p_notes, ''))) < 5 THEN
    RAISE EXCEPTION 'Catatan kondisi kendaraan minimal 5 karakter.';
  END IF;

  -- Validasi fase "after": butuh foto "before" dulu
  IF p_phase = 'after'::public.inspection_phase AND NOT EXISTS (
    SELECT 1 FROM public.order_inspections i
     WHERE i.order_id = p_order_id
       AND i.phase = 'before'::public.inspection_phase
  ) THEN
    RAISE EXCEPTION 'Foto kondisi awal (before) wajib diunggah lebih dulu.';
  END IF;

  -- Validasi status order sesuai fase:
  -- - before, process: hanya saat order sedang dikerjakan (queued, in_progress, qc_review)
  -- - after: saat pekerjaan sudah selesai (completed, menunggu_diambil, diserahkan)
  --            DAN foto "before" sudah ada
  IF p_phase IN ('before', 'process') THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.orders o
       WHERE o.id = p_order_id
         AND o.status IN ('queued', 'in_progress', 'qc_review')
    ) THEN
      RAISE EXCEPTION 'Foto inspeksi before/process hanya bisa diunggah pada order yang sedang dikerjakan.';
    END IF;
  ELSIF p_phase = 'after' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.orders o
       WHERE o.id = p_order_id
         AND o.status IN ('completed', 'menunggu_diambil', 'diserahkan')
    ) THEN
      RAISE EXCEPTION 'Foto inspeksi after hanya bisa diunggah setelah QC disetujui (status selesai).';
    END IF;
  END IF;

  -- Cek duplikat fase (maks 5 foto per fase)
  IF (SELECT count(*) FROM public.order_inspections i
       WHERE i.order_id = p_order_id
         AND i.phase = p_phase) >= 5 THEN
    RAISE EXCEPTION 'Maksimal 5 foto per tahap inspeksi.';
  END IF;

  IF NULLIF(btrim(COALESCE(p_photo_path, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Foto kondisi kendaraan wajib dilampirkan.';
  END IF;

  IF length(btrim(COALESCE(p_notes, ''))) < 5 THEN
    RAISE EXCEPTION 'Catatan kondisi kendaraan minimal 5 karakter.';
  END IF;

  INSERT INTO public.order_inspections (
    order_id, phase, photo_url, notes, inspector_id
  ) VALUES (
    p_order_id, p_phase, btrim(p_photo_path), btrim(p_notes), v_profile
  ) RETURNING * INTO v_row;

  INSERT INTO public.activity_logs (actor_id, action, entity, entity_id, metadata)
  VALUES (
    v_profile, 'inspection.add', 'order', p_order_id,
    jsonb_build_object('phase', v_phase)
  );

  RETURN v_row;
END;
$function$;

REVOKE ALL ON FUNCTION public.add_order_inspection(uuid, public.inspection_phase, text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.add_order_inspection(uuid, public.inspection_phase, text, text)
  TO authenticated;