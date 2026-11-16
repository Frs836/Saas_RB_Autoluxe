-- 0124: Fix POS Unpaid and DP logic
-- 1. Remove obsolete force-to-paid logic when v_is_staff and NOT start_work
--    (previously caused DP and Bayar Nanti queued orders to be forced to 'paid'
--     and record phantom cash flow, leading to 'Order ini sudah lunas' error on DP recording).
-- 2. Correctly initialize paid_amount, paid_by, paid_at on order creation based on v_state.
-- 3. Only insert full cash_flow when v_state = 'paid'.
-- 4. In record_order_payment: include 'manager' in authorized roles.

CREATE OR REPLACE FUNCTION public.create_pos_order_with_hold(
  p_license_plate   TEXT,
  p_vehicle_model   TEXT,
  p_vehicle_size    public.vehicle_size,
  p_customer_name   TEXT,
  p_customer_phone  TEXT,
  p_service_package TEXT,
  p_items           JSONB,
  p_payment_method  public.payment_method DEFAULT 'cash',
  p_payment_state   TEXT DEFAULT 'paid',
  p_start_work      BOOLEAN DEFAULT FALSE,
  p_team_ids        uuid[] DEFAULT NULL
)
RETURNS public.orders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_profile_id   uuid;
  v_role         public.user_role;
  v_is_staff     boolean;
  v_order        public.orders%rowtype;
  v_total        numeric(12,2) := 0;
  v_qty          numeric(12,2);
  v_price        numeric(12,2);
  v_custom_price numeric(12,2);
  v_final_price  numeric(12,2);
  v_service      public.services%rowtype;
  v_service_id   uuid;
  v_names        text[] := ARRAY[]::text[];
  v_item         jsonb;
  v_state        public.order_payment_state;
  v_category     text;
  v_holds_cash   boolean;
  v_service_pkg  text;
  v_team         uuid[] := COALESCE(p_team_ids, ARRAY[]::uuid[]);
  v_discount_note text;
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN
    RAISE EXCEPTION 'Order hanya bisa dibuat oleh pengguna yang sudah masuk.';
  END IF;

  v_profile_id := (SELECT public.current_profile_id());
  IF v_profile_id IS NULL THEN RAISE EXCEPTION 'Sesi tidak valid.'; END IF;

  v_role := (SELECT p.role FROM public.profiles p WHERE p.id = v_profile_id);
  v_is_staff := COALESCE(public.has_role(
    ARRAY['owner', 'admin_kasir', 'maintainer', 'manager']::public.user_role[]
  ), false);

  IF v_role IS NULL THEN RAISE EXCEPTION 'Peran akun tidak dikenali.'; END IF;
  IF NOT v_is_staff AND v_role <> 'karyawan'::public.user_role THEN
    RAISE EXCEPTION 'Peran Anda tidak berwenang membuat order POS.';
  END IF;
  IF NULLIF(btrim(p_license_plate), '') IS NULL THEN
    RAISE EXCEPTION 'Plat nomor wajib diisi.';
  END IF;
  IF jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Rincian layanan POS tidak boleh kosong.';
  END IF;
  IF jsonb_array_length(p_items) > 40 THEN
    RAISE EXCEPTION 'Rincian layanan melebihi batas 40 baris.';
  END IF;
  IF lower(COALESCE(p_payment_state, 'paid')) NOT IN ('paid', 'unpaid', 'partial') THEN
    RAISE EXCEPTION 'Status pembayaran harus paid, unpaid, atau partial.';
  END IF;
  IF COALESCE(p_start_work, false) AND array_length(v_team, 1) IS NULL THEN
    RAISE EXCEPTION 'Pilih minimal satu teknisi sebelum memulai pengerjaan.';
  END IF;

  -- Gunakan state sesuai input tanpa force-to-paid
  v_state := lower(COALESCE(p_payment_state, 'paid'))::public.order_payment_state;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_service_id := NULLIF(v_item->>'service_id', '')::uuid;
    IF v_service_id IS NULL THEN
      RAISE EXCEPTION 'Setiap item harus menunjuk layanan di katalog.';
    END IF;

    v_qty := COALESCE((v_item->>'qty')::numeric, 1);
    IF v_qty <= 0 OR v_qty > 999 THEN
      RAISE EXCEPTION 'Jumlah tiap layanan harus di antara 1 dan 999.';
    END IF;

    SELECT s.* INTO v_service FROM public.services s WHERE s.id = v_service_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Layanan pada katalog tidak ditemukan.'; END IF;
    IF NOT COALESCE(v_service.is_active, false) THEN
      RAISE EXCEPTION 'Layanan % sedang tidak aktif.', v_service.name;
    END IF;

    v_price := public.service_price_for_size(v_service, p_vehicle_size);
    IF (v_price IS NULL OR v_price <= 0) AND p_vehicle_size::text LIKE 'Motor %' THEN
      v_price := v_service.price_motor;
    END IF;
    IF v_price IS NULL OR v_price <= 0 THEN
      RAISE EXCEPTION 'Layanan % tidak tersedia untuk ukuran kendaraan ini.', v_service.name;
    END IF;

    -- Cek custom price (promo/nego)
    v_custom_price := NULLIF((v_item->>'custom_price')::numeric, 0);
    v_discount_note := NULLIF(btrim(COALESCE(v_item->>'discount_note', '')), '');

    -- Validasi: custom price tidak boleh negatif, boleh 0 (gratis) untuk promo
    IF v_custom_price IS NOT NULL AND v_custom_price < 0 THEN
      RAISE EXCEPTION 'Harga custom tidak boleh negatif untuk layanan %.', v_service.name;
    END IF;

    -- Harga final: custom_price jika ada, otherwise harga katalog
    v_final_price := COALESCE(v_custom_price, v_price);
    v_total := v_total + round(v_final_price * v_qty, 2);
    v_names := v_names || v_service.name;
  END LOOP;

  IF v_total < 0 THEN RAISE EXCEPTION 'Total transaksi tidak boleh negatif.'; END IF;

  v_service_pkg := array_to_string(v_names, ', ');
  v_category := CASE WHEN v_is_staff THEN 'pos_order' ELSE 'employee_cash_hold' END;
  v_holds_cash := (NOT v_is_staff) AND v_state = 'paid'::public.order_payment_state;

  INSERT INTO public.orders (
    license_plate, vehicle_model, vehicle_size,
    customer_name, customer_phone, service_package,
    total_price, payment_method, status, payment_state,
    paid_amount, paid_by, paid_at,
    cash_hold_profile_id, cash_hold_amount, cash_hold_payment_method
  ) VALUES (
    upper(nullif(btrim(p_license_plate), '')),
    nullif(btrim(p_vehicle_model), ''),
    p_vehicle_size,
    nullif(btrim(p_customer_name), ''),
    nullif(btrim(p_customer_phone), ''),
    v_service_pkg,
    v_total, p_payment_method,
    'queued'::public.order_status,
    v_state,
    CASE WHEN v_state = 'paid'::public.order_payment_state THEN v_total ELSE 0 END,
    CASE WHEN v_state = 'paid'::public.order_payment_state THEN v_profile_id ELSE NULL END,
    CASE WHEN v_state = 'paid'::public.order_payment_state THEN now() ELSE NULL END,
    CASE WHEN v_holds_cash THEN v_profile_id END,
    CASE WHEN v_holds_cash THEN v_total END,
    CASE WHEN v_holds_cash THEN p_payment_method END
  ) RETURNING * INTO v_order;

  -- Insert order items dengan custom price jika ada
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_service_id   := NULLIF(v_item->>'service_id', '')::uuid;
    v_qty          := COALESCE((v_item->>'qty')::numeric, 1);
    v_custom_price := NULLIF((v_item->>'custom_price')::numeric, 0);
    v_discount_note := NULLIF(btrim(COALESCE(v_item->>'discount_note', '')), '');

    SELECT s.* INTO v_service FROM public.services s WHERE s.id = v_service_id;
    v_price := public.service_price_for_size(v_service, p_vehicle_size);
    IF (v_price IS NULL OR v_price <= 0) AND p_vehicle_size::text LIKE 'Motor %' THEN
      v_price := v_service.price_motor;
    END IF;
    v_final_price := COALESCE(v_custom_price, v_price);

    INSERT INTO public.order_items (order_id, service_id, item_name, price, quantity, custom_price, discount_note)
    VALUES (
      v_order.id,
      v_service_id,
      v_service.name,
      v_final_price,
      v_qty,
      v_custom_price,
      v_discount_note
    );
  END LOOP;

  -- Cash flow masuk saat order dibuat HANYA bila pembayarannya lunas (paid)
  IF v_state = 'paid'::public.order_payment_state THEN
    INSERT INTO public.cash_flow (type, amount, category, description, payment_method, order_id)
    VALUES ('in'::public.cash_flow_type, v_total, v_category,
      v_order.order_number || ' - ' || v_service_pkg
        || CASE WHEN v_is_staff THEN '' ELSE ' (kas titipan karyawan)' END,
      p_payment_method, v_order.id);
  END IF;

  IF COALESCE(p_start_work, false) THEN
    PERFORM public.assert_order_team(v_order.branch_id, v_team);
    PERFORM public.assert_staff_available(v_order.id, v_team);
    INSERT INTO public.order_team_members (order_id, profile_id, is_lead)
    SELECT v_order.id, member, member = v_team[1] FROM unnest(v_team) AS member;
    PERFORM pg_catalog.set_config('app.trusted_order_write', 'on', true);
    UPDATE public.orders SET
      status = 'in_progress', assigned_to = v_team[1],
      started_by = v_profile_id, started_at = now()
    WHERE id = v_order.id RETURNING * INTO v_order;
    PERFORM pg_catalog.set_config('app.trusted_order_write', 'off', true);
  ELSIF array_length(v_team, 1) IS NOT NULL THEN
    PERFORM public.assert_order_team(v_order.branch_id, v_team);
    PERFORM public.assert_staff_available(v_order.id, v_team);
    INSERT INTO public.order_team_members (order_id, profile_id, is_lead)
    SELECT v_order.id, member, member = v_team[1] FROM unnest(v_team) AS member;
    PERFORM pg_catalog.set_config('app.trusted_order_write', 'on', true);
    UPDATE public.orders SET assigned_to = v_team[1] WHERE id = v_order.id RETURNING * INTO v_order;
    PERFORM pg_catalog.set_config('app.trusted_order_write', 'off', true);
  END IF;

  INSERT INTO public.activity_logs (actor_id, action, entity, entity_id, metadata)
  VALUES (v_profile_id, 'order.create', 'order', v_order.id,
    jsonb_build_object(
      'order_number', v_order.order_number,
      'branch_id', v_order.branch_id,
      'total_price', v_total,
      'payment_method', p_payment_method::text,
      'payment_state', v_state::text,
      'cash_hold', v_holds_cash,
      'items', p_items,
      'team', to_jsonb(v_team),
      'harga_dari_katalog', true
    )
  );

  RETURN v_order;
END;
$function$;

REVOKE ALL ON FUNCTION public.create_pos_order_with_hold(
  text, text, public.vehicle_size, text, text, text, jsonb,
  public.payment_method, text, boolean, uuid[]
) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.create_pos_order_with_hold(
  text, text, public.vehicle_size, text, text, text, jsonb,
  public.payment_method, text, boolean, uuid[]
) TO authenticated;

COMMENT ON FUNCTION public.create_pos_order_with_hold IS
'0124: Membuat order POS dengan dukungan custom price, DP (unpaid/partial), Bayar Nanti, dan Bayar Sekarang tanpa salah paksa paid.';

-- Update record_order_payment to allow manager as well
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

  IF v_role NOT IN ('owner', 'admin_kasir', 'maintainer', 'manager') THEN
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
  INSERT INTO public.activity_logs (actor_id, action, entity, entity_id, metadata)
  VALUES (
    v_profile_id,
    'payment.record',
    'order',
    p_order_id,
    jsonb_build_object(
      'amount', p_amount,
      'payment_method', p_payment_method,
      'payment_type', p_payment_type,
      'new_payment_state', v_new_state,
      'new_paid_amount', v_order.paid_amount,
      'note', p_note
    )
  );

  RETURN v_order;
END;
$$;

REVOKE ALL ON FUNCTION public.record_order_payment(uuid, numeric, public.payment_method, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_order_payment(uuid, numeric, public.payment_method, text, text) TO authenticated;
