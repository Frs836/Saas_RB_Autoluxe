-- 0102: Fix record_order_payment — gabung dua UPDATE jadi satu per branch
--
-- Bug: trigger orders_trusted_flag_cleanup (AFTER UPDATE FOR EACH STATEMENT)
-- me-reset app.trusted_order_write ke 'off' setelah UPDATE pertama (payment_state).
-- UPDATE kedua (status = menunggu_diambil) kemudian gagal karena flag sudah 'off'.
--
-- Fix: gabungkan UPDATE payment_state DAN status menjadi satu UPDATE tunggal
-- sehingga trigger cleanup hanya terpanggil satu kali, setelah seluruh
-- perubahan sudah masuk ke baris yang sama.

CREATE OR REPLACE FUNCTION public.record_order_payment(
  p_order_id       uuid,
  p_amount         numeric,
  p_payment_method public.payment_method,
  p_payment_type   text,          -- 'dp' | 'pelunasan' | 'full'
  p_note           text DEFAULT NULL
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
  v_new_state  public.order_payment_state;
  v_new_status public.order_status;
BEGIN
  -- Auth
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Hanya pengguna yang sudah masuk yang bisa mencatat pembayaran.';
  END IF;

  SELECT id, role::text INTO v_profile_id, v_role
  FROM public.profiles
  WHERE auth_id = v_user_id
  LIMIT 1;

  IF v_profile_id IS NULL THEN
    RAISE EXCEPTION 'Profil tidak ditemukan.';
  END IF;

  IF v_role NOT IN ('owner', 'admin_kasir', 'maintainer') THEN
    RAISE EXCEPTION 'Peran % tidak berwenang mencatat pembayaran.', v_role;
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Jumlah pembayaran harus lebih dari 0.';
  END IF;

  IF p_payment_type NOT IN ('dp', 'pelunasan', 'full') THEN
    RAISE EXCEPTION 'Tipe pembayaran tidak valid: gunakan dp, pelunasan, atau full.';
  END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order tidak ditemukan.';
  END IF;

  IF v_order.status IN ('cancelled'::public.order_status, 'diserahkan'::public.order_status) THEN
    RAISE EXCEPTION 'Tidak bisa mencatat pembayaran untuk order berstatus %.', v_order.status;
  END IF;

  IF v_order.payment_state = 'paid'::public.order_payment_state THEN
    RAISE EXCEPTION 'Order ini sudah lunas.';
  END IF;

  v_new_paid := COALESCE(v_order.paid_amount, 0) + p_amount;

  -- Tentukan state dan status baru SEBELUM update
  IF v_new_paid >= v_order.total_price THEN
    v_new_state  := 'paid'::public.order_payment_state;
    -- Jika sedang menunggu pembayaran → langsung siap diambil
    v_new_status := CASE
      WHEN v_order.status = 'menunggu_pembayaran'::public.order_status
      THEN 'menunggu_diambil'::public.order_status
      ELSE v_order.status
    END;
  ELSE
    v_new_state  := 'partial'::public.order_payment_state;
    v_new_status := v_order.status;   -- status tidak berubah untuk DP/cicilan
  END IF;

  -- Catat pembayaran
  INSERT INTO public.order_payments (order_id, amount, payment_method, payment_type, recorded_by, note)
  VALUES (p_order_id, p_amount, p_payment_method, p_payment_type, v_profile_id, p_note);

  -- SATU UPDATE tunggal agar trigger cleanup hanya dipanggil sekali
  PERFORM pg_catalog.set_config('app.trusted_order_write', 'on', true);

  UPDATE public.orders
  SET
    payment_state = v_new_state,
    paid_amount   = CASE WHEN v_new_paid >= total_price THEN total_price ELSE v_new_paid END,
    paid_by       = CASE WHEN v_new_state = 'paid' THEN v_profile_id ELSE paid_by END,
    paid_at       = CASE WHEN v_new_state = 'paid' THEN now() ELSE paid_at END,
    status        = v_new_status,
    updated_at    = now()
  WHERE id = p_order_id
  RETURNING * INTO v_order;

  -- trusted_flag_cleanup trigger otomatis me-reset flag setelah UPDATE ini

  -- Catat ke cash_flow
  INSERT INTO public.cash_flow (type, category, amount, payment_method, order_id, branch_id, created_by)
  VALUES (
    'in'::public.cash_flow_type,
    'pos_order',
    p_amount,
    p_payment_method,
    p_order_id,
    v_order.branch_id,
    v_profile_id
  );

  -- Activity log
  INSERT INTO public.activity_logs (action, entity, entity_id, actor_id, metadata)
  VALUES (
    'payment_recorded', 'order', p_order_id, v_profile_id,
    jsonb_build_object(
      'amount',            p_amount,
      'payment_method',    p_payment_method::text,
      'payment_type',      p_payment_type,
      'new_payment_state', v_new_state::text,
      'new_status',        v_new_status::text
    )
  );

  RETURN v_order;
END;
$$;

REVOKE ALL ON FUNCTION public.record_order_payment(uuid, numeric, public.payment_method, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_order_payment(uuid, numeric, public.payment_method, text, text) TO authenticated;

COMMENT ON FUNCTION public.record_order_payment IS
  '0102: Single UPDATE to avoid trusted_flag_cleanup trigger resetting flag mid-function.';
