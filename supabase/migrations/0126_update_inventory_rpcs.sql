-- 0126: Update RPC create_inventory_item & bulk_import_inventory dengan atribut packaging
CREATE OR REPLACE FUNCTION public.create_inventory_item(
  p_item_name            text,
  p_unit                 text,
  p_current_stock        numeric  DEFAULT 0,
  p_min_stock_alert      numeric  DEFAULT 0,
  p_unit_cost            numeric  DEFAULT NULL,
  p_branch_id            uuid     DEFAULT NULL,
  p_purchase_unit        text     DEFAULT 'Pcs',
  p_purchase_price       numeric  DEFAULT 0,
  p_purchase_content_qty numeric  DEFAULT 1
)
RETURNS public.inventory_items
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile_id  uuid;
  v_role        text;
  v_branch_id   uuid;
  v_item        public.inventory_items%ROWTYPE;
  v_cost        numeric;
BEGIN
  v_profile_id := (SELECT public.current_profile_id());
  IF v_profile_id IS NULL THEN RAISE EXCEPTION 'Sesi tidak valid.'; END IF;

  SELECT role::text INTO v_role FROM public.profiles WHERE id = v_profile_id;
  IF v_role NOT IN ('owner','maintainer','manager','kepala_karyawan','finance') THEN
    RAISE EXCEPTION 'Hanya owner, maintainer, manager, kepala karyawan, atau finance yang bisa menambah item stok.';
  END IF;

  IF NULLIF(btrim(p_item_name),'') IS NULL THEN
    RAISE EXCEPTION 'Nama item wajib diisi.';
  END IF;

  -- Tentukan branch_id
  v_branch_id := COALESCE(
    p_branch_id,
    (SELECT branch_id FROM public.profiles WHERE id = v_profile_id)
  );
  IF v_branch_id IS NULL THEN RAISE EXCEPTION 'Cabang tidak ditemukan.'; END IF;

  -- Hitung unit cost otomatis jika ada kemasan beli
  IF p_purchase_price IS NOT NULL AND p_purchase_price > 0
     AND p_purchase_content_qty IS NOT NULL AND p_purchase_content_qty > 0 THEN
    v_cost := round(p_purchase_price / p_purchase_content_qty, 2);
  ELSE
    v_cost := p_unit_cost;
  END IF;

  INSERT INTO public.inventory_items (
    item_name, unit, current_stock, min_stock_alert, unit_cost, branch_id,
    purchase_unit, purchase_price, purchase_content_qty
  ) VALUES (
    btrim(p_item_name),
    COALESCE(btrim(p_unit),'pcs'),
    GREATEST(0, COALESCE(p_current_stock,0)),
    GREATEST(0, COALESCE(p_min_stock_alert,0)),
    v_cost,
    v_branch_id,
    COALESCE(NULLIF(btrim(p_purchase_unit),''), 'Pcs'),
    GREATEST(0, COALESCE(p_purchase_price,0)),
    GREATEST(0.01, COALESCE(p_purchase_content_qty,1))
  ) RETURNING * INTO v_item;

  INSERT INTO public.activity_logs (actor_id, action, entity, entity_id, metadata)
  VALUES (v_profile_id, 'stock.item_created', 'inventory_items', v_item.id,
    jsonb_build_object(
      'item_name', v_item.item_name,
      'unit', v_item.unit,
      'purchase_unit', v_item.purchase_unit,
      'purchase_price', v_item.purchase_price,
      'purchase_content_qty', v_item.purchase_content_qty,
      'unit_cost', v_item.unit_cost,
      'initial_stock', p_current_stock
    ));

  RETURN v_item;
END;
$$;

REVOKE ALL ON FUNCTION public.create_inventory_item(text,text,numeric,numeric,numeric,uuid,text,numeric,numeric) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.create_inventory_item(text,text,numeric,numeric,numeric,uuid,text,numeric,numeric) TO authenticated;

-- Update bulk_import_inventory
CREATE OR REPLACE FUNCTION public.bulk_import_inventory(
  p_items    jsonb,   -- [{item_name, unit, current_stock, min_stock_alert, unit_cost, purchase_unit, purchase_price, purchase_content_qty}]
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
BEGIN
  v_profile_id := (SELECT public.current_profile_id());
  SELECT role::text INTO v_role FROM public.profiles WHERE id = v_profile_id;
  IF v_role NOT IN ('owner','maintainer','manager','finance') THEN
    RAISE EXCEPTION 'Hanya owner, maintainer, manager, atau finance yang bisa bulk import stok.';
  END IF;

  v_branch_id := COALESCE(p_branch_id,
    (SELECT branch_id FROM public.profiles WHERE id = v_profile_id));

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_name := btrim(COALESCE(v_item->>'item_name',''));
    IF v_name = '' THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    v_p_price := COALESCE((v_item->>'purchase_price')::numeric, 0);
    v_p_qty   := COALESCE((v_item->>'purchase_content_qty')::numeric, 1);
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
        GREATEST(0, COALESCE((v_item->>'current_stock')::numeric,0)),
        GREATEST(0, COALESCE((v_item->>'min_stock_alert')::numeric,0)),
        v_cost,
        v_branch_id,
        COALESCE(NULLIF(btrim(v_item->>'purchase_unit'),''),'Pcs'),
        v_p_price,
        v_p_qty
      )
      ON CONFLICT (item_name, branch_id) DO UPDATE SET
        current_stock        = EXCLUDED.current_stock,
        min_stock_alert      = EXCLUDED.min_stock_alert,
        purchase_unit        = COALESCE(EXCLUDED.purchase_unit, inventory_items.purchase_unit),
        purchase_price       = COALESCE(EXCLUDED.purchase_price, inventory_items.purchase_price),
        purchase_content_qty = COALESCE(EXCLUDED.purchase_content_qty, inventory_items.purchase_content_qty),
        unit_cost            = COALESCE(EXCLUDED.unit_cost, inventory_items.unit_cost),
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

REVOKE ALL ON FUNCTION public.bulk_import_inventory(jsonb,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.bulk_import_inventory(jsonb,uuid) TO authenticated;
