-- 0118_karyawan_complete_wash_order.sql
-- ============================================================
-- Fix: karyawan dan kepala_karyawan bisa menyelesaikan order wash
-- secara langsung (in_progress → completed) tanpa perlu approval
-- manajerial. Ini sesuai operasional: office masuk jam 10, sedangkan
-- karyawan sudah kerja dari jam 07:30.
--
-- Aturan yang berlaku setelah fix:
--   wash    : tim order (karyawan/kepala_karyawan) ATAU manajerial
--   poles   : hanya manajerial (ada QC review dulu)
--   coating : hanya manajerial (ada QC review dulu)
-- ============================================================

CREATE OR REPLACE FUNCTION public.apply_order_status(
  p_order_id uuid,
  p_status   public.order_status
)
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
  v_is_manager  boolean;
  v_in_team     boolean;
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN
    RAISE EXCEPTION 'Perubahan status hanya bisa dilakukan oleh pengguna yang sudah masuk.';
  END IF;

  v_profile := (SELECT public.current_profile_id());
  IF v_profile IS NULL THEN
    RAISE EXCEPTION 'Sesi tidak valid.';
  END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order tidak ditemukan.';
  END IF;

  IF NOT COALESCE(public.can_access_branch(v_order.branch_id), false) THEN
    RAISE EXCEPTION 'Order ini berada di luar cabang Anda.';
  END IF;

  v_category := public.detect_service_category(COALESCE(v_order.service_package, ''));

  -- Cek apakah caller adalah manajerial
  v_is_manager := COALESCE((
    SELECT public.has_role(ARRAY[
      'owner','admin_kasir','maintainer','manager','kepala_karyawan'
    ]::public.user_role[])
  ), false);

  -- ─────────────────────────────────────────────────
  -- TRANSISI: queued → in_progress atau qc_review → in_progress
  -- ─────────────────────────────────────────────────
  IF p_status = 'in_progress'::public.order_status THEN
    IF v_order.status NOT IN (
      'queued'::public.order_status,
      'qc_review'::public.order_status
    ) THEN
      RAISE EXCEPTION 'Order hanya bisa dimulai dari status antre atau dikembalikan dari QC.';
    END IF;

    IF v_order.assigned_to IS NULL THEN
      RAISE EXCEPTION 'Order belum memiliki teknisi. Tetapkan tim terlebih dahulu.';
    END IF;

    PERFORM pg_catalog.set_config('app.trusted_order_write', 'on', true);
    UPDATE public.orders
       SET status     = 'in_progress'::public.order_status,
           started_by = CASE WHEN v_order.status = 'queued' THEN v_profile ELSE started_by END,
           started_at = CASE WHEN v_order.status = 'queued' THEN now() ELSE started_at END
     WHERE id = p_order_id;
    PERFORM pg_catalog.set_config('app.trusted_order_write', 'off', true);

    IF v_order.status = 'queued'::public.order_status THEN
      PERFORM public.consume_order_materials(p_order_id);
    END IF;

    IF v_order.status = 'qc_review'::public.order_status THEN
      INSERT INTO public.activity_logs (actor_id, action, entity, entity_id, metadata)
      VALUES (
        v_profile, 'order.qc_revision', 'order', p_order_id,
        jsonb_build_object(
          'order_number', v_order.order_number,
          'reason', 'QC gagal — dikembalikan ke pengerjaan'
        )
      );
    END IF;

    RETURN null;
  END IF;

  -- ─────────────────────────────────────────────────
  -- TRANSISI: in_progress → qc_review
  -- Hanya untuk poles dan coating
  -- ─────────────────────────────────────────────────
  IF p_status = 'qc_review'::public.order_status THEN
    IF v_order.status <> 'in_progress'::public.order_status THEN
      RAISE EXCEPTION 'Hanya order yang sedang dikerjakan yang bisa masuk QC.';
    END IF;

    IF v_category = 'wash' THEN
      RAISE EXCEPTION
        'Layanan cuci (wash) tidak memerlukan QC. Gunakan tombol "Selesaikan".';
    END IF;

    PERFORM pg_catalog.set_config('app.trusted_order_write', 'on', true);
    UPDATE public.orders
       SET status = 'qc_review'::public.order_status
     WHERE id = p_order_id;
    PERFORM pg_catalog.set_config('app.trusted_order_write', 'off', true);

    INSERT INTO public.notifications (recipient_id, title, body, category, payload)
    SELECT p.id,
           'QC Review diperlukan: ' || v_order.order_number,
           'Unit ' || v_order.license_plate || ' (' || v_order.vehicle_model || ') siap untuk QC Review.',
           'order',
           jsonb_build_object('order_id', p_order_id, 'action', 'qc_review')
      FROM public.profiles p
     WHERE p.branch_id = v_order.branch_id
       AND p.role IN (
         'owner'::public.user_role,
         'admin_kasir'::public.user_role,
         'maintainer'::public.user_role,
         'manager'::public.user_role,
         'kepala_karyawan'::public.user_role
       )
       AND p.is_active;

    RETURN null;
  END IF;

  -- ─────────────────────────────────────────────────
  -- TRANSISI: → completed
  -- wash    : tim order (karyawan/kepala_karyawan) ATAU manajerial
  -- poles/coating : hanya manajerial (approval QC)
  -- ─────────────────────────────────────────────────
  IF p_status = 'completed'::public.order_status THEN

    IF v_category = 'wash' THEN
      -- Wash: boleh dari in_progress langsung
      IF v_order.status <> 'in_progress'::public.order_status THEN
        RAISE EXCEPTION 'Layanan cuci hanya bisa diselesaikan saat sedang dikerjakan.';
      END IF;

      -- Cek apakah caller ada di tim order ini (anggota atau lead)
      v_in_team := EXISTS (
        SELECT 1 FROM public.order_team_members t
         WHERE t.order_id = p_order_id
           AND t.profile_id = v_profile
      );

      -- Wash: tim order ATAU manajerial boleh selesaikan
      IF NOT v_in_team AND NOT v_is_manager THEN
        RAISE EXCEPTION
          'Hanya anggota tim order atau manajerial yang bisa menyelesaikan order ini.';
      END IF;

    ELSE
      -- Poles/Coating: harus dari qc_review
      IF v_order.status <> 'qc_review'::public.order_status THEN
        RAISE EXCEPTION 'Order % harus melewati QC sebelum bisa diselesaikan.', v_category;
      END IF;

      -- Poles/Coating: hanya manajerial
      IF NOT v_is_manager THEN
        RAISE EXCEPTION
          'Penyelesaian order % hanya bisa dilakukan oleh kepala karyawan, manager, atau manajerial.',
          v_category;
      END IF;
    END IF;

    v_started := now();

    IF v_order.payment_state = 'paid'::public.order_payment_state THEN
      v_next_status := 'menunggu_diambil'::public.order_status;
    ELSE
      v_next_status := 'menunggu_pembayaran'::public.order_status;
    END IF;

    IF v_category <> 'coating' THEN
      PERFORM pg_catalog.set_config('app.trusted_order_write', 'on', true);
      UPDATE public.orders
         SET status = v_next_status,
             completed_at = v_started,
             updated_at = now()
       WHERE id = p_order_id;
      PERFORM pg_catalog.set_config('app.trusted_order_write', 'off', true);

      INSERT INTO public.activity_logs (actor_id, action, entity, entity_id, metadata)
      VALUES (
        v_profile, 'order.completed', 'order', p_order_id,
        jsonb_build_object(
          'order_number', v_order.order_number,
          'category', v_category,
          'warranty', false,
          'routed_to', v_next_status::text
        )
      );
      RETURN null;
    END IF;

    -- Coating: terbitkan garansi
    INSERT INTO public.warranties (order_id, warranty_code, start_date, end_date)
    VALUES (
      p_order_id,
      'WRT-' || v_order.order_number,
      v_started,
      v_started + interval '180 days'
    )
    ON CONFLICT (order_id) DO NOTHING
    RETURNING warranty_code INTO v_warranty;

    IF v_warranty IS NULL THEN
      SELECT w.warranty_code INTO v_warranty
        FROM public.warranties w
       WHERE w.order_id = p_order_id;
    END IF;

    PERFORM pg_catalog.set_config('app.trusted_order_write', 'on', true);
    UPDATE public.orders
       SET status = v_next_status,
           completed_at = v_started,
           updated_at = now()
     WHERE id = p_order_id;
    PERFORM pg_catalog.set_config('app.trusted_order_write', 'off', true);

    SELECT o.assigned_to INTO v_reviewer FROM public.orders o WHERE o.id = p_order_id;
    IF v_reviewer IS NOT NULL THEN
      INSERT INTO public.notifications (recipient_id, title, body, category, payload)
      VALUES (
        v_reviewer,
        'QC selesai untuk ' || v_order.order_number,
        'Unit ' || v_order.license_plate || ' telah disetujui QC. Garansi: ' || coalesce(v_warranty, '-') || '.',
        'order',
        jsonb_build_object('order_id', p_order_id, 'warranty_code', v_warranty)
      );
    END IF;

    INSERT INTO public.activity_logs (actor_id, action, entity, entity_id, metadata)
    VALUES (
      v_profile, 'order.completed', 'order', p_order_id,
      jsonb_build_object(
        'order_number', v_order.order_number,
        'category', v_category,
        'warranty', true,
        'warranty_code', v_warranty,
        'routed_to', v_next_status::text
      )
    );

    RETURN v_warranty;
  END IF;

  RAISE EXCEPTION 'Transisi status % tidak didukung.', p_status;
END;
$function$;

COMMENT ON FUNCTION public.apply_order_status IS
  '0118: Wash — tim order (karyawan/kepala_karyawan) atau manajerial bisa selesaikan langsung. Poles/Coating — tetap perlu QC dan hanya manajerial yang approve.';
