-- ============================================================
-- 0147_auto_trigger_consume_materials_and_fix_hpp.sql
-- 1. Tambahkan pengecekan idempoten di consume_order_materials agar aman dipanggil berulang.
-- 2. Buat database trigger otomatis trg_order_consume_materials pada public.orders
--    agar setiap order yang masuk ke status in_progress, completed, menunggu_diambil, atau diserahkan
--    selalu otomatis memotong bahan resep dan mencatat HPP ke stock_logs tanpa tergantung alur manual.
-- 3. Jalankan consume_order_materials untuk order yang ada saat ini agar HPP langsung muncul.
-- ============================================================

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

  -- Pengecekan idempoten: jika bahan order ini sudah pernah dicatat di stock_logs, keluar agar tidak dobel
  IF EXISTS (
    SELECT 1 FROM public.stock_logs 
    WHERE reference_id = p_order_id AND log_type = 'out'::public.stock_log_type
  ) THEN
    RETURN;
  END IF;

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

-- Database Trigger Otomatis
CREATE OR REPLACE FUNCTION public.trg_auto_consume_order_materials()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
BEGIN
  IF NEW.status IN ('in_progress', 'completed', 'menunggu_diambil', 'diserahkan') THEN
    PERFORM public.consume_order_materials(NEW.id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_order_consume_materials ON public.orders;
CREATE TRIGGER trg_order_consume_materials
AFTER INSERT OR UPDATE OF status ON public.orders
FOR EACH ROW
EXECUTE FUNCTION public.trg_auto_consume_order_materials();

-- Jalankan untuk order yang sudah ada saat ini
DO $$
DECLARE
  v_ord record;
BEGIN
  FOR v_ord IN 
    SELECT id FROM public.orders 
    WHERE status IN ('in_progress', 'completed', 'menunggu_diambil', 'diserahkan')
  LOOP
    PERFORM public.consume_order_materials(v_ord.id);
  END LOOP;
END $$;
