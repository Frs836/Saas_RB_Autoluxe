-- 0062: perbaiki pemicu garansi agar mengenali nama paket baru + kembalikan kode garansi untuk UI.
--
-- Fungsi apply_order_status memeriksa v_order.service_package untuk kata
-- kunci 'coating', 'ceramic', 'liquid glass', 'nano', 'graphene', 'package'.
-- Paket baru (Graphene Package, Premium Package, Light Package) kini terdeteksi.
--
-- Return type diubah ke text:
--   completed + garansi -> kode garansi (WRT-...)
--   completed tanpa garansi -> null
--   in_progress / qc_review -> null
-- UI memeriksa typeof data === 'string' untuk mendeteksi kode garansi.

DROP FUNCTION IF EXISTS public.apply_order_status(uuid, public.order_status) CASCADE;

CREATE OR REPLACE FUNCTION public.apply_order_status(p_order_id uuid, p_status public.order_status)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_order      public.orders%rowtype;
  v_profile    uuid;
  v_started    timestamptz;
  v_warranty   text;
  v_reviewer   uuid;
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

  IF p_status = 'in_progress'::public.order_status THEN
    IF v_order.status <> 'queued'::public.order_status THEN
      RAISE EXCEPTION 'Hanya order berstatus antre yang bisa dimulai.';
    END IF;

    IF v_order.assigned_to IS NULL THEN
      RAISE EXCEPTION 'Order belum memiliki teknisi. Tetapkan tim terlebih dahulu.';
    END IF;

    PERFORM pg_catalog.set_config('app.trusted_order_write', 'on', true);
    UPDATE public.orders
       SET status     = 'in_progress'::public.order_status,
           started_by = v_profile,
           started_at = now()
     WHERE id = p_order_id;
    PERFORM pg_catalog.set_config('app.trusted_order_write', 'off', true);

    PERFORM public.consume_order_materials(p_order_id);

    RETURN null;
  END IF;

  IF p_status = 'qc_review'::public.order_status THEN
    IF v_order.status <> 'in_progress'::public.order_status THEN
      RAISE EXCEPTION 'Hanya order yang sedang dikerjakan yang bisa masuk QC.';
    END IF;

    PERFORM pg_catalog.set_config('app.trusted_order_write', 'on', true);
    UPDATE public.orders
       SET status = 'qc_review'::public.order_status
     WHERE id = p_order_id;
    PERFORM pg_catalog.set_config('app.trusted_order_write', 'off', true);

    RETURN null;
  END IF;

  IF p_status = 'completed'::public.order_status THEN
    IF v_order.status <> 'qc_review'::public.order_status THEN
      RAISE EXCEPTION 'Hanya order yang sudah lewat QC yang bisa diselesaikan.';
    END IF;

    -- Hanya owner, admin_kasir, maintainer yang boleh menyetujui QC
    IF NOT COALESCE((
      SELECT public.has_role(ARRAY['owner','admin_kasir','maintainer']::public.user_role[])
    ), false) THEN
      RAISE EXCEPTION 'Persetujuan QC hanya bisa dilakukan oleh owner, admin kasir, atau maintainer.';
    END IF;

    v_started := now();

    -- Cek apakah layanan memenuhi syarat garansi (coating, ceramic, graphene, dll)
    IF NOT (
      strpos(lower(v_order.service_package), 'coating') > 0
      or strpos(lower(v_order.service_package), 'ceramic') > 0
      or strpos(lower(v_order.service_package), 'liquid glass') > 0
      or strpos(lower(v_order.service_package), 'nano') > 0
      or strpos(lower(v_order.service_package), 'graphene') > 0
      or strpos(lower(v_order.service_package), 'package') > 0
    ) THEN
      -- Bukan layanan coating/garansi, langsung selesaikan tanpa garansi
      PERFORM pg_catalog.set_config('app.trusted_order_write', 'on', true);
      UPDATE public.orders
         SET status = 'completed'::public.order_status,
             completed_at = v_started
       WHERE id = p_order_id;
      PERFORM pg_catalog.set_config('app.trusted_order_write', 'off', true);

      INSERT INTO public.activity_logs (actor_id, action, entity, entity_id, metadata)
      VALUES (
        v_profile,
        'order.completed',
        'order', p_order_id,
        jsonb_build_object(
          'order_number', v_order.order_number,
          'warranty', false
        )
      );

      RETURN null;
    END IF;

    -- Buat sertifikat garansi 180 hari
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
       SET status = 'completed'::public.order_status,
           completed_at = v_started
     WHERE id = p_order_id;
    PERFORM pg_catalog.set_config('app.trusted_order_write', 'off', true);

    SELECT o.assigned_to INTO v_reviewer FROM public.orders o WHERE o.id = p_order_id;
    IF v_reviewer IS NOT NULL THEN
      INSERT INTO public.notifications (recipient_id, title, body, category, payload)
      VALUES (
        v_reviewer,
        'QC selesai untuk ' || v_order.order_number,
        'Unit ' || v_order.license_plate || ' telah disetujui QC. Sertifikat garansi: ' || coalesce(v_warranty, 'tidak berlaku untuk layanan ini') || '.',
        'order',
        jsonb_build_object('order_id', p_order_id, 'warranty_code', v_warranty)
      );
    END IF;

    INSERT INTO public.activity_logs (actor_id, action, entity, entity_id, metadata)
    VALUES (
      v_profile,
      'order.completed',
      'order', p_order_id,
      jsonb_build_object(
        'order_number', v_order.order_number,
        'warranty', true,
        'warranty_code', v_warranty
      )
    );

    RETURN v_warranty;
  END IF;

  RAISE EXCEPTION 'Transisi status % tidak didukung.', p_status;
END;
$function$;

REVOKE ALL ON FUNCTION public.apply_order_status(uuid, public.order_status)
  FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.apply_order_status(uuid, public.order_status)
  TO authenticated;