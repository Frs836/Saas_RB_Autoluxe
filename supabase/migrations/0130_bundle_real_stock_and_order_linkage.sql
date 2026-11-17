-- ============================================================
-- 0130_bundle_real_stock_and_order_linkage.sql
-- 1. RLS policy untuk bundle_items dan bundle_components
-- 2. Stok fisik racikan (output_qty & current_stock)
-- 3. Tautan klaim stok manual ke order (order_id)
-- 4. Dukungan role maintainer, finance, owner, manager
-- ============================================================

-- ------------------------------------------------------------
-- 1. RLS Policy untuk bundle_items & bundle_components
-- ------------------------------------------------------------
ALTER TABLE public.bundle_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bundle_components ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "bundle_items_select" ON public.bundle_items;
CREATE POLICY "bundle_items_select" ON public.bundle_items
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "bundle_components_select" ON public.bundle_components;
CREATE POLICY "bundle_components_select" ON public.bundle_components
  FOR SELECT TO authenticated USING (true);

-- ------------------------------------------------------------
-- 2. Kolom output_qty dan current_stock pada bundle_items
-- ------------------------------------------------------------
ALTER TABLE public.bundle_items
  ADD COLUMN IF NOT EXISTS output_qty numeric NOT NULL DEFAULT 1 CHECK (output_qty > 0),
  ADD COLUMN IF NOT EXISTS current_stock numeric NOT NULL DEFAULT 0 CHECK (current_stock >= 0);

-- ------------------------------------------------------------
-- 3. Kolom order_id pada stock_claims (opsional tautan ke order)
-- ------------------------------------------------------------
ALTER TABLE public.stock_claims
  ADD COLUMN IF NOT EXISTS order_id uuid REFERENCES public.orders(id) ON DELETE SET NULL;

-- ------------------------------------------------------------
-- 4. RPC: set_bundle_definition (dengan output_qty & role lengkap)
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS public.set_bundle_definition(uuid, text, text, text, jsonb);
DROP FUNCTION IF EXISTS public.set_bundle_definition(uuid, text, text, text, jsonb, numeric);
CREATE OR REPLACE FUNCTION public.set_bundle_definition(
  p_branch_id   uuid,
  p_bundle_name text,
  p_unit        text,
  p_description text DEFAULT NULL,
  p_components  jsonb DEFAULT '[]'::jsonb,
  p_output_qty  numeric DEFAULT 1
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_bundle_id uuid;
  v_comp      jsonb;
  v_role      text;
  v_branch_id uuid;
BEGIN
  -- Cek peran: izinkan owner, maintainer, maintener, manager, finance
  SELECT role, branch_id INTO v_role, v_branch_id 
  FROM public.profiles 
  WHERE id = public.current_profile_id();

  IF v_role NOT IN ('owner', 'maintainer', 'maintener', 'manager', 'finance') THEN
    RAISE EXCEPTION 'Hanya owner, manager, maintainer, dan finance yang dapat mengelola racikan.';
  END IF;

  -- Fallback branch_id jika dipanggil kosong / null
  v_branch_id := COALESCE(p_branch_id, v_branch_id);
  IF v_branch_id IS NULL THEN
    SELECT id INTO v_branch_id FROM public.branches WHERE is_active = true LIMIT 1;
  END IF;

  -- Upsert bundle
  INSERT INTO public.bundle_items (branch_id, bundle_name, unit, output_qty, description, is_active)
  VALUES (v_branch_id, p_bundle_name, p_unit, GREATEST(COALESCE(p_output_qty, 1), 0.01), p_description, true)
  ON CONFLICT (bundle_name, branch_id)
  DO UPDATE SET
    unit        = EXCLUDED.unit,
    output_qty  = EXCLUDED.output_qty,
    description = EXCLUDED.description,
    is_active   = true
  RETURNING id INTO v_bundle_id;

  -- Hapus komponen lama lalu insert baru (replace)
  DELETE FROM public.bundle_components WHERE bundle_id = v_bundle_id;

  FOR v_comp IN SELECT * FROM jsonb_array_elements(p_components)
  LOOP
    INSERT INTO public.bundle_components (bundle_id, item_id, quantity)
    VALUES (
      v_bundle_id,
      (v_comp->>'item_id')::uuid,
      (v_comp->>'quantity')::numeric
    );
  END LOOP;

  RETURN v_bundle_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_bundle_definition TO authenticated;

-- ------------------------------------------------------------
-- 5. RPC: delete_bundle (dengan role lengkap)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.delete_bundle(p_bundle_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_role text;
BEGIN
  SELECT role INTO v_role FROM public.profiles WHERE id = public.current_profile_id();
  IF v_role NOT IN ('owner', 'maintainer', 'maintener', 'manager', 'finance') THEN
    RAISE EXCEPTION 'Hanya owner, manager, maintainer, dan finance yang dapat menghapus racikan.';
  END IF;

  UPDATE public.bundle_items SET is_active = false WHERE id = p_bundle_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.delete_bundle TO authenticated;

-- ------------------------------------------------------------
-- 6. RPC: create_bundle_claim (dengan order_id opsional)
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS public.create_bundle_claim(uuid, numeric, text);
DROP FUNCTION IF EXISTS public.create_bundle_claim(uuid, numeric, text, uuid);
CREATE OR REPLACE FUNCTION public.create_bundle_claim(
  p_bundle_id uuid,
  p_quantity  numeric,
  p_note      text DEFAULT NULL,
  p_order_id  uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_profile_id  uuid;
  v_branch_id   uuid;
  v_bundle_unit text;
  v_claim_id    uuid;
  v_user_branch uuid;
  v_role        text;
BEGIN
  v_profile_id := public.current_profile_id();
  IF v_profile_id IS NULL THEN
    RAISE EXCEPTION 'Sesi tidak valid.';
  END IF;

  -- Ambil branch dan unit dari bundle
  SELECT branch_id, unit INTO v_branch_id, v_bundle_unit
  FROM public.bundle_items
  WHERE id = p_bundle_id AND is_active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Racikan tidak ditemukan atau tidak aktif.';
  END IF;

  SELECT branch_id, role INTO v_user_branch, v_role
  FROM public.profiles WHERE id = v_profile_id;

  IF v_role NOT IN ('owner', 'maintainer', 'maintener') AND v_user_branch IS NOT NULL AND v_user_branch != v_branch_id THEN
    RAISE EXCEPTION 'Anda hanya dapat mengajukan klaim untuk cabang Anda sendiri.';
  END IF;

  INSERT INTO public.stock_claims (
    item_id, bundle_id, branch_id, quantity, unit, note, order_id, status, claimed_by
  ) VALUES (
    NULL, p_bundle_id, v_branch_id, p_quantity, v_bundle_unit, p_note, p_order_id, 'pending', v_profile_id
  )
  RETURNING id INTO v_claim_id;

  RETURN v_claim_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_bundle_claim TO authenticated;

-- ------------------------------------------------------------
-- 7. Update RPC: create_stock_claim (mendukung p_order_id opsional)
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS public.create_stock_claim(uuid, numeric, text);
DROP FUNCTION IF EXISTS public.create_stock_claim(uuid, numeric, text, uuid);
CREATE OR REPLACE FUNCTION public.create_stock_claim(
  p_item_id   uuid,
  p_quantity  numeric,
  p_note      text DEFAULT NULL,
  p_order_id  uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_profile_id  uuid;
  v_branch_id   uuid;
  v_unit        text;
  v_claim_id    uuid;
  v_user_branch uuid;
  v_role        text;
BEGIN
  v_profile_id := public.current_profile_id();
  IF v_profile_id IS NULL THEN
    RAISE EXCEPTION 'Sesi tidak valid.';
  END IF;

  SELECT branch_id, unit INTO v_branch_id, v_unit
  FROM public.inventory_items
  WHERE id = p_item_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Bahan tidak ditemukan.';
  END IF;

  SELECT branch_id, role INTO v_user_branch, v_role
  FROM public.profiles WHERE id = v_profile_id;

  IF v_role NOT IN ('owner', 'maintainer', 'maintener') AND v_user_branch IS NOT NULL AND v_user_branch != v_branch_id THEN
    RAISE EXCEPTION 'Anda hanya dapat mengajukan klaim untuk cabang Anda sendiri.';
  END IF;

  INSERT INTO public.stock_claims (
    item_id, bundle_id, branch_id, quantity, unit, note, order_id, status, claimed_by
  ) VALUES (
    p_item_id, NULL, v_branch_id, p_quantity, v_unit, p_note, p_order_id, 'pending', v_profile_id
  )
  RETURNING id INTO v_claim_id;

  RETURN v_claim_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_stock_claim TO authenticated;

-- ------------------------------------------------------------
-- 8. RPC: confirm_bundle_claim
--    Potong stok bahan baku DAN Tambah current_stock racikan!
-- ------------------------------------------------------------
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
    WHERE id = v_comp.item_id;

    -- Hitung total cost
    IF v_comp.unit_cost IS NOT NULL THEN
      v_total_cost := v_total_cost + (v_needed * v_comp.unit_cost);
    END IF;

    -- Log bahan keluar untuk produksi racikan
    INSERT INTO public.stock_logs (item_id, change_type, quantity, note, created_by, unit_cost, cost_amount)
    VALUES (
      v_comp.item_id,
      'claim_bundle',
      -v_needed,
      'Pembuatan racikan: ' || v_bundle.bundle_name || ' (' || v_claim.quantity || ' batch)',
      v_profile_id,
      v_comp.unit_cost,
      CASE WHEN v_comp.unit_cost IS NOT NULL THEN v_needed * v_comp.unit_cost ELSE NULL END
    );
  END LOOP;

  -- TAMBAHKAN STOK RACIKAN JADI (output_qty * quantity)
  v_added_stock := COALESCE(v_bundle.output_qty, 1) * v_claim.quantity;
  UPDATE public.bundle_items
  SET current_stock = current_stock + v_added_stock
  WHERE id = v_claim.bundle_id;

  -- Update status klaim menjadi disetujui (confirmed)
  UPDATE public.stock_claims
  SET status = 'confirmed', confirmed_by = v_profile_id, confirmed_at = now()
  WHERE id = p_claim_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.confirm_bundle_claim TO authenticated;

-- ------------------------------------------------------------
-- 9. RPC: set_service_bundle_recipe (dukungan role lengkap)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_service_bundle_recipe(
  p_branch_id     uuid,
  p_service_id    uuid,
  p_bundle_item_id uuid,
  p_remove        boolean DEFAULT false,
  p_qty_s         numeric DEFAULT NULL,
  p_qty_m         numeric DEFAULT NULL,
  p_qty_l         numeric DEFAULT NULL,
  p_qty_xl        numeric DEFAULT NULL,
  p_qty_motor_s   numeric DEFAULT NULL,
  p_qty_motor_m   numeric DEFAULT NULL,
  p_qty_motor_l   numeric DEFAULT NULL,
  p_qty_motor_xl  numeric DEFAULT NULL
)
RETURNS setof public.service_material_recipes
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_role text;
BEGIN
  SELECT role INTO v_role FROM public.profiles WHERE id = public.current_profile_id();
  IF v_role NOT IN ('owner', 'maintainer', 'maintener', 'manager', 'finance') THEN
    RAISE EXCEPTION 'Hanya owner, manager, maintainer, dan finance yang dapat mengatur resep racikan.';
  END IF;

  IF p_remove THEN
    DELETE FROM public.service_material_recipes
    WHERE branch_id = p_branch_id
      AND service_id = p_service_id
      AND bundle_item_id = p_bundle_item_id;
    RETURN;
  END IF;

  RETURN QUERY
  INSERT INTO public.service_material_recipes (
    branch_id, service_id, item_id, bundle_item_id,
    qty_s, qty_m, qty_l, qty_xl,
    qty_motor_s, qty_motor_m, qty_motor_l, qty_motor_xl
  ) VALUES (
    p_branch_id, p_service_id, NULL, p_bundle_item_id,
    p_qty_s, p_qty_m, p_qty_l, p_qty_xl,
    p_qty_motor_s, p_qty_motor_m, p_qty_motor_l, p_qty_motor_xl
  )
  ON CONFLICT (branch_id, service_id, bundle_item_id)
  DO UPDATE SET
    qty_s        = EXCLUDED.qty_s,
    qty_m        = EXCLUDED.qty_m,
    qty_l        = EXCLUDED.qty_l,
    qty_xl       = EXCLUDED.qty_xl,
    qty_motor_s  = EXCLUDED.qty_motor_s,
    qty_motor_m  = EXCLUDED.qty_motor_m,
    qty_motor_l  = EXCLUDED.qty_motor_l,
    qty_motor_xl = EXCLUDED.qty_motor_xl;
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_service_bundle_recipe TO authenticated;

-- ------------------------------------------------------------
-- 10. RPC: consume_order_materials
--     Memotong langsung dari bundle_items.current_stock!
-- ------------------------------------------------------------
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
    WHERE id = v_recipe.item_id;

    INSERT INTO public.stock_logs (item_id, change_type, quantity, note, created_by, unit_cost, cost_amount)
    VALUES (
      v_recipe.item_id,
      'order_consume',
      -v_qty,
      'Pemakaian otomatis order #' || SUBSTRING(p_order_id::text, 1, 8),
      NULL,
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
    WHERE id = v_recipe.bundle_item_id;

    -- Log pemotongan racikan
    INSERT INTO public.stock_logs (item_id, change_type, quantity, note, created_by, unit_cost, cost_amount)
    VALUES (
      NULL,
      'order_consume_bundle',
      -v_qty,
      'Pemakaian racikan ' || v_recipe.bundle_name || ' untuk order #' || SUBSTRING(p_order_id::text, 1, 8),
      NULL,
      v_bundle_cost,
      CASE WHEN v_bundle_cost > 0 THEN v_qty * v_bundle_cost ELSE NULL END
    );
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.consume_order_materials TO authenticated;
