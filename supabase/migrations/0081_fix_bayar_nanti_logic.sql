-- 0081: Fix Bayar Nanti logic
-- 1. Allow admin_kasir to create orders with payment_state = 'unpaid' (Bayar Nanti)
-- 2. cash_hold_amount only for karyawan + paid (Bayar Sekarang), NULL for Bayar Nanti

-- Fix create_pos_order_with_hold: remove force paid for admin_kasir
-- Only karyawan with unpaid + NOT start_work gets forced to paid

DROP FUNCTION IF EXISTS public.create_pos_order_with_hold(
  TEXT, TEXT, public.vehicle_size, TEXT, TEXT, TEXT, JSONB,
  public.payment_method, TEXT, BOOLEAN, uuid[]
) CASCADE;

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
  v_profile_id  uuid;
  v_role        public.user_role;
  v_is_staff    boolean;
  v_order       public.orders%rowtype;
  v_total       numeric(12,2) := 0;
  v_qty         numeric(12,2);
  v_price       numeric(12,2);
  v_service     public.services%rowtype;
  v_service_id  uuid;
  v_names       text[] := ARRAY[]::text[];
  v_item        jsonb;
  v_state       public.order_payment_state;
  v_category    text;
  v_holds_cash  boolean;
  v_service_pkg text;
  v_team        uuid[] := COALESCE(p_team_ids, ARRAY[]::uuid[]);
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN
    RAISE EXCEPTION 'Order hanya bisa dibuat oleh pengguna yang sudah masuk.';
  END IF;

  v_profile_id := (SELECT public.current_profile_id());
  IF v_profile_id IS NULL THEN
    RAISE EXCEPTION 'Sesi tidak valid.';
  END IF;

  v_role := (SELECT p.role FROM public.profiles p WHERE p.id = v_profile_id);
  v_is_staff := COALESCE(public.has_role(
    ARRAY['owner', 'admin_kasir', 'maintainer']::public.user_role[]
  ), false);

  IF v_role IS NULL THEN
    RAISE EXCEPTION 'Peran akun tidak dikenali.';
  END IF;

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

  IF lower(COALESCE(p_payment_state, 'paid')) NOT IN ('paid', 'unpaid') THEN
    RAISE EXCEPTION 'Status pembayaran harus paid atau unpaid.';
  END IF;

  IF COALESCE(p_start_work, false) AND array_length(v_team, 1) IS NULL THEN
    RAISE EXCEPTION 'Pilih minimal satu teknisi sebelum memulai pengerjaan.';
  END IF;

  v_state := lower(COALESCE(p_payment_state, 'paid'))::public.order_payment_state;

  -- Bayar Nanti (unpaid) diperbolehkan untuk karyawan & admin_kasir
  -- Tidak ada force-to-paid logic

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_service_id := NULLIF(v_item->>'service_id', '')::uuid;
    IF v_service_id IS NULL THEN
      RAISE EXCEPTION
        'Setiap item harus menunjuk layanan di katalog. Harga tidak lagi diterima dari perangkat kasir.';
    END IF;

    v_qty := COALESCE((v_item->>'qty')::numeric, 1);
    IF v_qty <= 0 OR v_qty > 999 THEN
      RAISE EXCEPTION 'Jumlah tiap layanan harus di antara 1 dan 999.';
    END IF;

    SELECT s.* INTO v_service
      FROM public.services s
     WHERE s.id = v_service_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Layanan pada katalog tidak ditemukan.';
    END IF;

    IF NOT COALESCE(v_service.is_active, false) THEN
      RAISE EXCEPTION 'Layanan % sedang tidak aktif dan tidak bisa dijual.', v_service.name;
    END IF;

    v_price := public.service_price_for_size(v_service, p_vehicle_size);
    IF v_price IS NULL OR v_price <= 0 THEN
      IF p_vehicle_size::text LIKE 'Motor %' THEN
        v_price := v_service.price_motor;
      END IF;
    END IF;

    IF v_price IS NULL OR v_price <= 0 THEN
      RAISE EXCEPTION
        'Layanan % tidak tersedia untuk ukuran kendaraan ini.',
        v_service.name;
    END IF;

    v_total := v_total + round(v_price * v_qty, 2);
    v_names := v_names || v_service.name;
  END LOOP;

  IF v_total <= 0 THEN
    RAISE EXCEPTION 'Total transaksi harus lebih dari nol.';
  END IF;

  v_service_pkg := array_to_string(v_names, ', ');

  v_category := CASE WHEN v_is_staff THEN 'pos_order' ELSE 'employee_cash_hold' END;

  -- cash_hold hanya untuk karyawan + paid (Bayar Sekarang)
  v_holds_cash := (NOT v_is_staff) AND v_state = 'paid'::public.order_payment_state;

  INSERT INTO public.orders (
    license_plate, vehicle_model, vehicle_size,
    customer_name, customer_phone, service_package,
    total_price, payment_method, status, payment_state,
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
    CASE WHEN v_holds_cash THEN v_profile_id END,
    CASE WHEN v_holds_cash THEN v_total END,
    CASE WHEN v_holds_cash THEN p_payment_method END
  ) RETURNING * INTO v_order;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_service_id := NULLIF(v_item->>'service_id', '')::uuid;
    v_qty := COALESCE((v_item->>'qty')::numeric, 1);

    SELECT s.* INTO v_service
      FROM public.services s
     WHERE s.id = v_service_id;

    v_price := public.service_price_for_size(v_service, p_vehicle_size);
    IF v_price IS NULL OR v_price <= 0 THEN
      IF p_vehicle_size::text LIKE 'Motor %' THEN
        v_price := v_service.price_motor;
      END IF;
    END IF;

    INSERT INTO public.order_items (order_id, service_id, item_name, price, quantity)
    VALUES (
      v_order.id,
      v_service_id,
      v_service.name,
      v_price,
      v_qty
    );
  END LOOP;

  -- Bahan dipotong di sini, bukan menunggu completed
  PERFORM public.consume_order_materials(v_order.id);

  IF v_state = 'paid'::public.order_payment_state THEN
    INSERT INTO public.cash_flow (
      type, amount, category, description, payment_method, order_id
    )
    VALUES (
      'in'::public.cash_flow_type,
      v_total,
      v_category,
      v_order.order_number || ' - ' || v_service_pkg
        || CASE WHEN v_is_staff THEN ''
                ELSE ' (kas titipan karyawan)' END,
      p_payment_method,
      v_order.id
    );
  END IF;

  IF COALESCE(p_start_work, false) THEN
    PERFORM public.assert_order_team(v_order.branch_id, v_team);
    PERFORM public.assert_staff_available(v_order.id, v_team);

    INSERT INTO public.order_team_members (order_id, profile_id, is_lead)
    SELECT v_order.id, member, member = v_team[1]
      FROM unnest(v_team) AS member;

    PERFORM pg_catalog.set_config('app.trusted_order_write', 'on', true);
    UPDATE public.orders
       SET status     = 'in_progress'::public.order_status,
           assigned_to = v_team[1],
           started_by = v_profile_id,
           started_at = now()
     WHERE id = v_order.id
    RETURNING * INTO v_order;
    PERFORM pg_catalog.set_config('app.trusted_order_write', 'off', true);
  ELSIF array_length(v_team, 1) IS NOT NULL THEN
    PERFORM public.assert_order_team(v_order.branch_id, v_team);
    PERFORM public.assert_staff_available(v_order.id, v_team);

    INSERT INTO public.order_team_members (order_id, profile_id, is_lead)
    SELECT v_order.id, member, member = v_team[1]
      FROM unnest(v_team) AS member;

    PERFORM pg_catalog.set_config('app.trusted_order_write', 'on', true);
    UPDATE public.orders
       SET assigned_to = v_team[1]
     WHERE id = v_order.id
    RETURNING * INTO v_order;
    PERFORM pg_catalog.set_config('app.trusted_order_write', 'off', true);
  END IF;

  INSERT INTO public.activity_logs (actor_id, action, entity, entity_id, metadata)
  VALUES (
    v_profile_id,
    'order.create',
    'order',
    v_order.id,
    jsonb_build_object(
      'order_number', v_order.order_number,
      'branch_id', v_order.branch_id,
      'payment_state', v_state
    )
  );

  RETURN v_order;
END;
$function$;

REVOKE ALL ON FUNCTION public.create_pos_order_with_hold(
  TEXT, TEXT, public.vehicle_size, TEXT, TEXT, TEXT, JSONB,
  public.payment_method, TEXT, BOOLEAN, uuid[]
) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.create_pos_order_with_hold(
  TEXT, TEXT, public.vehicle_size, TEXT, TEXT, TEXT, JSONB,
  public.payment_method, TEXT, BOOLEAN, uuid[]
) TO authenticated;

COMMENT ON FUNCTION public.create_pos_order_with_hold(
  TEXT, TEXT, public.vehicle_size, TEXT, TEXT, TEXT, JSONB,
  public.payment_method, TEXT, BOOLEAN, uuid[]
) IS 'Membuat order POS dengan support Bayar Nanti (unpaid) untuk karyawan & admin_kasir. cash_hold hanya untuk karyawan Bayar Sekarang.';