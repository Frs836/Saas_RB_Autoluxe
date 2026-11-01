CREATE OR REPLACE FUNCTION public.advance_handover(p_order_id uuid, p_next order_status)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_order   public.orders%rowtype;
  v_profile uuid;
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN
    RAISE EXCEPTION 'Status serah terima hanya bisa diubah oleh pengguna yang sudah masuk.';
  END IF;

  v_profile := public.current_profile_id();
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

  IF NOT COALESCE((
    SELECT public.has_role(array['owner','admin_kasir','maintainer','karyawan']::public.user_role[])
  ), false) THEN
    RAISE EXCEPTION 'Peran Anda tidak berwenang mengubah status serah terima.';
  END IF;

  -- Validasi transisi yang diizinkan
  IF NOT (
    (v_order.status = 'menunggu_pembayaran' AND p_next = 'menunggu_diambil') OR
    (v_order.status = 'menunggu_diambil'    AND p_next = 'diserahkan')
  ) THEN
    RAISE EXCEPTION
      'Status tidak bisa berubah dari % ke %. Alur: menunggu_pembayaran, menunggu_diambil, diserahkan.',
      v_order.status, p_next
      USING errcode = '22023';
  END IF;

  -- Cek payment_state: harus lunas untuk semua transisi handover
  IF v_order.payment_state IN ('unpaid'::public.order_payment_state, 'partial'::public.order_payment_state) THEN
    RAISE EXCEPTION 'Order ini belum lunas. Selesaikan pembayaran terlebih dahulu via Kas > Bayar Nanti.';
  END IF;

  PERFORM pg_catalog.set_config('app.trusted_order_write', 'on', true);

  UPDATE public.orders
     SET status = p_next,
         completed_at = CASE WHEN p_next = 'diserahkan' THEN now() ELSE completed_at END,
         updated_at = now()
   WHERE id = p_order_id;

  PERFORM pg_catalog.set_config('app.trusted_order_write', 'off', true);

  INSERT INTO public.activity_logs (actor_id, action, entity, entity_id, metadata)
  VALUES (
    v_profile, 'order.status.' || p_next::text, 'order', p_order_id,
    jsonb_build_object(
      'from', v_order.status, 'to', p_next::text,
      'order_number', v_order.order_number, 'branch_id', v_order.branch_id
    )
  );

  RETURN p_next::text;
END;
$function$;
