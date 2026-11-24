-- ============================================================
-- 0138_fix_vehicle_type_and_consume_materials.sql
-- 1. Tambah kolom vehicle_type ke orders (default 'mobil')
-- 2. Perbaiki fungsi consume_order_materials agar membaca vehicle_size dengan benar
-- 3. Batasi generate_maintenance_schedules hanya untuk coating / polish / detailing
-- 4. Bersihkan jadwal perawatan yang tidak sengaja terbuat untuk cuci biasa (wash)
-- ============================================================

-- ------------------------------------------------------------
-- 1. Tambah kolom vehicle_type ke tabel orders jika belum ada
-- ------------------------------------------------------------
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS vehicle_type text DEFAULT 'mobil';

-- Sinkronisasi nilai vehicle_type berdasarkan vehicle_size
UPDATE public.orders
SET vehicle_type = CASE
  WHEN vehicle_size::text ILIKE 'motor%' THEN 'motor'
  ELSE 'mobil'
END
WHERE vehicle_type IS NULL OR vehicle_type = '';

-- ------------------------------------------------------------
-- 2. Perbaiki RPC consume_order_materials
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
  -- Ambil order
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id;
  IF NOT FOUND THEN RETURN; END IF;

  v_size_str := COALESCE(v_order.vehicle_size::text, 'M');

  -- Tentukan kolom kuantitas resep berdasarkan vehicle_size
  -- Enum vehicle_size: 'S', 'M', 'L', 'XL', 'Motor', 'Motor S', 'Motor M', 'Motor L', 'Motor XL'
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
        SELECT service_id FROM public.order_services WHERE order_id = p_order_id
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

    UPDATE public.inventory_items
    SET current_stock = GREATEST(current_stock - v_qty, 0)
    WHERE id = v_recipe.item_id
    RETURNING current_stock INTO v_balance;

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
        SELECT service_id FROM public.order_services WHERE order_id = p_order_id
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
-- 3. Batasi generate_maintenance_schedules: SKIP untuk wash biasa
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.generate_maintenance_schedules(p_order_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_order     public.orders%rowtype;
  v_warranty  public.warranties%rowtype;
  v_base_date date;
  v_pkg_lower text;
BEGIN
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id;
  IF NOT FOUND THEN RETURN; END IF;

  SELECT * INTO v_warranty FROM public.warranties WHERE order_id = p_order_id LIMIT 1;

  v_pkg_lower := lower(COALESCE(v_order.service_package, ''));

  -- Filter ketat: HANYA untuk layanan yang ada coating, polish, detailing, atau bergaransi resmi
  IF NOT (
    strpos(v_pkg_lower, 'coating') > 0
    OR strpos(v_pkg_lower, 'ceramic') > 0
    OR strpos(v_pkg_lower, 'liquid glass') > 0
    OR strpos(v_pkg_lower, 'nano') > 0
    OR strpos(v_pkg_lower, 'polish') > 0
    OR strpos(v_pkg_lower, 'poles') > 0
    OR strpos(v_pkg_lower, 'detailing') > 0
    OR v_warranty.id IS NOT NULL
  ) THEN
    -- Layanan cuci biasa (Wash) TIDAK memiliki jadwal perawatan ataupun kartu garansi
    RETURN;
  END IF;

  v_base_date := COALESCE(v_order.completed_at::date, CURRENT_DATE);

  -- 1. Jadwal Perawatan 6 Bulan
  INSERT INTO public.maintenance_schedules (
    order_id, branch_id, warranty_id,
    customer_name, customer_phone, license_plate, vehicle_model, service_package,
    schedule_type, due_date, status, notes
  ) VALUES (
    v_order.id, v_order.branch_id, v_warranty.id,
    COALESCE(v_order.customer_name, 'Pelanggan'),
    v_order.customer_phone,
    v_order.license_plate,
    v_order.vehicle_model,
    v_order.service_package,
    '6_month',
    (v_base_date + INTERVAL '6 months')::date,
    'pending',
    'Perawatan berkala layer coating, pembersihan jamur & kerak air (Bulan ke-6).'
  )
  ON CONFLICT (order_id, schedule_type)
  DO UPDATE SET
    due_date = EXCLUDED.due_date,
    warranty_id = EXCLUDED.warranty_id,
    customer_name = EXCLUDED.customer_name,
    customer_phone = EXCLUDED.customer_phone,
    license_plate = EXCLUDED.license_plate,
    vehicle_model = EXCLUDED.vehicle_model,
    service_package = EXCLUDED.service_package;

  -- 2. Jadwal Perawatan 12 Bulan (1 Tahun)
  INSERT INTO public.maintenance_schedules (
    order_id, branch_id, warranty_id,
    customer_name, customer_phone, license_plate, vehicle_model, service_package,
    schedule_type, due_date, status, notes
  ) VALUES (
    v_order.id, v_order.branch_id, v_warranty.id,
    COALESCE(v_order.customer_name, 'Pelanggan'),
    v_order.customer_phone,
    v_order.license_plate,
    v_order.vehicle_model,
    v_order.service_package,
    '12_month',
    (v_base_date + INTERVAL '12 months')::date,
    'pending',
    'Inspeksi tahunan, evaluasi garansi & touch-up proteksi cat (Bulan ke-12).'
  )
  ON CONFLICT (order_id, schedule_type)
  DO UPDATE SET
    due_date = EXCLUDED.due_date,
    warranty_id = EXCLUDED.warranty_id,
    customer_name = EXCLUDED.customer_name,
    customer_phone = EXCLUDED.customer_phone,
    license_plate = EXCLUDED.license_plate,
    vehicle_model = EXCLUDED.vehicle_model,
    service_package = EXCLUDED.service_package;
END;
$$;

-- ------------------------------------------------------------
-- 4. Bersihkan jadwal maintenance yang sempat terbuat untuk cuci biasa (wash)
-- ------------------------------------------------------------
DELETE FROM public.maintenance_schedules
WHERE lower(service_package) NOT LIKE '%coating%'
  AND lower(service_package) NOT LIKE '%polish%'
  AND lower(service_package) NOT LIKE '%poles%'
  AND lower(service_package) NOT LIKE '%detailing%'
  AND warranty_id IS NULL;
