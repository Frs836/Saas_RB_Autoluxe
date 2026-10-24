-- 0074_settle_order_payment.sql
-- RPC untuk menyelesaikan pembayaran order "Bayar Nanti" (unpaid -> paid)
-- Catat ke cash_flow category 'employee_cash_hold_settlement' agar masuk kas cabang (laporan global)

DROP FUNCTION IF EXISTS public.settle_order_payment(uuid, numeric, public.payment_method);

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
  v_cash_held   numeric;
BEGIN
  -- Hanya user yang sudah login
  IF (SELECT auth.uid()) IS NULL THEN
    RAISE EXCEPTION 'Hanya pengguna yang sudah masuk yang bisa menyelesaikan pembayaran.';
  END IF;

  v_profile_id := (SELECT public.current_profile_id());
  IF v_profile_id IS NULL THEN
    RAISE EXCEPTION 'Sesi tidak valid.';
  END IF;

  -- Ambil order, lock row
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

  -- Validasi jumlah bayar
  IF p_paid_amount IS NULL OR p_paid_amount <= 0 THEN
    RAISE EXCEPTION 'Jumlah pembayaran harus lebih dari 0.';
  END IF;

  -- Validasi jumlah bayar tidak melebihi total order
  IF p_paid_amount > v_order.total_price THEN
    RAISE EXCEPTION 'Jumlah bayar melebihi total order.';
  END IF;

  -- Validasi ada cash_hold_amount (order memang unpaid dan dipegang karyawan)
  IF v_order.cash_hold_amount IS NULL OR v_order.cash_hold_amount <= 0 THEN
    RAISE EXCEPTION 'Order ini tidak memiliki uang titipan yang harus diselesaikan.';
  END IF;

  -- Update order: payment_state -> paid, clear cash_hold fields
  UPDATE public.orders
  SET payment_state = 'paid'::public.order_payment_state,
      cash_hold_profile_id = NULL,
      cash_hold_amount = NULL,
      cash_hold_payment_method = NULL,
      updated_at = now()
  WHERE id = p_order_id
  RETURNING * INTO v_order;

  -- Catat ke cash_flow sebagai settlement uang titipan karyawan
  -- category: employee_cash_hold_settlement -> masuk kas cabang (global report)
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

  RETURN v_order;
END;
$function$;

REVOKE ALL ON FUNCTION public.settle_order_payment(uuid, numeric, public.payment_method) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.settle_order_payment(uuid, numeric, public.payment_method) TO authenticated;