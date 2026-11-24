-- ============================================================
-- 0136_fix_bundle_recipe_rpc_and_rollback.sql
-- 1. Fix set_service_bundle_recipe (add RETURNING *)
-- 2. Add restore_order_materials RPC (stock rollback on cancel/void)
-- 3. Update cancel_order to support stock rollback
-- 4. Create maintenance_schedules table for 6-month & 1-year care
-- 5. Auto generate maintenance schedules on order completion
-- ============================================================

-- ------------------------------------------------------------
-- 1. Fix set_service_bundle_recipe (tambahkan RETURNING *)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_service_bundle_recipe(
  p_branch_id      uuid,
  p_service_id     uuid,
  p_bundle_item_id uuid,
  p_remove         boolean DEFAULT false,
  p_qty_s          numeric DEFAULT NULL,
  p_qty_m          numeric DEFAULT NULL,
  p_qty_l          numeric DEFAULT NULL,
  p_qty_xl         numeric DEFAULT NULL,
  p_qty_motor_s    numeric DEFAULT NULL,
  p_qty_motor_m    numeric DEFAULT NULL,
  p_qty_motor_l    numeric DEFAULT NULL,
  p_qty_motor_xl   numeric DEFAULT NULL
)
RETURNS setof public.service_material_recipes
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_role text;
BEGIN
  SELECT role INTO v_role FROM public.profiles WHERE id = public.current_profile_id();
  IF v_role NOT IN ('owner', 'maintainer', 'maintener', 'manager', 'finance', 'admin_kasir') THEN
    RAISE EXCEPTION 'Hanya owner, manager, maintainer, finance, dan admin kasir yang dapat mengatur resep racikan.';
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
    qty_motor_xl = EXCLUDED.qty_motor_xl
  RETURNING *;
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_service_bundle_recipe TO authenticated;

-- ------------------------------------------------------------
-- 2. RPC restore_order_materials (Rollback Stok Bahan & Racikan)
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS public.restore_order_materials(uuid);
CREATE OR REPLACE FUNCTION public.restore_order_materials(p_order_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_log     record;
  v_balance numeric;
BEGIN
  -- Ambil semua pemotongan stok otomatis (log_type = 'out') untuk order ini
  -- yang belum pernah di-rollback
  FOR v_log IN
    SELECT sl.*
    FROM public.stock_logs sl
    WHERE sl.reference_id = p_order_id
      AND sl.log_type = 'out'::public.stock_log_type
      AND NOT EXISTS (
        SELECT 1 FROM public.stock_logs rb
        WHERE rb.reference_id = p_order_id
          AND rb.log_type = 'in'::public.stock_log_type
          AND (
            (rb.item_id IS NOT NULL AND rb.item_id = sl.item_id) OR
            (rb.bundle_id IS NOT NULL AND rb.bundle_id = sl.bundle_id)
          )
      )
  LOOP
    -- A. Kembalikan stok bahan gudang (jika item_id terisi)
    IF v_log.item_id IS NOT NULL THEN
      UPDATE public.inventory_items
      SET current_stock = current_stock + v_log.quantity
      WHERE id = v_log.item_id
      RETURNING current_stock INTO v_balance;

      INSERT INTO public.stock_logs (
        branch_id, item_id, bundle_id, log_type, quantity, balance_after,
        reference_id, created_by, note, unit_cost, cost_amount
      ) VALUES (
        v_log.branch_id,
        v_log.item_id,
        NULL,
        'in'::public.stock_log_type,
        v_log.quantity,
        v_balance,
        p_order_id,
        public.current_profile_id(),
        'Rollback pembatalan order #' || SUBSTRING(p_order_id::text, 1, 8),
        v_log.unit_cost,
        v_log.cost_amount
      );
    END IF;

    -- B. Kembalikan stok bahan racikan (jika bundle_id terisi)
    IF v_log.bundle_id IS NOT NULL THEN
      UPDATE public.bundle_items
      SET current_stock = current_stock + v_log.quantity
      WHERE id = v_log.bundle_id
      RETURNING current_stock INTO v_balance;

      INSERT INTO public.stock_logs (
        branch_id, item_id, bundle_id, log_type, quantity, balance_after,
        reference_id, created_by, note, unit_cost, cost_amount
      ) VALUES (
        v_log.branch_id,
        NULL,
        v_log.bundle_id,
        'in'::public.stock_log_type,
        v_log.quantity,
        v_balance,
        p_order_id,
        public.current_profile_id(),
        'Rollback pembatalan racikan order #' || SUBSTRING(p_order_id::text, 1, 8),
        v_log.unit_cost,
        v_log.cost_amount
      );
    END IF;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.restore_order_materials TO authenticated;

-- ------------------------------------------------------------
-- 3. Perbarui cancel_order untuk memanggil restore_order_materials
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cancel_order(p_order_id uuid, p_reason TEXT DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_order public.orders%rowtype;
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN
    RAISE EXCEPTION 'Pembatalan hanya bisa dilakukan oleh pengguna yang sudah masuk.';
  END IF;

  IF NOT (SELECT public.has_role(ARRAY['owner','admin_kasir','maintainer']::public.user_role[])) THEN
    RAISE EXCEPTION 'Hanya owner, admin kasir, dan maintainer yang bisa membatalkan order.';
  END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order tidak ditemukan.';
  END IF;

  IF v_order.status = 'cancelled' THEN
    RAISE EXCEPTION 'Order ini sudah berstatus batal.';
  END IF;

  -- Jika order sebelumnya berstatus 'completed', lakukan rollback stok bahan
  IF v_order.status = 'completed' THEN
    PERFORM public.restore_order_materials(p_order_id);
  END IF;

  UPDATE public.orders
     SET status = 'cancelled'::public.order_status,
         cancellation_reason = nullif(btrim(coalesce(p_reason, '')), ''),
         completed_at = NULL,
         updated_at = now()
   WHERE id = p_order_id;

  INSERT INTO public.activity_logs (actor_id, action, entity, entity_id, metadata)
  VALUES (
    (SELECT public.current_profile_id()),
    'order.cancelled',
    'orders', p_order_id,
    jsonb_build_object('order_number', v_order.order_number, 'reason', p_reason, 'previous_status', v_order.status)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.cancel_order TO authenticated;

-- ------------------------------------------------------------
-- 4. Tabel maintenance_schedules (Jadwal Perawatan Berkala)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.maintenance_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  warranty_id uuid NULL REFERENCES public.warranties(id) ON DELETE SET NULL,
  customer_name text NOT NULL,
  customer_phone text NULL,
  license_plate text NOT NULL,
  vehicle_model text NOT NULL,
  service_package text NOT NULL,
  schedule_type text NOT NULL CHECK (schedule_type IN ('6_month', '12_month')),
  due_date date NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'reminded', 'completed', 'cancelled')),
  reminded_at timestamptz NULL,
  notes text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_order_schedule_type UNIQUE (order_id, schedule_type)
);

CREATE INDEX IF NOT EXISTS idx_maint_schedules_branch_due
  ON public.maintenance_schedules (branch_id, due_date, status);

ALTER TABLE public.maintenance_schedules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "maintenance_schedules_select" ON public.maintenance_schedules;
CREATE POLICY "maintenance_schedules_select" ON public.maintenance_schedules
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "maintenance_schedules_all" ON public.maintenance_schedules;
CREATE POLICY "maintenance_schedules_all" ON public.maintenance_schedules
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ------------------------------------------------------------
-- 5. RPC generate_maintenance_schedules
--    Otomatis membuat jadwal 6 bulan & 12 bulan saat order selesai
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.generate_maintenance_schedules(p_order_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_order    public.orders%rowtype;
  v_warranty public.warranties%rowtype;
  v_base_date date;
BEGIN
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id;
  IF NOT FOUND THEN RETURN; END IF;

  SELECT * INTO v_warranty FROM public.warranties WHERE order_id = p_order_id LIMIT 1;

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

GRANT EXECUTE ON FUNCTION public.generate_maintenance_schedules TO authenticated;

-- ------------------------------------------------------------
-- 6. RPC update_maintenance_schedule_status
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.update_maintenance_schedule_status(
  p_schedule_id uuid,
  p_status      text,
  p_notes       text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
BEGIN
  UPDATE public.maintenance_schedules
  SET status = p_status,
      reminded_at = CASE WHEN p_status = 'reminded' THEN now() ELSE reminded_at END,
      notes = COALESCE(p_notes, notes),
      updated_at = now()
  WHERE id = p_schedule_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_maintenance_schedule_status TO authenticated;
