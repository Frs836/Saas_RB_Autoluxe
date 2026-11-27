-- ============================================================
-- 0144_fix_hard_delete_recipes_and_cleanup_old_data.sql
-- 1. Hapus seluruh resep yang menunjuk ke bahan/racikan yang sudah non-aktif atau tidak dipakai
-- 2. Khusus untuk layanan Basic Wash: bersihkan resep lama (Semir ban & Shampoo carwash reguler),
--    sisakan hanya resep racikan aktif (shampoo carwash) yang saat ini dipakai.
-- 3. Bersihkan catatan stock_logs pemakaian dan master racikan lama yang sudah non-aktif (Semir ban, Shampoo carwash lama, Test racikan)
--    sehingga laporan Biaya Produksi (HPP Jasa) benar-benar bersih dan hanya menampilkan bahan aktif.
-- 4. Perbaiki RPC delete_bundle agar melakukan hard delete bersih (komponen, resep, master bundle).
-- 5. Perbaiki RPC maintainer_wipe_stock agar menunjuk kolom item_id & bundle_item_id yang benar.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Pembersihan Resep Lama / Yatim (Cleanup)
-- ------------------------------------------------------------
-- Hapus resep yang merujuk ke bundle_items yang sudah non-aktif (is_active = false)
DELETE FROM public.service_material_recipes
WHERE bundle_item_id IS NOT NULL
  AND bundle_item_id IN (
    SELECT id FROM public.bundle_items WHERE is_active = false
  );

-- Hapus resep bahan gudang reguler lama untuk layanan Basic Wash
DELETE FROM public.service_material_recipes
WHERE service_id IN (SELECT id FROM public.services WHERE lower(name) = 'basic wash')
  AND item_id IS NOT NULL;

-- ------------------------------------------------------------
-- 2. Pembersihan Riwayat & Master Racikan Lama (Hard Delete Data Lama)
-- ------------------------------------------------------------
-- Hapus stock_logs untuk racikan non-aktif (Semir ban, Shampoo carwash lama)
DELETE FROM public.stock_logs
WHERE bundle_id IN (
  SELECT id FROM public.bundle_items WHERE is_active = false
);

-- Hapus relasi lainnya untuk racikan non-aktif
DELETE FROM public.bundle_components
WHERE bundle_id IN (
  SELECT id FROM public.bundle_items WHERE is_active = false
);

DELETE FROM public.stock_claims
WHERE bundle_id IN (
  SELECT id FROM public.bundle_items WHERE is_active = false
);

DELETE FROM public.stock_opname_lines
WHERE bundle_id IN (
  SELECT id FROM public.bundle_items WHERE is_active = false
);

-- Hard delete racikan non-aktif dari bundle_items
DELETE FROM public.bundle_items
WHERE is_active = false;

-- ------------------------------------------------------------
-- 3. Perbaiki RPC delete_bundle (Hard delete menyeluruh saat racikan dihapus)
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

  -- 1. Hapus relasi di resep jasa (service_material_recipes)
  DELETE FROM public.service_material_recipes WHERE bundle_item_id = p_bundle_id;

  -- 2. Hapus relasi komponen bahan baku racikan (bundle_components)
  DELETE FROM public.bundle_components WHERE bundle_id = p_bundle_id;

  -- 3. Hapus relasi opname dan klaim
  DELETE FROM public.stock_claims WHERE bundle_id = p_bundle_id;
  DELETE FROM public.stock_opname_lines WHERE bundle_id = p_bundle_id;
  DELETE FROM public.stock_logs WHERE bundle_id = p_bundle_id;

  -- 4. Hard delete master racikan agar tidak menyisakan data yatim / hantu di backend
  DELETE FROM public.bundle_items WHERE id = p_bundle_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.delete_bundle TO authenticated;

-- ------------------------------------------------------------
-- 4. Perbaiki RPC maintainer_wipe_stock (Perbaiki kolom item_id & bundle_item_id)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.maintainer_wipe_stock(
    p_branch_id uuid DEFAULT NULL,
    p_delete_master boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_deleted_logs int := 0;
    v_deleted_claims int := 0;
    v_deleted_opname_lines int := 0;
    v_deleted_opnames int := 0;
    v_deleted_components int := 0;
    v_deleted_bundles int := 0;
    v_deleted_items int := 0;
    v_target_opname_ids uuid[];
    v_target_bundle_ids uuid[];
BEGIN
    PERFORM public.check_is_maintainer_or_owner();

    -- Kumpulkan ID opname target
    IF p_branch_id IS NULL THEN
        SELECT array_agg(id) INTO v_target_opname_ids FROM public.stock_opnames;
        SELECT array_agg(id) INTO v_target_bundle_ids FROM public.bundle_items;
    ELSE
        SELECT array_agg(id) INTO v_target_opname_ids FROM public.stock_opnames WHERE branch_id = p_branch_id;
        SELECT array_agg(id) INTO v_target_bundle_ids FROM public.bundle_items WHERE branch_id = p_branch_id;
    END IF;

    -- 1. Hapus baris opname & header opname
    IF v_target_opname_ids IS NOT NULL AND array_length(v_target_opname_ids, 1) > 0 THEN
        WITH del_lines AS (
            DELETE FROM public.stock_opname_lines WHERE opname_id = ANY(v_target_opname_ids) RETURNING id
        ) SELECT count(*) INTO v_deleted_opname_lines FROM del_lines;

        WITH del_opnames AS (
            DELETE FROM public.stock_opnames WHERE id = ANY(v_target_opname_ids) RETURNING id
        ) SELECT count(*) INTO v_deleted_opnames FROM del_opnames;
    END IF;

    -- 2. Hapus stock_claims dan stock_logs
    IF p_branch_id IS NULL THEN
        WITH del_claims AS (
            DELETE FROM public.stock_claims RETURNING id
        ) SELECT count(*) INTO v_deleted_claims FROM del_claims;

        WITH del_logs AS (
            DELETE FROM public.stock_logs RETURNING id
        ) SELECT count(*) INTO v_deleted_logs FROM del_logs;
    ELSE
        WITH del_claims AS (
            DELETE FROM public.stock_claims WHERE branch_id = p_branch_id RETURNING id
        ) SELECT count(*) INTO v_deleted_claims FROM del_claims;

        WITH del_logs AS (
            DELETE FROM public.stock_logs WHERE branch_id = p_branch_id RETURNING id
        ) SELECT count(*) INTO v_deleted_logs FROM del_logs;
    END IF;

    -- 3. Jika delete_master = true: hapus resep racikan, master racikan, dan master inventory
    IF p_delete_master THEN
        IF p_branch_id IS NULL THEN
            DELETE FROM public.service_material_recipes;
            DELETE FROM public.bundling_items;
            DELETE FROM public.bundling_packages;
        ELSE
            DELETE FROM public.service_material_recipes 
            WHERE item_id IN (SELECT id FROM public.inventory_items WHERE branch_id = p_branch_id)
               OR bundle_item_id IN (SELECT id FROM public.bundle_items WHERE branch_id = p_branch_id);
        END IF;

        IF v_target_bundle_ids IS NOT NULL AND array_length(v_target_bundle_ids, 1) > 0 THEN
            WITH del_bc AS (
                DELETE FROM public.bundle_components WHERE bundle_id = ANY(v_target_bundle_ids) RETURNING id
            ) SELECT count(*) INTO v_deleted_components FROM del_bc;

            WITH del_bi AS (
                DELETE FROM public.bundle_items WHERE id = ANY(v_target_bundle_ids) RETURNING id
            ) SELECT count(*) INTO v_deleted_bundles FROM del_bi;
        END IF;

        IF p_branch_id IS NULL THEN
            WITH del_inv AS (
                DELETE FROM public.inventory_items RETURNING id
            ) SELECT count(*) INTO v_deleted_items FROM del_inv;
        ELSE
            WITH del_inv AS (
                DELETE FROM public.inventory_items WHERE branch_id = p_branch_id RETURNING id
            ) SELECT count(*) INTO v_deleted_items FROM del_inv;
        END IF;
    ELSE
        -- Hanya nol-kan saldo stok yang ada
        IF p_branch_id IS NULL THEN
            UPDATE public.inventory_items SET current_stock = 0;
            UPDATE public.bundle_items SET current_stock = 0;
        ELSE
            UPDATE public.inventory_items SET current_stock = 0 WHERE branch_id = p_branch_id;
            UPDATE public.bundle_items SET current_stock = 0 WHERE branch_id = p_branch_id;
        END IF;
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'deleted_logs', v_deleted_logs,
        'deleted_claims', v_deleted_claims,
        'deleted_opnames', v_deleted_opnames,
        'deleted_opname_lines', v_deleted_opname_lines,
        'deleted_bundle_components', v_deleted_components,
        'deleted_bundles', v_deleted_bundles,
        'deleted_inventory_items', v_deleted_items,
        'master_deleted', p_delete_master
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.maintainer_wipe_stock TO authenticated;
