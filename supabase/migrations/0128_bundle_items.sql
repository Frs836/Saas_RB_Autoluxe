-- ============================================================
-- 0128_bundle_items.sql
-- Fitur Stok Bundling (Racikan)
-- ============================================================

-- ----------------------------------------------------------------
-- 1. Tabel bundle_items — definisi racikan (virtual bundle)
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.bundle_items (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id       uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  bundle_name     text NOT NULL,
  unit            text NOT NULL DEFAULT 'pack',  -- satuan output: pack, botol, sachet
  description     text,
  is_active       boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (bundle_name, branch_id)
);

-- ----------------------------------------------------------------
-- 2. Tabel bundle_components — komposisi bahan per 1 unit bundle
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.bundle_components (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bundle_id   uuid NOT NULL REFERENCES public.bundle_items(id) ON DELETE CASCADE,
  item_id     uuid NOT NULL REFERENCES public.inventory_items(id) ON DELETE CASCADE,
  quantity    numeric NOT NULL CHECK (quantity > 0),
  UNIQUE (bundle_id, item_id)
);

-- ----------------------------------------------------------------
-- 3. Kolom bundle_id di stock_claims (nullable, one-of item_id|bundle_id)
-- ----------------------------------------------------------------
ALTER TABLE public.stock_claims
  ADD COLUMN IF NOT EXISTS bundle_id uuid REFERENCES public.bundle_items(id) ON DELETE SET NULL;

-- constraint: harus salah satu terisi
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'stock_claims_item_or_bundle'
  ) THEN
    ALTER TABLE public.stock_claims
      ADD CONSTRAINT stock_claims_item_or_bundle
      CHECK (
        (item_id IS NOT NULL AND bundle_id IS NULL) OR
        (item_id IS NULL AND bundle_id IS NOT NULL)
      );
  END IF;
END $$;

-- item_id sekarang boleh NULL (untuk klaim bundle)
ALTER TABLE public.stock_claims ALTER COLUMN item_id DROP NOT NULL;

-- ----------------------------------------------------------------
-- 4. Kolom bundle_item_id di service_material_recipes (opsional)
-- ----------------------------------------------------------------
ALTER TABLE public.service_material_recipes
  ADD COLUMN IF NOT EXISTS bundle_item_id uuid REFERENCES public.bundle_items(id) ON DELETE CASCADE;

-- constraint: harus salah satu terisi
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'smr_item_or_bundle'
  ) THEN
    ALTER TABLE public.service_material_recipes
      ADD CONSTRAINT smr_item_or_bundle
      CHECK (
        (item_id IS NOT NULL AND bundle_item_id IS NULL) OR
        (item_id IS NULL AND bundle_item_id IS NOT NULL)
      );
  END IF;
END $$;

-- item_id boleh NULL (untuk resep berbasis bundle)
ALTER TABLE public.service_material_recipes ALTER COLUMN item_id DROP NOT NULL;

-- ----------------------------------------------------------------
-- 5. RPC: set_bundle_definition — buat / update definisi bundle
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_bundle_definition(
  p_branch_id   uuid,
  p_bundle_name text,
  p_unit        text,
  p_description text DEFAULT NULL,
  p_components  jsonb DEFAULT '[]'::jsonb
  -- format: [{"item_id": "uuid", "quantity": 100}, ...]
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_bundle_id uuid;
  v_comp      jsonb;
  v_role      text;
BEGIN
  -- Cek peran
  SELECT role INTO v_role FROM public.profiles WHERE id = public.current_profile_id();
  IF v_role NOT IN ('maintener','owner','manager') THEN
    RAISE EXCEPTION 'Hanya owner/manager yang dapat mengelola racikan.';
  END IF;

  -- Upsert bundle
  INSERT INTO public.bundle_items (branch_id, bundle_name, unit, description, is_active)
  VALUES (p_branch_id, p_bundle_name, p_unit, p_description, true)
  ON CONFLICT (bundle_name, branch_id)
  DO UPDATE SET
    unit        = EXCLUDED.unit,
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

-- ----------------------------------------------------------------
-- 6. RPC: delete_bundle — nonaktifkan bundle
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.delete_bundle(p_bundle_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_role text;
BEGIN
  SELECT role INTO v_role FROM public.profiles WHERE id = public.current_profile_id();
  IF v_role NOT IN ('maintener','owner','manager') THEN
    RAISE EXCEPTION 'Hanya owner/manager yang dapat menghapus racikan.';
  END IF;

  UPDATE public.bundle_items SET is_active = false WHERE id = p_bundle_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.delete_bundle TO authenticated;

-- ----------------------------------------------------------------
-- 7. RPC: create_bundle_claim — ajukan klaim bundle
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_bundle_claim(
  p_bundle_id uuid,
  p_quantity  numeric,
  p_note      text DEFAULT NULL
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
    RAISE EXCEPTION 'Bundle tidak ditemukan atau tidak aktif.';
  END IF;

  -- Pastikan klaim hanya untuk cabang user sendiri (kecuali maintener/owner)
  SELECT branch_id, role INTO v_user_branch, v_role
  FROM public.profiles WHERE id = v_profile_id;

  IF v_role NOT IN ('maintener','owner') AND v_user_branch != v_branch_id THEN
    RAISE EXCEPTION 'Anda hanya dapat mengajukan klaim untuk cabang Anda sendiri.';
  END IF;

  INSERT INTO public.stock_claims (
    item_id, bundle_id, branch_id, quantity, unit, note, status, claimed_by
  ) VALUES (
    NULL, p_bundle_id, v_branch_id, p_quantity, v_bundle_unit, p_note, 'pending', v_profile_id
  )
  RETURNING id INTO v_claim_id;

  RETURN v_claim_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_bundle_claim TO authenticated;

-- ----------------------------------------------------------------
-- 8. RPC: confirm_bundle_claim — setujui klaim bundle,
--    potong stok komponen secara otomatis
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.confirm_bundle_claim(p_claim_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_role        text;
  v_profile_id  uuid;
  v_claim       record;
  v_comp        record;
  v_needed      numeric;
  v_current     numeric;
BEGIN
  v_profile_id := public.current_profile_id();
  SELECT role INTO v_role FROM public.profiles WHERE id = v_profile_id;
  IF v_role NOT IN ('maintener','owner','manager','kepala_mekanik') THEN
    RAISE EXCEPTION 'Hanya manager/kepala mekanik yang dapat mengonfirmasi klaim.';
  END IF;

  -- Ambil klaim
  SELECT * INTO v_claim
  FROM public.stock_claims
  WHERE id = p_claim_id AND bundle_id IS NOT NULL AND status = 'pending';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Klaim bundle tidak ditemukan atau sudah diproses.';
  END IF;

  -- Loop komponen: potong stok proporsional
  FOR v_comp IN
    SELECT bc.item_id, bc.quantity, ii.current_stock, ii.item_name, ii.unit, ii.unit_cost
    FROM public.bundle_components bc
    JOIN public.inventory_items ii ON ii.id = bc.item_id
    WHERE bc.bundle_id = v_claim.bundle_id
  LOOP
    v_needed := v_comp.quantity * v_claim.quantity;
    v_current := COALESCE(v_comp.current_stock, 0);

    IF v_current < v_needed THEN
      RAISE EXCEPTION 'Stok % tidak cukup. Tersedia: % %, dibutuhkan: % %.',
        v_comp.item_name,
        v_current, v_comp.unit,
        v_needed, v_comp.unit;
    END IF;

    -- Kurangi stok
    UPDATE public.inventory_items
    SET current_stock = current_stock - v_needed
    WHERE id = v_comp.item_id;

    -- Log stok keluar
    INSERT INTO public.stock_logs (item_id, change_type, quantity, note, created_by, unit_cost, cost_amount)
    VALUES (
      v_comp.item_id,
      'claim_bundle',
      -v_needed,
      'Bundle claim: ' || (SELECT bundle_name FROM public.bundle_items WHERE id = v_claim.bundle_id),
      v_profile_id,
      v_comp.unit_cost,
      CASE WHEN v_comp.unit_cost IS NOT NULL THEN v_needed * v_comp.unit_cost ELSE NULL END
    );
  END LOOP;

  -- Update status klaim
  UPDATE public.stock_claims
  SET status = 'confirmed', confirmed_by = v_profile_id, confirmed_at = now()
  WHERE id = p_claim_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.confirm_bundle_claim TO authenticated;

-- ----------------------------------------------------------------
-- 9. RPC: set_service_bundle_recipe — atur bahan bundle di resep jasa
-- ----------------------------------------------------------------
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
  IF v_role NOT IN ('maintener','owner','manager') THEN
    RAISE EXCEPTION 'Hanya owner/manager yang dapat mengatur resep.';
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

-- ----------------------------------------------------------------
-- 10. UNIQUE constraint di service_material_recipes untuk bundle_item_id
-- ----------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'smr_branch_service_bundle_unique'
  ) THEN
    ALTER TABLE public.service_material_recipes
      ADD CONSTRAINT smr_branch_service_bundle_unique
      UNIQUE (branch_id, service_id, bundle_item_id);
  END IF;
END $$;

-- ----------------------------------------------------------------
-- 11. Update consume_order_materials RPC agar selesaikan bundle juga
-- ----------------------------------------------------------------
DROP FUNCTION IF EXISTS public.consume_order_materials(uuid);
CREATE OR REPLACE FUNCTION public.consume_order_materials(p_order_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_order       record;
  v_recipe      record;
  v_comp        record;
  v_qty_col     text;
  v_qty         numeric;
  v_comp_needed numeric;
BEGIN
  -- Ambil order
  SELECT o.*, s.vehicle_size, s.vehicle_type
  INTO v_order
  FROM public.orders o
  LEFT JOIN public.order_services os ON os.order_id = o.id
  LEFT JOIN (
    SELECT order_id, vehicle_size, vehicle_type FROM public.orders LIMIT 1
  ) s ON true
  WHERE o.id = p_order_id
  LIMIT 1;

  -- Ambil ulang dengan JOIN yang benar
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id;

  -- Tentukan kolom qty berdasarkan ukuran & tipe kendaraan
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

  -- Loop resep bahan BIASA (item_id IS NOT NULL)
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
      'Order #' || p_order_id,
      NULL,
      v_recipe.unit_cost,
      CASE WHEN v_recipe.unit_cost IS NOT NULL THEN v_qty * v_recipe.unit_cost ELSE NULL END
    );
  END LOOP;

  -- Loop resep bundle (bundle_item_id IS NOT NULL) → resolve ke komponen
  FOR v_recipe IN
    SELECT smr.*
    FROM public.service_material_recipes smr
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

    -- Resolve bundle → potong tiap komponen
    FOR v_comp IN
      SELECT bc.item_id, bc.quantity AS comp_qty_per_unit,
             ii.unit_cost, ii.item_name, ii.unit
      FROM public.bundle_components bc
      JOIN public.inventory_items ii ON ii.id = bc.item_id
      WHERE bc.bundle_id = v_recipe.bundle_item_id
    LOOP
      v_comp_needed := v_comp.comp_qty_per_unit * v_qty;

      UPDATE public.inventory_items
      SET current_stock = GREATEST(current_stock - v_comp_needed, 0)
      WHERE id = v_comp.item_id;

      INSERT INTO public.stock_logs (item_id, change_type, quantity, note, created_by, unit_cost, cost_amount)
      VALUES (
        v_comp.item_id,
        'order_consume_bundle',
        -v_comp_needed,
        'Order #' || p_order_id || ' via bundle',
        NULL,
        v_comp.unit_cost,
        CASE WHEN v_comp.unit_cost IS NOT NULL THEN v_comp_needed * v_comp.unit_cost ELSE NULL END
      );
    END LOOP;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.consume_order_materials TO authenticated;
