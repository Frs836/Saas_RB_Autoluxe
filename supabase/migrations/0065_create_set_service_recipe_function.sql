-- 0065: create set_service_recipe function for production (columns already exist)
--
-- Production already has the per-size columns but the function was never created.

DROP FUNCTION IF EXISTS public.set_service_recipe(
  uuid, uuid, uuid, numeric,
  numeric, numeric, numeric, numeric,
  numeric, numeric, numeric, numeric, numeric,
  boolean
);

CREATE OR REPLACE FUNCTION public.set_service_recipe(
  p_branch_id uuid,
  p_service_id uuid,
  p_item_id uuid,
  p_quantity numeric,
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