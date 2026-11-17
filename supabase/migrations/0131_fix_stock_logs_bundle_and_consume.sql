-- ============================================================
-- 0131_fix_stock_logs_bundle_and_consume.sql
-- Memperbaiki error: column "change_type" of relation "stock_logs" does not exist
-- Menyesuaikan skema stock_logs agar mendukung pencatatan racikan
-- ============================================================

-- 1. Bolehkan item_id NULL di stock_logs dan tambah bundle_id
ALTER TABLE public.stock_logs
  ALTER COLUMN item_id DROP NOT NULL;

ALTER TABLE public.stock_logs
  ADD COLUMN IF NOT EXISTS bundle_id uuid REFERENCES public.bundle_items(id) ON DELETE SET NULL;

-- 2. Perbaiki RPC: confirm_bundle_claim
CREATE OR REPLACE FUNCTION public.confirm_bundle_claim(p_claim_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_role        text;
  v_profile_id  uuid;
  v_claim       record;
  v_bundle      record;
  v_comp        record;
  v_needed      numeric;
  v_current     numeric;
  v_added_stock numeric;
  v_total_cost  numeric := 0;
  v_balance     numeric;
BEGIN
  v_profile_id := public.current_profile_id();
  SELECT role INTO v_role FROM public.profiles WHERE id = v_profile_id;
  IF v_role NOT IN ('owner', 'maintainer', 'maintener', 'manager', 'finance', 'kepala_mekanik', 'kepala_karyawan') THEN
    RAISE EXCEPTION 'Hanya manager, finance, maintainer, owner, atau kepala mekanik yang dapat mengonfirmasi klaim racikan.';
  END IF;

  -- Ambil klaim
  SELECT * INTO v_claim
  FROM public.stock_claims
  WHERE id = p_claim_id AND bundle_id IS NOT NULL AND status = 'pending';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Klaim racikan tidak ditemukan atau sudah diproses.';
  END IF;

  -- Ambil data bundle
  SELECT * INTO v_bundle
  FROM public.bundle_items
  WHERE id = v_claim.bundle_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Data master racikan tidak ditemukan.';
  END IF;

  -- Loop komponen: validasi kecukupan stok bahan baku & potong
  FOR v_comp IN
    SELECT bc.item_id, bc.quantity, ii.current_stock, ii.item_name, ii.unit, ii.unit_cost
    FROM public.bundle_components bc
    JOIN public.inventory_items ii ON ii.id = bc.item_id
    WHERE bc.bundle_id = v_claim.bundle_id
  LOOP
    v_needed := v_comp.quantity * v_claim.quantity;
    v_current := COALESCE(v_comp.current_stock, 0);

    IF v_current < v_needed THEN
      RAISE EXCEPTION 'Stok bahan baku % tidak cukup. Tersedia: % %, dibutuhkan: % %.',
        v_comp.item_name,
        v_current, v_comp.unit,
        v_needed, v_comp.unit;
    END IF;

    -- Kurangi stok bahan baku
    UPDATE public.inventory_items
    SET current_stock = current_stock - v_needed
    WHERE id = v_comp.item_id
    RETURNING current_stock INTO v_balance;

    -- Hitung total cost
    IF v_comp.unit_cost IS NOT NULL THEN
      v_total_cost := v_total_cost + (v_needed * v_comp.unit_cost);
    END IF;

    -- Log bahan baku keluar di tabel stock_logs
    INSERT INTO public.stock_logs (
      branch_id, item_id, bundle_id, log_type, quantity, balance_after,
      reference_id, created_by, note, unit_cost, cost_amount
    ) VALUES (
      v_claim.branch_id,
      v_comp.item_id,
      NULL,
      'out'::public.stock_log_type,
      v_needed,
      v_balance,
      v_claim.id,
      v_profile_id,
      'Bahan baku untuk racikan: ' || v_bundle.bundle_name || ' (' || v_claim.quantity || ' batch)',
      v_comp.unit_cost,
      CASE WHEN v_comp.unit_cost IS NOT NULL THEN v_needed * v_comp.unit_cost ELSE NULL END
    );
  END LOOP;

  -- TAMBAHKAN STOK RACIKAN JADI (output_qty * quantity)
  v_added_stock := COALESCE(v_bundle.output_qty, 1) * v_claim.quantity;
  UPDATE public.bundle_items
  SET current_stock = current_stock + v_added_stock
  WHERE id = v_claim.bundle_id
  RETURNING current_stock INTO v_balance;

  -- Log penambahan stok fisik racikan
  INSERT INTO public.stock_logs (
    branch_id, item_id, bundle_id, log_type, quantity, balance_after,
    reference_id, created_by, note, unit_cost, cost_amount
  ) VALUES (
    v_claim.branch_id,
    NULL,
    v_claim.bundle_id,
    'in'::public.stock_log_type,
    v_added_stock,
    v_balance,
    v_claim.id,
    v_profile_id,
    'Produksi racikan jadi: +' || v_added_stock || ' ' || v_bundle.unit || ' (' || v_claim.quantity || ' batch)',
    CASE WHEN v_added_stock > 0 AND v_total_cost > 0 THEN v_total_cost / v_added_stock ELSE NULL END,
    v_total_cost
  );

  -- Update status klaim menjadi disetujui (confirmed)
  UPDATE public.stock_claims
  SET status = 'confirmed', confirmed_by = v_profile_id, confirmed_at = now()
  WHERE id = p_claim_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.confirm_bundle_claim TO authenticated;

-- 3. Perbaiki RPC: consume_order_materials
DROP FUNCTION IF EXISTS public.consume_order_materials(uuid);
CREATE OR REPLACE FUNCTION public.consume_order_materials(p_order_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_order       record;
  v_recipe      record;
  v_qty_col     text;
  v_qty         numeric;
  v_bundle_cost numeric;
  v_balance     numeric;
BEGIN
  -- Ambil order
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id;
  IF NOT FOUND THEN RETURN; END IF;

  -- Tentukan kolom kuantitas berdasarkan ukuran & tipe kendaraan
  v_qty_col := CASE
    WHEN v_order.vehicle_type = 'motor' THEN
      CASE v_order.vehicle_size
        WHEN 'S' THEN 'qty_motor_s'
        WHEN 'M' THEN 'qty_motor_m'
        WHEN 'L' THEN 'qty_motor_l'
        WHEN 'XL' THEN 'qty_motor_xl'
        ELSE 'qty_motor_s'
      END
    ELSE
      CASE v_order.vehicle_size
        WHEN 'S' THEN 'qty_s'
        WHEN 'M' THEN 'qty_m'
        WHEN 'L' THEN 'qty_l'
        WHEN 'XL' THEN 'qty_xl'
        ELSE 'qty_m'
      END
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

  -- B. Potong bahan racikan (bundle_item_id IS NOT NULL) langsung dari bundle_items.current_stock!
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
