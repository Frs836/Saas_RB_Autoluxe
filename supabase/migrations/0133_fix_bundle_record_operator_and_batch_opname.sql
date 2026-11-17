-- ============================================================
-- 0133_fix_bundle_record_operator_and_batch_opname.sql
-- 1. Fix error 'operator does not exist: record ->> unknown' di set_bundle_definition
-- 2. Tambah dukungan p_current_stock di set_bundle_definition agar bisa edit stok fisik langsung
-- 3. Tambah RPC opname_bundle_batch untuk Opname Global seluruh racikan sekaligus
-- ============================================================

-- 1. Perbaiki set_bundle_definition
DROP FUNCTION IF EXISTS public.set_bundle_definition(uuid, text, text, text, jsonb);
DROP FUNCTION IF EXISTS public.set_bundle_definition(uuid, text, text, text, jsonb, numeric);
DROP FUNCTION IF EXISTS public.set_bundle_definition(uuid, text, text, text, jsonb, numeric, uuid);
DROP FUNCTION IF EXISTS public.set_bundle_definition(uuid, text, text, text, jsonb, numeric, uuid, numeric);

CREATE OR REPLACE FUNCTION public.set_bundle_definition(
  p_branch_id     uuid,
  p_bundle_name   text,
  p_unit          text,
  p_description   text DEFAULT NULL,
  p_components    jsonb DEFAULT '[]'::jsonb,
  p_output_qty    numeric DEFAULT 1,
  p_bundle_id     uuid DEFAULT NULL,
  p_current_stock numeric DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_role          text;
  v_branch_id     uuid;
  v_bundle_id     uuid;
  v_clean_unit    text;
  v_old_stock     numeric;
  v_profile_id    uuid;
BEGIN
  v_profile_id := public.current_profile_id();
  SELECT role, branch_id INTO v_role, v_branch_id 
  FROM public.profiles 
  WHERE id = v_profile_id;

  IF v_role NOT IN ('owner', 'maintainer', 'maintener', 'manager', 'finance') THEN
    RAISE EXCEPTION 'Hanya owner, manager, maintainer, dan finance yang dapat mengelola racikan.';
  END IF;

  -- Normalisasi unit: ml, gr, pcs
  v_clean_unit := LOWER(TRIM(COALESCE(p_unit, 'ml')));
  IF v_clean_unit NOT IN ('ml', 'gr', 'pcs') THEN
    v_clean_unit := 'ml';
  END IF;

  -- Fallback branch_id jika kosong
  v_branch_id := COALESCE(p_branch_id, v_branch_id);
  IF v_branch_id IS NULL THEN
    SELECT id INTO v_branch_id FROM public.branches WHERE is_active = true LIMIT 1;
  END IF;

  IF p_bundle_id IS NOT NULL THEN
    -- Ambil stok lama
    SELECT current_stock INTO v_old_stock FROM public.bundle_items WHERE id = p_bundle_id;

    -- Update racikan yang sudah ada
    UPDATE public.bundle_items
    SET
      bundle_name   = TRIM(p_bundle_name),
      unit          = v_clean_unit,
      output_qty    = GREATEST(COALESCE(p_output_qty, 1), 0.01),
      description   = TRIM(p_description),
      current_stock = COALESCE(p_current_stock, current_stock),
      is_active     = true
    WHERE id = p_bundle_id
    RETURNING id INTO v_bundle_id;

    -- Jika stok fisik diubah langsung melalui modal edit, catat ke stock_logs
    IF p_current_stock IS NOT NULL AND v_old_stock IS DISTINCT FROM p_current_stock THEN
      INSERT INTO public.stock_logs (
        branch_id, item_id, bundle_id, log_type, quantity, balance_after,
        reference_id, created_by, note
      ) VALUES (
        v_branch_id,
        NULL,
        v_bundle_id,
        CASE WHEN p_current_stock >= COALESCE(v_old_stock, 0) THEN 'in'::public.stock_log_type ELSE 'out'::public.stock_log_type END,
        ABS(p_current_stock - COALESCE(v_old_stock, 0)),
        p_current_stock,
        v_bundle_id,
        v_profile_id,
        'Koreksi stok fisik via edit racikan: dari ' || COALESCE(v_old_stock, 0) || ' ke ' || p_current_stock || ' ' || v_clean_unit
      );
    END IF;

  ELSE
    -- Upsert by (bundle_name, branch_id)
    INSERT INTO public.bundle_items (
      branch_id, bundle_name, unit, output_qty, current_stock, description, is_active
    )
    VALUES (
      v_branch_id,
      TRIM(p_bundle_name),
      v_clean_unit,
      GREATEST(COALESCE(p_output_qty, 1), 0.01),
      COALESCE(p_current_stock, 0),
      TRIM(p_description),
      true
    )
    ON CONFLICT (bundle_name, branch_id)
    DO UPDATE SET
      unit          = EXCLUDED.unit,
      output_qty    = EXCLUDED.output_qty,
      current_stock = CASE WHEN p_current_stock IS NOT NULL THEN EXCLUDED.current_stock ELSE bundle_items.current_stock END,
      description   = EXCLUDED.description,
      is_active     = true
    RETURNING id INTO v_bundle_id;
  END IF;

  -- Hapus komponen lama lalu insert komponen baru memakai jsonb_to_recordset
  -- AMAN & TYPE-SAFE: Menghindari error 'operator does not exist: record ->> unknown'
  DELETE FROM public.bundle_components WHERE bundle_id = v_bundle_id;

  INSERT INTO public.bundle_components (bundle_id, item_id, quantity)
  SELECT
    v_bundle_id,
    x.item_id,
    x.quantity
  FROM jsonb_to_recordset(p_components) AS x(item_id uuid, quantity numeric);

  RETURN v_bundle_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_bundle_definition TO authenticated;

-- 2. Tambah RPC: opname_bundle_batch (Opname Global Seluruh Racikan Sekaligus)
CREATE OR REPLACE FUNCTION public.opname_bundle_batch(
  p_items jsonb, -- array of { bundle_id: uuid, physical_qty: numeric, note?: text }
  p_general_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_role          text;
  v_profile_id    uuid;
  v_row           record;
  v_bundle        record;
  v_diff          numeric;
  v_updated_count integer := 0;
BEGIN
  v_profile_id := public.current_profile_id();
  SELECT role INTO v_role FROM public.profiles WHERE id = v_profile_id;
  IF v_role NOT IN ('owner', 'maintainer', 'maintener', 'manager', 'finance', 'kepala_mekanik', 'kepala_karyawan') THEN
    RAISE EXCEPTION 'Hanya manager, finance, maintainer, atau owner yang dapat melakukan opname racikan.';
  END IF;

  FOR v_row IN
    SELECT x.bundle_id, x.physical_qty, x.note
    FROM jsonb_to_recordset(p_items) AS x(bundle_id uuid, physical_qty numeric, note text)
  LOOP
    IF v_row.bundle_id IS NULL OR v_row.physical_qty IS NULL OR v_row.physical_qty < 0 THEN
      CONTINUE;
    END IF;

    SELECT * INTO v_bundle
    FROM public.bundle_items
    WHERE id = v_row.bundle_id AND is_active = true;

    IF NOT FOUND THEN
      CONTINUE;
    END IF;

    v_diff := v_row.physical_qty - COALESCE(v_bundle.current_stock, 0);

    -- Update stok fisik
    UPDATE public.bundle_items
    SET current_stock = v_row.physical_qty
    WHERE id = v_row.bundle_id;

    v_updated_count := v_updated_count + 1;

    -- Catat log opname jika ada selisih
    IF v_diff != 0 THEN
      INSERT INTO public.stock_logs (
        branch_id, item_id, bundle_id, log_type, quantity, balance_after,
        reference_id, created_by, note
      ) VALUES (
        v_bundle.branch_id,
        NULL,
        v_bundle.id,
        CASE WHEN v_diff > 0 THEN 'in'::public.stock_log_type ELSE 'out'::public.stock_log_type END,
        ABS(v_diff),
        v_row.physical_qty,
        v_bundle.id,
        v_profile_id,
        'Opname fisik racikan ' || v_bundle.bundle_name || ': fisik ' || v_row.physical_qty || ' ' || v_bundle.unit ||
          ' (selisih ' || CASE WHEN v_diff > 0 THEN '+' ELSE '' END || v_diff || ' ' || v_bundle.unit || ')' ||
          CASE WHEN v_row.note IS NOT NULL AND v_row.note != '' THEN ' - ' || v_row.note
               WHEN p_general_note IS NOT NULL AND p_general_note != '' THEN ' - ' || p_general_note
               ELSE '' END
      );
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'updated_count', v_updated_count
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.opname_bundle_batch TO authenticated;
