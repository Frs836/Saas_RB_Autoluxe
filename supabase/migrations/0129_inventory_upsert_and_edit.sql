-- ============================================================
-- 0129_inventory_upsert_and_edit.sql
-- 1. Tambahkan UNIQUE constraint (item_name, branch_id) di inventory_items
--    sehingga tidak pernah terjadi dobel item saat bulk import / insert.
-- 2. Buat RPC update_inventory_item untuk mengedit item stok yang sudah ada.
-- 3. Perbaiki bulk_import_inventory agar upsert bersih & otomatis hitung unit_cost.
-- ============================================================

-- 1. UNIQUE constraint pada inventory_items (item_name, branch_id)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'inventory_items_item_name_branch_id_key'
  ) THEN
    ALTER TABLE public.inventory_items
      ADD CONSTRAINT inventory_items_item_name_branch_id_key UNIQUE (item_name, branch_id);
  END IF;
END $$;

-- 2. RPC update_inventory_item
CREATE OR REPLACE FUNCTION public.update_inventory_item(
  p_item_id              uuid,
  p_item_name            text,
  p_unit                 text,
  p_min_stock_alert      numeric,
  p_purchase_unit        text,
  p_purchase_price       numeric,
  p_purchase_content_qty numeric,
  p_current_stock        numeric DEFAULT NULL -- opsional jika ingin koreksi stok langsung
)
RETURNS public.inventory_items
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile_id uuid;
  v_role       text;
  v_item       public.inventory_items%ROWTYPE;
  v_cost       numeric;
  v_p_price    numeric;
  v_p_qty      numeric;
BEGIN
  v_profile_id := (SELECT public.current_profile_id());
  IF v_profile_id IS NULL THEN RAISE EXCEPTION 'Sesi tidak valid.'; END IF;

  SELECT role::text INTO v_role FROM public.profiles WHERE id = v_profile_id;
  IF v_role NOT IN ('owner','maintainer','maintener','manager','kepala_karyawan','finance') THEN
    RAISE EXCEPTION 'Hanya owner, manager, atau finance yang bisa mengubah item stok.';
  END IF;

  SELECT * INTO v_item FROM public.inventory_items WHERE id = p_item_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Item stok tidak ditemukan.';
  END IF;

  v_p_price := COALESCE(p_purchase_price, v_item.purchase_price, 0);
  v_p_qty   := COALESCE(p_purchase_content_qty, v_item.purchase_content_qty, 1);

  IF v_p_price > 0 AND v_p_qty > 0 THEN
    v_cost := round(v_p_price / v_p_qty, 2);
  ELSE
    v_cost := v_item.unit_cost;
  END IF;

  UPDATE public.inventory_items
  SET
    item_name            = COALESCE(NULLIF(btrim(p_item_name),''), item_name),
    unit                 = COALESCE(NULLIF(btrim(p_unit),''), unit),
    min_stock_alert      = GREATEST(0, COALESCE(p_min_stock_alert, min_stock_alert)),
    purchase_unit        = COALESCE(NULLIF(btrim(p_purchase_unit),''), purchase_unit),
    purchase_price       = v_p_price,
    purchase_content_qty = GREATEST(0.01, v_p_qty),
    unit_cost            = v_cost,
    current_stock        = CASE WHEN p_current_stock IS NOT NULL THEN GREATEST(0, p_current_stock) ELSE current_stock END,
    updated_at           = now()
  WHERE id = p_item_id
  RETURNING * INTO v_item;

  INSERT INTO public.activity_logs (actor_id, action, entity, entity_id, metadata)
  VALUES (v_profile_id, 'stock.item_updated', 'inventory_items', v_item.id,
    jsonb_build_object(
      'item_name', v_item.item_name,
      'unit', v_item.unit,
      'purchase_unit', v_item.purchase_unit,
      'purchase_price', v_item.purchase_price,
      'purchase_content_qty', v_item.purchase_content_qty,
      'unit_cost', v_item.unit_cost,
      'current_stock', v_item.current_stock
    ));

  RETURN v_item;
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_inventory_item TO authenticated;

-- 3. Update bulk_import_inventory agar upsert tanpa dobel item & hitung unit_cost otomatis
CREATE OR REPLACE FUNCTION public.bulk_import_inventory(
  p_items    jsonb,   -- [{item_name, unit, current_stock, min_stock_alert, purchase_unit, purchase_price, purchase_content_qty, unit_cost}]
  p_branch_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile_id uuid;
  v_role       text;
  v_branch_id  uuid;
  v_item       jsonb;
  v_imported   int := 0;
  v_skipped    int := 0;
  v_errors     jsonb := '[]'::jsonb;
  v_name       text;
  v_p_price    numeric;
  v_p_qty      numeric;
  v_cost       numeric;
  v_cur_stock  numeric;
  v_min_alert  numeric;
BEGIN
  v_profile_id := (SELECT public.current_profile_id());
  SELECT role::text INTO v_role FROM public.profiles WHERE id = v_profile_id;
  IF v_role NOT IN ('owner','maintainer','maintener','manager','finance') THEN
    RAISE EXCEPTION 'Hanya owner, maintainer, manager, atau finance yang bisa bulk import stok.';
  END IF;

  v_branch_id := COALESCE(p_branch_id,
    (SELECT branch_id FROM public.profiles WHERE id = v_profile_id));
  IF v_branch_id IS NULL THEN
    RAISE EXCEPTION 'Cabang tidak ditentukan.';
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_name := btrim(COALESCE(v_item->>'item_name',''));
    IF v_name = '' THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    v_p_price   := COALESCE((v_item->>'purchase_price')::numeric, 0);
    v_p_qty     := GREATEST(0.01, COALESCE((v_item->>'purchase_content_qty')::numeric, 1));
    v_cur_stock := GREATEST(0, COALESCE((v_item->>'current_stock')::numeric, 0));
    v_min_alert := GREATEST(0, COALESCE((v_item->>'min_stock_alert')::numeric, 0));

    -- Otomatis hitung unit_cost dari harga beli / isi kemasan
    IF v_p_price > 0 AND v_p_qty > 0 THEN
      v_cost := round(v_p_price / v_p_qty, 2);
    ELSE
      v_cost := NULLIF((v_item->>'unit_cost')::numeric, 0);
    END IF;

    BEGIN
      INSERT INTO public.inventory_items (
        item_name, unit, current_stock, min_stock_alert, unit_cost, branch_id,
        purchase_unit, purchase_price, purchase_content_qty
      )
      VALUES (
        v_name,
        COALESCE(NULLIF(btrim(v_item->>'unit'),''),'pcs'),
        v_cur_stock,
        v_min_alert,
        v_cost,
        v_branch_id,
        COALESCE(NULLIF(btrim(v_item->>'purchase_unit'),''),'Pcs'),
        v_p_price,
        v_p_qty
      )
      ON CONFLICT (item_name, branch_id) DO UPDATE SET
        current_stock        = EXCLUDED.current_stock,
        min_stock_alert      = EXCLUDED.min_stock_alert,
        purchase_unit        = EXCLUDED.purchase_unit,
        purchase_price       = EXCLUDED.purchase_price,
        purchase_content_qty = EXCLUDED.purchase_content_qty,
        unit_cost            = EXCLUDED.unit_cost,
        unit                 = EXCLUDED.unit,
        updated_at           = now();

      v_imported := v_imported + 1;
    EXCEPTION WHEN OTHERS THEN
      v_errors := v_errors || jsonb_build_object('item', v_name, 'error', SQLERRM);
      v_skipped := v_skipped + 1;
    END;
  END LOOP;

  RETURN jsonb_build_object('imported', v_imported, 'skipped', v_skipped, 'errors', v_errors);
END;
$$;

GRANT EXECUTE ON FUNCTION public.bulk_import_inventory(jsonb,uuid) TO authenticated;
