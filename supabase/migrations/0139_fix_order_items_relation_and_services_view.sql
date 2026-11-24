-- ============================================================
-- 0139_fix_order_items_relation_and_services_view.sql
-- 1. Buat kompatibilitas VIEW public.order_services -> public.order_items
-- 2. Perbaiki fungsi consume_order_materials agar query ke public.order_items
-- 3. Jamin seluruh relasi dan izin akses aman
-- ============================================================

-- ------------------------------------------------------------
-- 1. Buat Compatibility View public.order_services
-- ------------------------------------------------------------
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
  -- Menggunakan tabel resmi public.order_items
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
  -- Menggunakan tabel resmi public.order_items
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
