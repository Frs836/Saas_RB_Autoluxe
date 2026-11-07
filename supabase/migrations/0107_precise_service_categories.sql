-- 0107: Precise service category detection per exact package name
-- Replace 0106's broad keyword matching with exact-name matching.
-- Categories:
--   wash_basic, wash_super, wash_premium, wash_jamur
--   detailing_polish, detailing_interior, detailing_full
--   coating_light, coating_premium, coating_graphene

CREATE OR REPLACE FUNCTION public.detect_service_category(p_service_package text)
RETURNS text
LANGUAGE sql IMMUTABLE
SET search_path TO ''
AS $$
  SELECT CASE
    -- ── COATING (exact package names, checked first/longest match) ──
    WHEN lower(trim(p_service_package)) = 'graphene package'
      THEN 'coating_graphene'
    WHEN lower(trim(p_service_package)) = 'premium package'
      THEN 'coating_premium'
    WHEN lower(trim(p_service_package)) = 'light package'
      THEN 'coating_light'
    -- broader coating fallback (graphene/ceramic/nano keywords)
    WHEN lower(p_service_package) LIKE '%graphene%'
      THEN 'coating_graphene'
    WHEN lower(p_service_package) LIKE '%5 layer%'
      THEN 'coating_graphene'
    WHEN lower(p_service_package) LIKE '%3 layer%'
      OR lower(p_service_package) LIKE '%nano ceramic%'
      THEN 'coating_premium'
    WHEN lower(p_service_package) LIKE '%2 layer%'
      OR lower(p_service_package) LIKE '%nano%'
      THEN 'coating_light'
    WHEN lower(p_service_package) LIKE '%coating%'
      OR lower(p_service_package) LIKE '%ceramic%'
      THEN 'coating_light'

    -- ── DETAILING (exact names) ──
    WHEN lower(trim(p_service_package)) = 'full package'
      OR lower(trim(p_service_package)) = 'detailing full package'
      THEN 'detailing_full'
    WHEN lower(trim(p_service_package)) = 'interior'
      OR lower(trim(p_service_package)) = 'interior detailing'
      THEN 'detailing_interior'
    WHEN lower(trim(p_service_package)) = 'polish'
      OR lower(trim(p_service_package)) = 'polish detailing'
      THEN 'detailing_polish'
    WHEN lower(p_service_package) LIKE '%detailing%'
      OR lower(p_service_package) LIKE '%polish%'
      OR lower(p_service_package) LIKE '%interior%'
      THEN 'detailing_full'

    -- ── WASH (exact names first, then fallback) ──
    WHEN lower(trim(p_service_package)) LIKE '%premium wash%'
      THEN 'wash_premium'
    WHEN lower(trim(p_service_package)) LIKE '%super wash%'
      THEN 'wash_super'
    WHEN lower(trim(p_service_package)) LIKE '%jamur kaca%'
      OR lower(trim(p_service_package)) LIKE '%jamur%'
      THEN 'wash_jamur'
    WHEN lower(trim(p_service_package)) LIKE '%basic wash%'
      THEN 'wash_basic'

    -- Generic wash fallback
    WHEN lower(p_service_package) LIKE '%wash%'
      OR lower(p_service_package) LIKE '%cuci%'
      THEN 'wash_basic'

    -- Default: basic wash
    ELSE 'wash_basic'
  END;
$$;

GRANT EXECUTE ON FUNCTION public.detect_service_category(text) TO authenticated;

-- Helper: apakah kategori ini perlu QC?
CREATE OR REPLACE FUNCTION public.category_needs_qc(p_category text)
RETURNS boolean
LANGUAGE sql IMMUTABLE
SET search_path TO ''
AS $$
  SELECT p_category IN (
    'coating_light', 'coating_premium', 'coating_graphene',
    'detailing_polish', 'detailing_interior', 'detailing_full'
  );
$$;

GRANT EXECUTE ON FUNCTION public.category_needs_qc(text) TO authenticated;

-- Helper: apakah kategori ini menghasilkan garansi?
CREATE OR REPLACE FUNCTION public.category_has_warranty(p_category text)
RETURNS boolean
LANGUAGE sql IMMUTABLE
SET search_path TO ''
AS $$
  SELECT p_category IN (
    'coating_light', 'coating_premium', 'coating_graphene'
  );
$$;

GRANT EXECUTE ON FUNCTION public.category_has_warranty(text) TO authenticated;

-- Update apply_order_status to use new helpers
CREATE OR REPLACE FUNCTION public.apply_order_status(p_order_id uuid, p_status order_status)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_order       public.orders%rowtype;
  v_profile     uuid;
  v_started     timestamptz;
  v_warranty    text;
  v_reviewer    uuid;
  v_next_status public.order_status;
  v_category    text;
  v_needs_qc    boolean;
  v_has_warranty boolean;
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN
    RAISE EXCEPTION 'Perubahan status hanya bisa dilakukan oleh pengguna yang sudah masuk.';
  END IF;

  v_profile := (SELECT public.current_profile_id());
  IF v_profile IS NULL THEN RAISE EXCEPTION 'Sesi tidak valid.'; END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Order tidak ditemukan.'; END IF;

  IF NOT COALESCE(public.can_access_branch(v_order.branch_id), false) THEN
    RAISE EXCEPTION 'Order ini berada di luar cabang Anda.';
  END IF;

  v_category     := public.detect_service_category(COALESCE(v_order.service_package, ''));
  v_needs_qc     := public.category_needs_qc(v_category);
  v_has_warranty := public.category_has_warranty(v_category);

  -- ── queued / qc_review → in_progress ──────────────────────────────
  IF p_status = 'in_progress'::public.order_status THEN
    IF v_order.status NOT IN ('queued','qc_review') THEN
      RAISE EXCEPTION 'Order hanya bisa dimulai dari status antre atau dikembalikan dari QC.';
    END IF;
    IF v_order.assigned_to IS NULL THEN
      RAISE EXCEPTION 'Order belum memiliki teknisi. Tetapkan tim terlebih dahulu.';
    END IF;

    PERFORM pg_catalog.set_config('app.trusted_order_write', 'on', true);
    UPDATE public.orders SET
      status     = 'in_progress',
      started_by = CASE WHEN v_order.status = 'queued' THEN v_profile ELSE started_by END,
      started_at = CASE WHEN v_order.status = 'queued' THEN now()     ELSE started_at END
    WHERE id = p_order_id;
    PERFORM pg_catalog.set_config('app.trusted_order_write', 'off', true);

    IF v_order.status = 'queued' THEN
      PERFORM public.consume_order_materials(p_order_id);
    ELSE
      -- revisi dari QC gagal
      INSERT INTO public.activity_logs (actor_id, action, entity, entity_id, metadata)
      VALUES (v_profile, 'order.qc_revision', 'order', p_order_id,
        jsonb_build_object('order_number', v_order.order_number,
                           'category', v_category, 'reason', 'QC gagal — revisi'));
    END IF;
    RETURN null;
  END IF;

  -- ── in_progress → qc_review ────────────────────────────────────────
  IF p_status = 'qc_review'::public.order_status THEN
    IF v_order.status <> 'in_progress' THEN
      RAISE EXCEPTION 'Hanya order yang sedang dikerjakan yang bisa masuk QC.';
    END IF;
    IF NOT v_needs_qc THEN
      RAISE EXCEPTION 'Paket "%" tidak memerlukan QC. Gunakan tombol Selesaikan.', v_order.service_package;
    END IF;

    PERFORM pg_catalog.set_config('app.trusted_order_write', 'on', true);
    UPDATE public.orders SET status = 'qc_review' WHERE id = p_order_id;
    PERFORM pg_catalog.set_config('app.trusted_order_write', 'off', true);

    -- Notifikasi ke manajerial
    INSERT INTO public.notifications (recipient_id, title, body, category, payload)
    SELECT p.id,
           'QC Review: ' || v_order.order_number,
           'Unit ' || v_order.license_plate || ' (' || v_order.service_package || ') siap QC.',
           'order',
           jsonb_build_object('order_id', p_order_id, 'action', 'qc_review', 'category', v_category)
    FROM public.profiles p
    WHERE p.branch_id = v_order.branch_id
      AND p.role IN ('owner','admin_kasir','maintainer','manager','kepala_karyawan')
      AND p.is_active;
    RETURN null;
  END IF;

  -- ── → completed (selesaikan / setujui QC) ──────────────────────────
  IF p_status = 'completed'::public.order_status THEN
    -- Validasi: wash langsung dari in_progress; lainnya dari qc_review
    IF v_needs_qc THEN
      IF v_order.status <> 'qc_review' THEN
        RAISE EXCEPTION 'Paket "%" harus melewati QC sebelum bisa diselesaikan.', v_order.service_package;
      END IF;
    ELSE
      IF v_order.status <> 'in_progress' THEN
        RAISE EXCEPTION 'Paket "%" hanya bisa diselesaikan saat sedang dikerjakan.', v_order.service_package;
      END IF;
    END IF;

    -- Hak akses manajerial
    IF NOT COALESCE((SELECT public.has_role(
      ARRAY['owner','admin_kasir','maintainer','manager','kepala_karyawan']::public.user_role[]
    )), false) THEN
      RAISE EXCEPTION 'Penyelesaian order hanya bisa dilakukan oleh manajerial.';
    END IF;

    v_started := now();
    IF v_order.payment_state = 'paid' THEN
      v_next_status := 'menunggu_diambil';
    ELSE
      v_next_status := 'menunggu_pembayaran';
    END IF;

    IF v_has_warranty THEN
      INSERT INTO public.warranties (order_id, warranty_code, start_date, end_date)
      VALUES (p_order_id, 'WRT-' || v_order.order_number, v_started, v_started + interval '180 days')
      ON CONFLICT (order_id) DO NOTHING
      RETURNING warranty_code INTO v_warranty;

      IF v_warranty IS NULL THEN
        SELECT w.warranty_code INTO v_warranty FROM public.warranties w WHERE w.order_id = p_order_id;
      END IF;

      SELECT o.assigned_to INTO v_reviewer FROM public.orders o WHERE o.id = p_order_id;
      IF v_reviewer IS NOT NULL THEN
        INSERT INTO public.notifications (recipient_id, title, body, category, payload)
        VALUES (v_reviewer, 'QC selesai: ' || v_order.order_number,
          'Garansi diterbitkan: ' || COALESCE(v_warranty, '-'), 'order',
          jsonb_build_object('order_id', p_order_id, 'warranty_code', v_warranty));
      END IF;
    END IF;

    PERFORM pg_catalog.set_config('app.trusted_order_write', 'on', true);
    UPDATE public.orders SET
      status = v_next_status, completed_at = v_started, updated_at = now()
    WHERE id = p_order_id;
    PERFORM pg_catalog.set_config('app.trusted_order_write', 'off', true);

    INSERT INTO public.activity_logs (actor_id, action, entity, entity_id, metadata)
    VALUES (v_profile, 'order.completed', 'order', p_order_id,
      jsonb_build_object('order_number', v_order.order_number, 'category', v_category,
        'warranty', v_has_warranty, 'warranty_code', v_warranty, 'routed_to', v_next_status::text));

    RETURN v_warranty;
  END IF;

  RAISE EXCEPTION 'Transisi status % tidak didukung.', p_status;
END;
$function$;

COMMENT ON FUNCTION public.detect_service_category IS
  '0107: Precise per-package detection. wash_basic/super/premium/jamur, detailing_polish/interior/full, coating_light/premium/graphene';
