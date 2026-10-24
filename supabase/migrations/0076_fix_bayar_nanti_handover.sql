-- ============================================================
-- Fix Bayar Nanti flow: enforce payment before handover
-- ============================================================
-- 1. advance_handover: tolak jika payment_state = 'unpaid'
-- 2. settle_order_payment: support order Bayar Nanti tanpa cash_hold
-- ============================================================

-- ---------------------------------------------------------------------------
-- 1. FIX advance_handover: cek payment_state sebelum serah terima
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.advance_handover(
  p_order_id uuid,
  p_next     public.order_status
)
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

  -- BLOK BARU: Cek payment_state sebelum handover
  -- Order dengan payment_state = 'unpaid' (Bayar Nanti) tidak boleh diserahkan
  IF v_order.payment_state = 'unpaid'::public.order_payment_state THEN
    RAISE EXCEPTION 'Order ini belum lunas (Bayar Nanti). Selesaikan pembayaran terlebih dahulu via Kas > Bayar Nanti.';
  END IF;

  -- Transisi hanya dua arah yang jelas
  IF NOT (
    (v_order.status = 'completed'           AND p_next = 'menunggu_diambil') OR
    (v_order.status = 'menunggu_diambil'  AND p_next = 'diserahkan')
  ) THEN
    RAISE EXCEPTION
      'Status tidak bisa berubah dari % ke %. Alur: selesai, menunggu diambil, diserahkan.',
      v_order.status, p_next
      USING errcode = '22023';
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

REVOKE ALL ON FUNCTION public.advance_handover(uuid, public.order_status) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.advance_handover(uuid, public.order_status) TO authenticated;

-- ---------------------------------------------------------------------------
-- 2. FIX settle_order_payment: support Bayar Nanti (tanpa cash_hold)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.settle_order_payment(
  p_order_id        uuid,
  p_paid_amount     numeric,
  p_payment_method  public.payment_method DEFAULT 'cash'
)
RETURNS public.orders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_profile_id  uuid;
  v_order       public.orders%rowtype;
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN
    RAISE EXCEPTION 'Hanya pengguna yang sudah masuk yang bisa menyelesaikan pembayaran.';
  END IF;

  v_profile_id := (SELECT public.current_profile_id());
  IF v_profile_id IS NULL THEN
    RAISE EXCEPTION 'Sesi tidak valid.';
  END IF;

  SELECT * INTO v_order
  FROM public.orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order tidak ditemukan.';
  END IF;

  -- Hanya order yang status payment unpaid bisa di-settle
  IF v_order.payment_state <> 'unpaid'::public.order_payment_state THEN
    RAISE EXCEPTION 'Order ini sudah lunas atau tidak dalam status unpaid.';
  END IF;

  IF p_paid_amount IS NULL OR p_paid_amount <= 0 THEN
    RAISE EXCEPTION 'Jumlah pembayaran harus lebih dari 0.';
  END IF;

  IF p_paid_amount > v_order.total_price THEN
    RAISE EXCEPTION 'Jumlah bayar melebihi total order.';
  END IF;

  -- Validasi cash_hold HANYA untuk order yang memang punya cash_hold (karyawan Bayar Sekarang)
  -- Order Bayar Nanti (dibuat karyawan dgn payment_state=unpaid) tidak punya cash_hold
  IF v_order.cash_hold_amount IS NOT NULL AND v_order.cash_hold_amount > 0 THEN
    -- Validasi jumlah bayar tidak melebihi cash_hold
    IF p_paid_amount > v_order.cash_hold_amount THEN
      RAISE EXCEPTION 'Jumlah bayar melebihi uang titipan (%).', v_order.cash_hold_amount;
    END IF;

    -- Update order: clear cash_hold fields
    UPDATE public.orders
    SET payment_state = 'paid'::public.order_payment_state,
        cash_hold_profile_id = NULL,
        cash_hold_amount = NULL,
        cash_hold_payment_method = NULL,
        updated_at = now()
    WHERE id = p_order_id
    RETURNING * INTO v_order;

    -- Catat ke cash_flow sebagai settlement uang titipan karyawan
    INSERT INTO public.cash_flow (
      type, amount, category, description, payment_method, order_id
    ) VALUES (
      'in'::public.cash_flow_type,
      p_paid_amount,
      'employee_cash_hold_settlement',
      v_order.order_number || ' - ' || v_order.service_package || ' (settlement uang titipan)',
      p_payment_method,
      v_order.id
    );
  ELSE
    -- Order Bayar Nanti: hanya update payment_state, tidak ada cash_hold
    UPDATE public.orders
    SET payment_state = 'paid'::public.order_payment_state,
        updated_at = now()
    WHERE id = p_order_id
    RETURNING * INTO v_order;

    -- Catat ke cash_flow sebagai pembayaran normal
    INSERT INTO public.cash_flow (
      type, amount, category, description, payment_method, order_id
    ) VALUES (
      'in'::public.cash_flow_type,
      p_paid_amount,
      'pos_order',
      v_order.order_number || ' - ' || v_order.service_package || ' (Bayar Nanti lunas)',
      p_payment_method,
      v_order.id
    );
  END IF;

  RETURN v_order;
END;
$function$;

REVOKE ALL ON FUNCTION public.settle_order_payment(uuid, numeric, public.payment_method) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.settle_order_payment(uuid, numeric, public.payment_method) TO authenticated;

-- ============================================================
-- CATATAN:
-- - advance_handover sekarang menolak handover jika payment_state = 'unpaid'
-- - settle_order_payment sekarang handle 2 kasus:
--   a) Karyawan Bayar Sekarang (ada cash_hold) -> category employee_cash_hold_settlement
--   b) Bayar Nanti (tidak ada cash_hold) -> category pos_order
-- - Owner/admin_kasir/maintainer bisa settle via Kas > Bayar Nanti tab
-- ============================================================