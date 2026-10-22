-- 0063: tambah per-size quantity ke resep bahan + pakai di pemotongan.
--
-- Resep bahan sekarang punya kuantitas per ukuran kendaraan (S/M/L/XL + motor)
-- supaya pemotongan stok di checkout menyesuaikan ukuran unit.
-- Default qty_* = quantity (nilai lama) agar migrasi idempoten & aman.

-- 1. Tambah kolom per ukuran
ALTER TABLE public.service_material_recipes
  ADD COLUMN IF NOT EXISTS qty_s numeric(10,2),
  ADD COLUMN IF NOT EXISTS qty_m numeric(10,2),
  ADD COLUMN IF NOT EXISTS qty_l numeric(10,2),
  ADD COLUMN IF NOT EXISTS qty_xl numeric(10,2),
  ADD COLUMN IF NOT EXISTS qty_motor numeric(10,2),
  ADD COLUMN IF NOT EXISTS qty_motor_s numeric(10,2),
  ADD COLUMN IF NOT EXISTS qty_motor_m numeric(10,2),
  ADD COLUMN IF NOT EXISTS qty_motor_l numeric(10,2),
  ADD COLUMN IF NOT EXISTS qty_motor_xl numeric(10,2);

-- 2. Isi default dari quantity lama
UPDATE public.service_material_recipes
SET qty_s = quantity, qty_m = quantity, qty_l = quantity, qty_xl = quantity,
    qty_motor = quantity, qty_motor_s = quantity, qty_motor_m = quantity,
    qty_motor_l = quantity, qty_motor_xl = quantity
WHERE qty_s IS NULL;

-- 3. Hapus kolom quantity lama (sudah tidak dipakai)
ALTER TABLE public.service_material_recipes
  DROP COLUMN IF EXISTS quantity;

-- 4. Update RPC set_service_recipe untuk set per-size (baru: p_qty_* opsional,
--    default = p_quantity untuk backward compat)
CREATE OR REPLACE FUNCTION public.set_service_recipe(
  p_branch_id uuid,
  p_service_id uuid,
  p_item_id uuid,
  p_quantity numeric,          -- default/legacy (dipakai untuk qty_s & qty_motor)
  p_qty_s numeric DEFAULT NULL,
  p_qty_m numeric DEFAULT NULL,
  p_qty_l numeric DEFAULT NULL,
  p_qty_xl numeric DEFAULT NULL,
  p_qty_motor numeric DEFAULT NULL,
  p_qty_motor_s numeric DEFAULT NULL,
  p_qty_motor_m numeric DEFAULT NULL,
  p_qty_motor_l numeric DEFAULT NULL,
  p_qty_motor_xl numeric DEFAULT NULL,
  p_remove boolean DEFAULT false
)
RETURNS public.service_material_recipes
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_profile uuid;
  v_item    public.inventory_items%rowtype;
  v_row     public.service_material_recipes%rowtype;
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN
    RAISE EXCEPTION 'Resep bahan hanya bisa diubah pengguna yang sudah masuk.';
  END IF;

  v_profile := public.current_profile_id();
  IF v_profile IS NULL THEN
    RAISE EXCEPTION 'Sesi tidak valid.';
  END IF;

  IF NOT COALESCE((
    SELECT public.has_role(ARRAY['owner','admin_kasir','maintainer']::public.user_role[])
  ), false) THEN
    RAISE EXCEPTION 'Hanya owner, admin kasir, dan maintainer yang bisa mengatur resep bahan.';
  END IF;

  IF NOT public.can_access_branch(p_branch_id) THEN
    RAISE EXCEPTION 'Cabang tersebut tidak dapat diakses.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.services WHERE id = p_service_id) THEN
    RAISE EXCEPTION 'Layanan tidak ditemukan.';
  END IF;

  SELECT * INTO v_item FROM public.inventory_items WHERE id = p_item_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Item stok tidak ditemukan.';
  END IF;

  IF v_item.branch_id <> p_branch_id THEN
    RAISE EXCEPTION 'Item stok bukan milik cabang yang dipilih.';
  END IF;

  IF COALESCE(p_remove, false) THEN
    DELETE FROM public.service_material_recipes
     WHERE branch_id = p_branch_id
       AND service_id = p_service_id
       AND item_id = p_item_id
    RETURNING * INTO v_row;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Resep tidak ditemukan.';
    END IF;
    RETURN v_row;
  END IF;

  -- Validasi: minimal qty_s atau qty (legacy) > 0
  IF COALESCE(p_qty_s, p_quantity) IS NULL OR COALESCE(p_qty_s, p_quantity) <= 0 THEN
    RAISE EXCEPTION 'Kuantitas minimal (qty_s) harus lebih dari nol.';
  END IF;

  INSERT INTO public.service_material_recipes (
    branch_id, service_id, item_id,
    qty_s, qty_m, qty_l, qty_xl,
    qty_motor, qty_motor_s, qty_motor_m, qty_motor_l, qty_motor_xl,
    created_by
  )
  VALUES (
    p_branch_id, p_service_id, p_item_id,
    COALESCE(p_qty_s, p_quantity),
    COALESCE(p_qty_m, COALESCE(p_qty_s, p_quantity)),
    COALESCE(p_qty_l, COALESCE(p_qty_s, p_quantity)),
    COALESCE(p_qty_xl, COALESCE(p_qty_s, p_quantity)),
    COALESCE(p_qty_motor, COALESCE(p_quantity, 0)),
    COALESCE(p_qty_motor_s, COALESCE(p_qty_motor, COALESCE(p_quantity, 0))),
    COALESCE(p_qty_motor_m, COALESCE(p_qty_motor, COALESCE(p_quantity, 0))),
    COALESCE(p_qty_motor_l, COALESCE(p_qty_motor, COALESCE(p_quantity, 0))),
    COALESCE(p_qty_motor_xl, COALESCE(p_qty_motor, COALESCE(p_quantity, 0))),
    v_profile
  )
  ON CONFLICT (branch_id, service_id, item_id)
  DO UPDATE SET
    qty_s = EXCLUDED.qty_s,
    qty_m = EXCLUDED.qty_m,
    qty_l = EXCLUDED.qty_l,
    qty_xl = EXCLUDED.qty_xl,
    qty_motor = EXCLUDED.qty_motor,
    qty_motor_s = EXCLUDED.qty_motor_s,
    qty_motor_m = EXCLUDED.qty_motor_m,
    qty_motor_l = EXCLUDED.qty_motor_l,
    qty_motor_xl = EXCLUDED.qty_motor_xl,
    updated_at = now()
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$function$;

REVOKE ALL ON FUNCTION public.set_service_recipe(
  uuid, uuid, uuid, numeric,
  numeric, numeric, numeric, numeric,
  numeric, numeric, numeric, numeric, numeric,
  boolean
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_service_recipe(
  uuid, uuid, uuid, numeric,
  numeric, numeric, numeric, numeric,
  numeric, numeric, numeric, numeric, numeric,
  boolean
) TO authenticated;

-- 5. Update consume_order_materials untuk pakai kolom per-size
CREATE OR REPLACE FUNCTION public.consume_order_materials(p_order_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_order public.orders%rowtype;
  v_cut   integer := 0;
  r       record;
BEGIN
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order tidak ditemukan.';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public.stock_logs l
     WHERE l.reference_id = p_order_id
       AND l.log_type = 'out'::public.stock_log_type
       AND l.note LIKE 'auto: pemakaian bahan order%'
  ) THEN
    RETURN 0;
  END IF;

  FOR r IN
    SELECT oi.service_id,
           oi.quantity AS service_qty,
           rec.item_id,
           CASE v_order.vehicle_size::text
             WHEN 'S' THEN rec.qty_s
             WHEN 'M' THEN rec.qty_m
             WHEN 'L' THEN rec.qty_l
             WHEN 'XL' THEN rec.qty_xl
             WHEN 'Motor' THEN rec.qty_motor
             WHEN 'Motor S' THEN rec.qty_motor_s
             WHEN 'Motor M' THEN rec.qty_motor_m
             WHEN 'Motor L' THEN rec.qty_motor_l
             WHEN 'Motor XL' THEN rec.qty_motor_xl
             ELSE rec.qty_s
           END AS per_unit,
           s.name AS service_name
      FROM public.order_items oi
      JOIN public.service_material_recipes rec
        ON rec.service_id = oi.service_id
       AND rec.branch_id = v_order.branch_id
      JOIN public.services s
        ON s.id = oi.service_id
     WHERE oi.order_id = p_order_id
       AND oi.service_id IS NOT NULL
  LOOP
    DECLARE
      v_amount numeric;
      v_item   public.inventory_items%rowtype;
      v_balance numeric;
    BEGIN
      v_amount := round(r.per_unit * r.service_qty, 2);
      IF v_amount <= 0 THEN
        CONTINUE;
      END IF;

      SELECT * INTO v_item
        FROM public.inventory_items
       WHERE id = r.item_id
       FOR UPDATE;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'Item stok resep sudah tidak ada: %', r.item_id;
      END IF;

      v_balance := round(v_item.current_stock - v_amount, 2);

      UPDATE public.inventory_items
         SET current_stock = v_balance,
             updated_at = now()
       WHERE id = r.item_id;

      INSERT INTO public.stock_logs (
        branch_id, item_id, log_type, quantity, balance_after,
        reference_id, created_by, note
      )
      VALUES (
        v_order.branch_id, r.item_id, 'out'::public.stock_log_type, v_amount,
        v_balance, p_order_id, public.current_profile_id(),
        'auto: pemakaian bahan order · ' || v_item.item_name
          || ' ' || trim_scale(v_amount) || ' ' || v_item.unit
          || ' untuk ' || v_order.order_number
          || ' (' || v_order.license_plate
          || ', ' || v_order.vehicle_size::text || ') — ' || r.service_name
      );

      v_cut := v_cut + 1;
    END;
  END LOOP;

  RETURN v_cut;
END;
$function$;

REVOKE ALL ON FUNCTION public.consume_order_materials(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_order_materials(uuid) TO service_role;

-- 6. Update restore_order_materials (tidak perlu ubah logika, tetap pakai stock_logs)