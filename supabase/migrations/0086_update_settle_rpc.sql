-- 0086: Update settle_order_payment RPC
-- Tambah paid_by, paid_at tracking, return paid_by & paid_at

CREATE OR REPLACE FUNCTION public.settle_order_payment(
  p_order_id        uuid,
  p_paid_amount     numeric,
  p_payment_method  public.payment_method DEFAULT 'cash',
  p_paid_by         uuid DEFAULT NULL
)
RETURNS public.orders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_profile_id  uuid;
  v_order       public.orders%rowtype;
  v_actual_paid_by uuid;
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN
    RAISE EXCEPTION 'Hanya pengguna yang sudah masuk yang bisa menyelesaikan pembayaran.';
  END IF;

  v_profile_id := (SELECT public.current_profile_id());
  IF v_profile_id IS NULL THEN
    RAISE EXCEPTION 'Sesi tidak valid.';
  END IF;

  -- Gunakan p_paid_by jika disediakan, fallback ke current user
  v_actual_paid_by := COALESCE(p_paid_by, v_profile_id);

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

  -- Validasi nominal >= total_price
  IF p_paid_amount < v_order.total_price THEN
    RAISE EXCEPTION 'Jumlah pembayaran tidak boleh kurang dari total order (Rp %).', v_order.total_price;
  END IF;

  -- Validasi cash_hold HANYA untuk order yang memang punya cash_hold (karyawan Bayar Sekarang)
  IF v_order.cash_hold_amount IS NOT NULL AND v_order.cash_hold_amount > 0 THEN
    IF p_paid_amount > v_order.cash_hold_amount THEN
      RAISE EXCEPTION 'Jumlah bayar melebihi uang titipan (%).', v_order.cash_hold_amount;
    END IF;

    UPDATE public.orders
    SET payment_state = 'paid'::public.order_payment_state,
        cash_hold_profile_id = NULL,
        cash_hold_amount = NULL,
        cash_hold_payment_method = NULL,
        paid_by = v_actual_paid_by,
        paid_at = now(),
        updated_at = now()
    WHERE id = p_order_id
    RETURNING * INTO v_order;

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
        paid_by = v_actual_paid_by,
        paid_at = now(),
        updated_at = now()
    WHERE id = p_order_id
    RETURNING * INTO v_order;

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
$$;

REVOKE ALL ON FUNCTION public.settle_order_payment(uuid, numeric, public.payment_method, uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.settle_order_payment(uuid, numeric, public.payment_method, uuid) TO authenticated;

COMMENT ON FUNCTION public.settle_order_payment(uuid, numeric, public.payment_method, uuid) IS 'Menyelesaikan pembayaran order Bayar Nanti. Return order dengan paid_by & paid_at.';
