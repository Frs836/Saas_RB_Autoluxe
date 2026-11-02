-- 0100: Fix record_order_payment — ganti user_id → auth_id di lookup profiles
-- Bug: query "WHERE user_id = v_user_id" gagal karena kolom profilnya auth_id,
-- bukan user_id. Juga ubah p_payment_type agar hanya terima 'pelunasan' dan
-- 'full' (DP dilakukan di POS saat order dibuat, bukan di halaman kas).

CREATE OR REPLACE FUNCTION public.record_order_payment(
  p_order_id      uuid,
  p_amount        numeric,
  p_payment_method public.payment_method,
  p_payment_type  text,          -- 'dp' | 'pelunasan' | 'full'
  p_note          text DEFAULT NULL
)
RETURNS public.orders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id    uuid;
  v_profile_id uuid;
  v_role       text;
  v_order      public.orders%ROWTYPE;
  v_new_paid   numeric(12,2);
BEGIN
  -- Auth
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Hanya pengguna yang sudah masuk yang bisa mencatat pembayaran.';
  END IF;

  -- Ambil profil — kolom yang benar adalah auth_id, bukan user_id
  SELECT id, role::text INTO v_profile_id, v_role
  FROM public.profiles
  WHERE auth_id = v_user_id
  LIMIT 1;

  IF v_profile_id IS NULL THEN
    RAISE EXCEPTION 'Profil tidak ditemukan.';
  END IF;

  -- Hanya owner, admin_kasir, maintainer
  IF v_role NOT IN ('owner', 'admin_kasir', 'maintainer') THEN
    RAISE EXCEPTION 'Peran % tidak berwenang mencatat pembayaran.', v_role;
  END IF;

  -- Validasi input
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Jumlah pembayaran harus lebih dari 0.';
  END IF;

  IF p_payment_type NOT IN ('dp', 'pelunasan', 'full') THEN
    RAISE EXCEPTION 'Tipe pembayaran tidak valid: gunakan dp, pelunasan, atau full.';
  END IF;

  -- Ambil order
  SELECT * INTO v_order
  FROM public.orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order tidak ditemukan.';
  END IF;

  IF v_order.status IN ('cancelled'::public.order_status, 'diserahkan'::public.order_status) THEN
    RAISE EXCEPTION 'Tidak bisa mencatat pembayaran untuk order berstatus %.', v_order.status;
  END IF;

  IF v_order.payment_state = 'paid'::public.order_payment_state THEN
    RAISE EXCEPTION 'Order ini sudah lunas.';
  END IF;

  -- Hitung paid_amount baru
  v_new_paid := COALESCE(v_order.paid_amount, 0) + p_amount;

  -- Catat ke order_payments
  INSERT INTO public.order_payments (order_id, amount, payment_method, payment_type, recorded_by, note)
  VALUES (p_order_id, p_amount, p_payment_method, p_payment_type, v_profile_id, p_note);

  -- Update order: payment_state dan paid_amount
  PERFORM pg_catalog.set_config('app.trusted_order_write', 'on', true);

  IF v_new_paid >= v_order.total_price THEN
    -- Lunas
    UPDATE public.orders
    SET payment_state = 'paid'::public.order_payment_state,
        paid_amount   = v_order.total_price,
        paid_by       = v_profile_id,
        paid_at       = now(),
        updated_at    = now()
    WHERE id = p_order_id;

    -- Kalau sedang menunggu pembayaran, advance ke menunggu_diambil
    IF v_order.status = 'menunggu_pembayaran'::public.order_status THEN
      UPDATE public.orders
      SET status = 'menunggu_diambil'::public.order_status,
          updated_at = now()
      WHERE id = p_order_id;
    END IF;
  ELSE
    -- Partial (DP)
    UPDATE public.orders
    SET payment_state = 'partial'::public.order_payment_state,
        paid_amount   = v_new_paid,
        updated_at    = now()
    WHERE id = p_order_id;
  END IF;

  PERFORM pg_catalog.set_config('app.trusted_order_write', 'off', true);

  -- Catat ke cash_flow
  INSERT INTO public.cash_flow (type, category, amount, payment_method, order_id, branch_id, created_by)
  SELECT 'in'::public.cash_flow_type,
         'pos_order',
         p_amount,
         p_payment_method,
         p_order_id,
         o.branch_id,
         v_profile_id
  FROM public.orders o
  WHERE o.id = p_order_id;

  -- Activity log
  INSERT INTO public.activity_logs (action, entity, entity_id, actor_id, metadata)
  VALUES (
    'payment_recorded', 'order', p_order_id, v_profile_id,
    jsonb_build_object(
      'amount', p_amount,
      'payment_method', p_payment_method::text,
      'payment_type', p_payment_type,
      'new_payment_state', CASE WHEN v_new_paid >= v_order.total_price THEN 'paid' ELSE 'partial' END
    )
  );

  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id;
  RETURN v_order;
END;
$$;

REVOKE ALL ON FUNCTION public.record_order_payment(uuid, numeric, public.payment_method, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_order_payment(uuid, numeric, public.payment_method, text, text) TO authenticated;

COMMENT ON FUNCTION public.record_order_payment IS
  '0100: Fix auth_id lookup. Catat DP/pelunasan/full payment. Auto-advance ke menunggu_diambil saat lunas dari menunggu_pembayaran.';
