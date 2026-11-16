-- ============================================================================
-- Migrasi 0125: Sistem Biaya Produksi (Production Cost & Packaging Math)
--
-- 1. Menambahkan atribut kemasan belanja pada inventory_items:
--    - purchase_unit: Satuan beli (Botol, Jerigen, Box, Pcs, dll)
--    - purchase_price: Harga beli per kemasan (Rp)
--    - purchase_content_qty: Isi per kemasan dalam satuan pakai (contoh 800 ml)
--    - unit_cost: Biaya per satuan pakai = purchase_price / purchase_content_qty
--
-- 2. Menambahkan atribut biaya pada stock_logs:
--    - unit_cost: Biaya per unit saat log terjadi
--    - cost_amount: Total nilai rupiah (quantity * unit_cost)
--
-- 3. Memperbarui fungsi consume_order_materials:
--    - Menghitung modal bahan terpakai otomatis dari resep dan unit_cost
--    - Menyimpan unit_cost dan cost_amount pada setiap baris stock_logs
--
-- 4. Fungsi & View Pelaporan Biaya Produksi untuk Finance & Owner
-- ============================================================================

-- 1. Tambah kolom pada inventory_items
ALTER TABLE public.inventory_items
  ADD COLUMN IF NOT EXISTS purchase_unit varchar(50) DEFAULT 'Pcs',
  ADD COLUMN IF NOT EXISTS purchase_price numeric(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS purchase_content_qty numeric(12,2) DEFAULT 1;

COMMENT ON COLUMN public.inventory_items.purchase_unit IS 'Satuan saat membeli dari supplier (cth: Botol, Jerigen, Box, Pcs).';
COMMENT ON COLUMN public.inventory_items.purchase_price IS 'Harga beli per kemasan/satuan belanja (Rp).';
COMMENT ON COLUMN public.inventory_items.purchase_content_qty IS 'Isi bersih kemasan dalam satuan dasar workshop (cth: 800 ml dlm 1 botol).';

-- Trigger untuk otomatis sinkronisasi unit_cost = purchase_price / purchase_content_qty
CREATE OR REPLACE FUNCTION public.sync_inventory_unit_cost()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.purchase_price IS NOT NULL AND NEW.purchase_price > 0
     AND NEW.purchase_content_qty IS NOT NULL AND NEW.purchase_content_qty > 0 THEN
    NEW.unit_cost := round(NEW.purchase_price / NEW.purchase_content_qty, 2);
  ELSIF NEW.unit_cost IS NOT NULL AND NEW.unit_cost > 0 AND (NEW.purchase_price IS NULL OR NEW.purchase_price = 0) THEN
    -- Jika diisi unit_cost langsung tanpa kemasan beli
    NEW.purchase_price := NEW.unit_cost;
    NEW.purchase_content_qty := 1;
    IF NEW.purchase_unit IS NULL OR NEW.purchase_unit = '' THEN
      NEW.purchase_unit := NEW.unit;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_sync_inventory_unit_cost ON public.inventory_items;
CREATE TRIGGER trg_sync_inventory_unit_cost
  BEFORE INSERT OR UPDATE OF purchase_price, purchase_content_qty, unit_cost
  ON public.inventory_items
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_inventory_unit_cost();

-- 2. Tambah kolom pada stock_logs
ALTER TABLE public.stock_logs
  ADD COLUMN IF NOT EXISTS unit_cost numeric(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cost_amount numeric(12,2) DEFAULT 0;

COMMENT ON COLUMN public.stock_logs.unit_cost IS 'Biaya per satuan item saat mutasi stok tercatat.';
COMMENT ON COLUMN public.stock_logs.cost_amount IS 'Total nilai rupiah dari mutasi stok (quantity * unit_cost).';

-- 3. Perbarui consume_order_materials dengan kalkulasi biaya produksi
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

  -- Mencegah pemotongan ganda bila sudah pernah dipotong untuk order ini
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
      v_amount    numeric;
      v_item      public.inventory_items%rowtype;
      v_balance   numeric;
      v_cost_item numeric := 0;
      v_total_cost numeric := 0;
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
      v_cost_item := COALESCE(v_item.unit_cost, 0);
      v_total_cost := round(v_amount * v_cost_item, 2);

      UPDATE public.inventory_items
         SET current_stock = v_balance,
             updated_at = now()
       WHERE id = r.item_id;

      INSERT INTO public.stock_logs (
        branch_id, item_id, log_type, quantity, balance_after,
        reference_id, created_by, note, unit_cost, cost_amount
      )
      VALUES (
        v_order.branch_id,
        r.item_id,
        'out'::public.stock_log_type,
        v_amount,
        v_balance,
        p_order_id,
        public.current_profile_id(),
        'auto: pemakaian bahan order · ' || v_item.item_name
          || ' ' || trim_scale(v_amount) || ' ' || v_item.unit
          || ' (HPP @ Rp ' || trim_scale(v_cost_item) || ' = Rp ' || trim_scale(v_total_cost) || ')'
          || ' untuk ' || v_order.order_number
          || ' (' || v_order.license_plate
          || ', ' || v_order.vehicle_size::text || ') — ' || r.service_name,
        v_cost_item,
        v_total_cost
      );

      v_cut := v_cut + 1;
    END;
  END LOOP;

  RETURN v_cut;
END;
$function$;

REVOKE ALL ON FUNCTION public.consume_order_materials(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.consume_order_materials(uuid) TO authenticated;

-- 4. Perbarui record_stock_in untuk menyimpan harga per unit & cost_amount pada stock_logs
CREATE OR REPLACE FUNCTION public.record_stock_in(
  p_item_id uuid,
  p_quantity numeric,
  p_unit_cost numeric default null,
  p_note text default null::text
)
RETURNS public.inventory_items
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_profile uuid;
  v_item    public.inventory_items%rowtype;
  v_balance numeric;
  v_row     public.inventory_items%rowtype;
  v_cost    numeric := 0;
  v_total   numeric := 0;
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN
    RAISE EXCEPTION 'Stok masuk hanya bisa dicatat oleh pengguna yang sudah masuk.';
  END IF;

  v_profile := (SELECT public.current_profile_id());
  IF v_profile IS NULL THEN
    RAISE EXCEPTION 'Sesi tidak valid.';
  END IF;

  IF NOT coalesce((
    SELECT public.has_role(array['owner', 'admin_kasir', 'manager', 'finance', 'maintainer']::public.user_role[])
  ), false) THEN
    RAISE EXCEPTION 'Hanya staf berwenang yang bisa mencatat stok masuk.';
  END IF;

  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'Jumlah stok masuk harus lebih dari nol.';
  END IF;

  IF p_unit_cost IS NOT NULL AND p_unit_cost < 0 THEN
    RAISE EXCEPTION 'Harga beli tidak boleh negatif.';
  END IF;

  SELECT * INTO v_item
    FROM public.inventory_items
   WHERE id = p_item_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Item stok tidak ditemukan.';
  END IF;

  IF NOT public.can_access_branch(v_item.branch_id) THEN
    RAISE EXCEPTION 'Item stok ini milik cabang lain.';
  END IF;

  v_balance := round(v_item.current_stock + p_quantity, 2);
  v_cost := COALESCE(p_unit_cost, v_item.unit_cost, 0);
  v_total := round(p_quantity * v_cost, 2);

  UPDATE public.inventory_items
     SET current_stock = v_balance,
         unit_cost = CASE
           WHEN p_unit_cost IS NULL THEN v_item.unit_cost
           ELSE round(p_unit_cost, 2)
         END,
         updated_at = now()
   WHERE id = v_item.id
  RETURNING * INTO v_row;

  INSERT INTO public.stock_logs (
    branch_id, item_id, log_type, quantity, balance_after, note, created_by,
    unit_cost, cost_amount
  )
  VALUES (
    v_item.branch_id,
    v_item.id,
    'in'::public.stock_log_type,
    round(p_quantity, 2),
    v_balance,
    nullif(btrim(coalesce(p_note, '')), ''),
    v_profile,
    v_cost,
    v_total
  );

  RETURN v_row;
END;
$function$;

REVOKE ALL ON FUNCTION public.record_stock_in(uuid, numeric, numeric, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.record_stock_in(uuid, numeric, numeric, text) TO authenticated;

-- 5. RPC untuk mengambil rincian biaya produksi per order
CREATE OR REPLACE FUNCTION public.get_order_production_cost(p_order_id uuid)
RETURNS TABLE (
  item_id uuid,
  item_name text,
  quantity numeric,
  unit text,
  unit_cost numeric,
  cost_amount numeric,
  created_at timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO ''
AS $$
  SELECT
    l.item_id,
    i.item_name::text,
    l.quantity,
    i.unit::text,
    l.unit_cost,
    l.cost_amount,
    l.created_at
  FROM public.stock_logs l
  JOIN public.inventory_items i ON i.id = l.item_id
  WHERE l.reference_id = p_order_id
    AND l.log_type = 'out'::public.stock_log_type
    AND l.note LIKE 'auto: pemakaian bahan order%'
  ORDER BY l.created_at ASC;
$$;

REVOKE ALL ON FUNCTION public.get_order_production_cost(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_order_production_cost(uuid) TO authenticated;
