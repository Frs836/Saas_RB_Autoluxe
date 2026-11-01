CREATE OR REPLACE FUNCTION public.record_order_payment(
  p_order_id uuid,
  p_amount numeric,
  p_payment_method public.payment_method,
  p_payment_type text,
  p_note text DEFAULT NULL
)
RETURNS public.orders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_profile_id uuid;
  v_role text;
  v_order public.orders%ROWTYPE;
  v_new_paid_amount numeric(12,2);
BEGIN
  -- Auth check
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Get profile id and role
  SELECT id, role INTO v_profile_id, v_role
  FROM public.profiles
  WHERE user_id = v_user_id
  LIMIT 1;

  -- Role check
  IF v_role NOT IN ('owner', 'admin_kasir', 'maintainer') THEN
    RAISE EXCEPTION 'Access denied: role % cannot record payments', v_role;
  END IF;

  -- Validate inputs
  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'Payment amount must be greater than 0';
  END IF;

  IF p_payment_type NOT IN ('dp', 'pelunasan', 'full') THEN
    RAISE EXCEPTION 'Invalid payment_type: must be dp, pelunasan, or full';
  END IF;

  -- Fetch order FOR UPDATE
  SELECT * INTO v_order
  FROM public.orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found';
  END IF;

  IF v_order.status IN ('cancelled', 'diserahkan') THEN
    RAISE EXCEPTION 'Cannot record payment for order with status %', v_order.status;
  END IF;

  -- Insert payment record
  INSERT INTO public.order_payments (order_id, amount, payment_method, payment_type, recorded_by, note)
  VALUES (p_order_id, p_amount, p_payment_method, p_payment_type, v_profile_id, p_note);

  -- Calculate new paid_amount
  v_new_paid_amount := COALESCE(v_order.paid_amount, 0) + p_amount;

  -- Update order payment state
  PERFORM pg_catalog.set_config('app.trusted_order_write', 'on', true);
  IF v_new_paid_amount >= v_order.total_price THEN
    UPDATE public.orders
    SET
      payment_state = 'paid',
      paid_amount = v_order.total_price,
      paid_by = v_profile_id,
      paid_at = now()
    WHERE id = p_order_id;

    -- If order is in menunggu_pembayaran, advance to menunggu_diambil
    IF v_order.status = 'menunggu_pembayaran' THEN
      UPDATE public.orders
      SET status = 'menunggu_diambil', updated_at = now()
      WHERE id = p_order_id;
    END IF;
  ELSE
    UPDATE public.orders
    SET
      payment_state = 'partial',
      paid_amount = v_new_paid_amount
    WHERE id = p_order_id;
  END IF;
  PERFORM pg_catalog.set_config('app.trusted_order_write', 'off', true);

  -- Insert cash_flow record
  INSERT INTO public.cash_flow (type, category, amount, payment_method, order_id, branch_id, created_by)
  SELECT
    'in',
    'pos_order',
    p_amount,
    p_payment_method,
    p_order_id,
    o.branch_id,
    v_profile_id
  FROM public.orders o
  WHERE o.id = p_order_id;

  -- Insert activity log
  INSERT INTO public.activity_logs (action, entity, entity_id, actor_id, metadata)
  VALUES (
    'payment_recorded',
    'order',
    p_order_id,
    v_profile_id,
    jsonb_build_object(
      'amount', p_amount,
      'payment_method', p_payment_method,
      'payment_type', p_payment_type
    )
  );

  -- Return updated order
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id;
  RETURN v_order;
END;
$$;
