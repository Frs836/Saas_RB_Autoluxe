-- ============================================================
-- 0140_fix_consume_order_materials_final.sql
-- 1. Perbaiki total fungsi consume_order_materials:
--    - Hindari error record "v_order" has no field "vehicle_type"
--    - Hindari error relation "public.order_services" does not exist
--    - Potong stok bahan gudang (inventory_items) & racikan (bundle_items)
--    - Catat ke stock_logs secara rapi dan idempoten
-- 2. Update create_pos_order_with_hold agar saat payment_state = 'unpaid' (Bayar Nanti),
--    kolom payment_method diset ke NULL sehingga data tidak rancu / kotor.
-- ============================================================

-- Pastikan view kompatibilitas order_services ada
CREATE OR REPLACE VIEW public.order_services AS
  SELECT
    id,
    order_id,
    service_id,
    item_name,
    price,
    quantity,
    created_at
  FROM public.order_items;

GRANT SELECT ON public.order_services TO authenticated, anon, service_role;

-- ------------------------------------------------------------
-- 1. Fungsi consume_order_materials Bersih & Idempoten
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.consume_order_materials(p_order_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_order       record;
  v_recipe      record;
  v_qty_col     text;
  v_qty         numeric;
  v_bundle_cost numeric;
  v_balance     numeric;
  v_size_str    text;
BEGIN
  -- Ambil order berdasarkan ID
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id;
  IF NOT FOUND THEN RETURN; END IF;

  -- Normalisasi ukuran kendaraan (fallback ke 'M')
  v_size_str := COALESCE(v_order.vehicle_size::text, 'M');

  -- Tentukan kolom kuantitas resep berdasarkan vehicle_size
  v_qty_col := CASE
    WHEN v_size_str = 'Motor S'  THEN 'qty_motor_s'
    WHEN v_size_str = 'Motor M'  THEN 'qty_motor_m'
    WHEN v_size_str = 'Motor L'  THEN 'qty_motor_l'
    WHEN v_size_str = 'Motor XL' THEN 'qty_motor_xl'
    WHEN v_size_str = 'Motor'    THEN 'qty_motor_s'
    WHEN v_size_str = 'S'        THEN 'qty_s'
    WHEN v_size_str = 'M'        THEN 'qty_m'
    WHEN v_size_str = 'L'        THEN 'qty_l'
    WHEN v_size_str = 'XL'       THEN 'qty_xl'
    ELSE 'qty_m'
  END;

  -- A. Potong bahan gudang reguler (item_id IS NOT NULL)
  FOR v_recipe IN
    SELECT smr.*, ii.unit_cost
    FROM public.service_material_recipes smr
    LEFT JOIN public.inventory_items ii ON ii.id = smr.item_id
    WHERE smr.branch_id = v_order.branch_id
      AND smr.service_id IN (
        SELECT service_id FROM public.order_items
        WHERE order_id = p_order_id AND service_id IS NOT NULL
      )
      AND smr.item_id IS NOT NULL
  LOOP
    v_qty := CASE v_qty_col
      WHEN 'qty_s'        THEN v_recipe.qty_s
      WHEN 'qty_m'        THEN v_recipe.qty_m
      WHEN 'qty_l'        THEN v_recipe.qty_l
      WHEN 'qty_xl'       THEN v_recipe.qty_xl
      WHEN 'qty_motor_s'  THEN v_recipe.qty_motor_s
      WHEN 'qty_motor_m'  THEN v_recipe.qty_motor_m
      WHEN 'qty_motor_l'  THEN v_recipe.qty_motor_l
      WHEN 'qty_motor_xl' THEN v_recipe.qty_motor_xl
      ELSE NULL
    END;

    IF v_qty IS NULL OR v_qty <= 0 THEN CONTINUE; END IF;

    -- Potong stok gudang
    UPDATE public.inventory_items
    SET current_stock = GREATEST(current_stock - v_qty, 0)
    WHERE id = v_recipe.item_id
    RETURNING current_stock INTO v_balance;

    -- Catat riwayat pengeluaran bahan
    INSERT INTO public.stock_logs (
      branch_id, item_id, bundle_id, log_type, quantity, balance_after,
      reference_id, created_by, note, unit_cost, cost_amount
    ) VALUES (
      v_order.branch_id,
      v_recipe.item_id,
      NULL,
      'out'::public.stock_log_type,
      v_qty,
      v_balance,
      p_order_id,
      NULL,
      'Pemakaian otomatis order #' || SUBSTRING(p_order_id::text, 1, 8),
      v_recipe.unit_cost,
      CASE WHEN v_recipe.unit_cost IS NOT NULL THEN v_qty * v_recipe.unit_cost ELSE NULL END
    );
  END LOOP;

  -- B. Potong bahan racikan (bundle_item_id IS NOT NULL) langsung dari bundle_items.current_stock
  FOR v_recipe IN
    SELECT smr.*, bi.bundle_name, bi.unit, bi.output_qty
    FROM public.service_material_recipes smr
    JOIN public.bundle_items bi ON bi.id = smr.bundle_item_id
    WHERE smr.branch_id = v_order.branch_id
      AND smr.service_id IN (
        SELECT service_id FROM public.order_items
        WHERE order_id = p_order_id AND service_id IS NOT NULL
      )
      AND smr.bundle_item_id IS NOT NULL
  LOOP
    v_qty := CASE v_qty_col
      WHEN 'qty_s'        THEN v_recipe.qty_s
      WHEN 'qty_m'        THEN v_recipe.qty_m
      WHEN 'qty_l'        THEN v_recipe.qty_l
      WHEN 'qty_xl'       THEN v_recipe.qty_xl
      WHEN 'qty_motor_s'  THEN v_recipe.qty_motor_s
      WHEN 'qty_motor_m'  THEN v_recipe.qty_motor_m
      WHEN 'qty_motor_l'  THEN v_recipe.qty_motor_l
      WHEN 'qty_motor_xl' THEN v_recipe.qty_motor_xl
      ELSE NULL
    END;

    IF v_qty IS NULL OR v_qty <= 0 THEN CONTINUE; END IF;

    -- Hitung unit cost per satuan racikan dari komponennya
    SELECT COALESCE(SUM(bc.quantity * COALESCE(ii.unit_cost, 0)), 0) / GREATEST(COALESCE(v_recipe.output_qty, 1), 0.01)
    INTO v_bundle_cost
    FROM public.bundle_components bc
    JOIN public.inventory_items ii ON ii.id = bc.item_id
    WHERE bc.bundle_id = v_recipe.bundle_item_id;

    -- Potong stok racikan
    UPDATE public.bundle_items
    SET current_stock = GREATEST(current_stock - v_qty, 0)
    WHERE id = v_recipe.bundle_item_id
    RETURNING current_stock INTO v_balance;

    -- Log pemotongan racikan di tabel stock_logs
    INSERT INTO public.stock_logs (
      branch_id, item_id, bundle_id, log_type, quantity, balance_after,
      reference_id, created_by, note, unit_cost, cost_amount
    ) VALUES (
      v_order.branch_id,
      NULL,
      v_recipe.bundle_item_id,
      'out'::public.stock_log_type,
      v_qty,
      v_balance,
      p_order_id,
      NULL,
      'Pemakaian racikan ' || v_recipe.bundle_name || ' untuk order #' || SUBSTRING(p_order_id::text, 1, 8),
      v_bundle_cost,
      CASE WHEN v_bundle_cost > 0 THEN v_qty * v_bundle_cost ELSE NULL END
    );
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.consume_order_materials TO authenticated;

-- ------------------------------------------------------------
-- 2. Update create_pos_order_with_hold
--    Saat payment_state = 'unpaid', payment_method = NULL
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_pos_order_with_hold(
  p_license_plate   TEXT,
  p_vehicle_model   TEXT,
  p_vehicle_size    public.vehicle_size,
  p_customer_name   TEXT,
  p_customer_phone  TEXT,
  p_service_package TEXT,
  p_items           JSONB,
  p_payment_method  public.payment_method DEFAULT NULL,
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
  v_holds_cash   boolean;
  v_service_pkg  text;
  v_team         uuid[] := COALESCE(p_team_ids, ARRAY[]::uuid[]);
  v_discount_note text;
  v_effective_method public.payment_method;
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

  v_state := lower(COALESCE(p_payment_state, 'paid'))::public.order_payment_state;

  -- Jika unpaid (Bayar Nanti), payment_method wajib NULL
  IF v_state = 'unpaid'::public.order_payment_state THEN
    v_effective_method := NULL;
  ELSE
    v_effective_method := COALESCE(p_payment_method, 'cash'::public.payment_method);
  END IF;

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

    v_custom_price := NULLIF((v_item->>'custom_price')::numeric, 0);
    v_discount_note := NULLIF(btrim(COALESCE(v_item->>'discount_note', '')), '');

    IF v_custom_price IS NOT NULL AND v_custom_price < 0 THEN
      RAISE EXCEPTION 'Harga custom tidak boleh negatif untuk layanan %.', v_service.name;
    END IF;

    v_final_price := COALESCE(v_custom_price, v_price);
    v_total := v_total + round(v_final_price * v_qty, 2);
    v_names := v_names || v_service.name;
  END LOOP;

  IF v_total < 0 THEN RAISE EXCEPTION 'Total transaksi tidak boleh negatif.'; END IF;

  v_service_pkg := array_to_string(v_names, ', ');
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
    v_total,
    v_effective_method,
    'queued'::public.order_status,
    v_state,
    CASE WHEN v_state = 'paid'::public.order_payment_state THEN v_total ELSE 0 END,
    CASE WHEN v_state = 'paid'::public.order_payment_state THEN v_profile_id ELSE NULL END,
    CASE WHEN v_state = 'paid'::public.order_payment_state THEN now() ELSE NULL END,
    CASE WHEN v_holds_cash THEN v_profile_id END,
    CASE WHEN v_holds_cash THEN v_total END,
    CASE WHEN v_holds_cash THEN v_effective_method END
  ) RETURNING * INTO v_order;

  -- Insert order items
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

  -- Catat cash flow jika lunas
  IF v_state = 'paid'::public.order_payment_state THEN
    IF v_is_staff THEN
      INSERT INTO public.cash_flow (
        branch_id, type, category, amount, payment_method,
        reference_id, note, created_by
      ) VALUES (
        v_order.branch_id,
        'in'::public.cash_flow_type,
        'pos_order',
        v_total,
        v_effective_method,
        v_order.id,
        'Pendapatan POS ' || v_order.order_number,
        v_profile_id
      );
    ELSE
      INSERT INTO public.cash_flow (
        branch_id, type, category, amount, payment_method,
        reference_id, note, created_by
      ) VALUES (
        v_order.branch_id,
        'in'::public.cash_flow_type,
        'employee_cash_hold',
        v_total,
        v_effective_method,
        v_order.id,
        'Kas titipan karyawan POS ' || v_order.order_number,
        v_profile_id
      );
    END IF;
  END IF;

  -- Mulai pengerjaan langsung jika diminta
  IF COALESCE(p_start_work, false) THEN
    PERFORM public.assign_order_technicians(v_order.id, v_team);
    PERFORM public.apply_order_status(v_order.id, 'in_progress'::public.order_status);
    SELECT * INTO v_order FROM public.orders WHERE id = v_order.id;
  END IF;

  RETURN v_order;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.create_pos_order_with_hold TO authenticated;
