-- 0135_maintainer_system_tools_and_wipe_rpcs.sql
-- RPC functions khusus untuk role maintainer & owner untuk reset/wipe testing data dan benchmark health check.

CREATE OR REPLACE FUNCTION public.check_is_maintainer_or_owner()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_role text;
BEGIN
    SELECT role INTO v_role
    FROM public.profiles
    WHERE auth_id = auth.uid() OR id = auth.uid()
    LIMIT 1;

    IF v_role IS NULL OR v_role NOT IN ('maintainer', 'owner') THEN
        RAISE EXCEPTION 'Akses ditolak: Operasi pembersihan data hanya boleh dijalankan oleh Maintainer atau Owner (Role saat ini: %)', COALESCE(v_role, 'anonymous');
    END IF;
END;
$$;

-- 1. Wipe Stok Data (Bisa pilih: hanya log transaksi & nol-kan saldo, ATAU hapus total master item & racikan)
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

    -- 2. Hapus stock_claims
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
        -- Hapus resep material jasa yang mereferensikan bundle atau inventory
        IF p_branch_id IS NULL THEN
            DELETE FROM public.service_material_recipes;
            DELETE FROM public.bundling_items;
            DELETE FROM public.bundling_packages;
        ELSE
            DELETE FROM public.service_material_recipes 
            WHERE inventory_item_id IN (SELECT id FROM public.inventory_items WHERE branch_id = p_branch_id)
               OR bundle_id IN (SELECT id FROM public.bundle_items WHERE branch_id = p_branch_id);
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

-- 2. Wipe Presensi & Data Harian SDM
CREATE OR REPLACE FUNCTION public.maintainer_wipe_attendance(
    p_branch_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_deleted_attendances int := 0;
    v_deleted_time_off int := 0;
    v_deleted_shifts int := 0;
    v_deleted_handoffs int := 0;
    v_deleted_oil int := 0;
    v_target_profile_ids uuid[];
BEGIN
    PERFORM public.check_is_maintainer_or_owner();

    IF p_branch_id IS NOT NULL THEN
        SELECT array_agg(id) INTO v_target_profile_ids FROM public.profiles WHERE branch_id = p_branch_id;
    END IF;

    IF p_branch_id IS NULL THEN
        WITH d1 AS (DELETE FROM public.attendance_logs RETURNING id) SELECT count(*) INTO v_deleted_attendances FROM d1;
        WITH d2 AS (DELETE FROM public.time_off_requests RETURNING id) SELECT count(*) INTO v_deleted_time_off FROM d2;
        WITH d3 AS (DELETE FROM public.shift_handoffs RETURNING id) SELECT count(*) INTO v_deleted_handoffs FROM d3;
        WITH d4 AS (DELETE FROM public.shifts RETURNING id) SELECT count(*) INTO v_deleted_shifts FROM d4;
        WITH d5 AS (DELETE FROM public.off_in_lieu_logs RETURNING id) SELECT count(*) INTO v_deleted_oil FROM d5;
    ELSE
        IF v_target_profile_ids IS NOT NULL AND array_length(v_target_profile_ids, 1) > 0 THEN
            WITH d1 AS (DELETE FROM public.attendance_logs WHERE profile_id = ANY(v_target_profile_ids) RETURNING id)
            SELECT count(*) INTO v_deleted_attendances FROM d1;

            WITH d2 AS (DELETE FROM public.time_off_requests WHERE profile_id = ANY(v_target_profile_ids) RETURNING id)
            SELECT count(*) INTO v_deleted_time_off FROM d2;

            WITH d5 AS (DELETE FROM public.off_in_lieu_logs WHERE profile_id = ANY(v_target_profile_ids) RETURNING id)
            SELECT count(*) INTO v_deleted_oil FROM d5;
        END IF;

        WITH d3 AS (DELETE FROM public.shift_handoffs WHERE branch_id = p_branch_id RETURNING id)
        SELECT count(*) INTO v_deleted_handoffs FROM d3;

        WITH d4 AS (DELETE FROM public.shifts WHERE branch_id = p_branch_id RETURNING id)
        SELECT count(*) INTO v_deleted_shifts FROM d4;
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'deleted_attendances', v_deleted_attendances,
        'deleted_time_off', v_deleted_time_off,
        'deleted_shifts', v_deleted_shifts,
        'deleted_shift_handoffs', v_deleted_handoffs,
        'deleted_off_in_lieu_logs', v_deleted_oil
    );
END;
$$;

-- 3. Wipe Transaksi Order POS & Garansi
CREATE OR REPLACE FUNCTION public.maintainer_wipe_orders(
    p_branch_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_order_ids uuid[];
    v_deleted_orders int := 0;
    v_deleted_items int := 0;
    v_deleted_payments int := 0;
    v_deleted_team int := 0;
    v_deleted_inspections int := 0;
    v_deleted_warranties int := 0;
    v_deleted_claims int := 0;
    v_deleted_invoices int := 0;
BEGIN
    PERFORM public.check_is_maintainer_or_owner();

    IF p_branch_id IS NULL THEN
        SELECT array_agg(id) INTO v_order_ids FROM public.orders;
    ELSE
        SELECT array_agg(id) INTO v_order_ids FROM public.orders WHERE branch_id = p_branch_id;
    END IF;

    IF v_order_ids IS NOT NULL AND array_length(v_order_ids, 1) > 0 THEN
        -- Hapus klaim garansi & garansi
        WITH d1 AS (DELETE FROM public.warranty_claims WHERE order_id = ANY(v_order_ids) RETURNING id)
        SELECT count(*) INTO v_deleted_claims FROM d1;

        WITH d2 AS (DELETE FROM public.warranties WHERE order_id = ANY(v_order_ids) RETURNING id)
        SELECT count(*) INTO v_deleted_warranties FROM d2;

        -- Hapus payments
        WITH d3 AS (DELETE FROM public.order_payments WHERE order_id = ANY(v_order_ids) RETURNING id)
        SELECT count(*) INTO v_deleted_payments FROM d3;

        -- Hapus pembagian tim order
        WITH d4 AS (DELETE FROM public.order_team_members WHERE order_id = ANY(v_order_ids) RETURNING id)
        SELECT count(*) INTO v_deleted_team FROM d4;

        -- Hapus inspeksi foto
        WITH d5 AS (DELETE FROM public.order_inspections WHERE order_id = ANY(v_order_ids) RETURNING id)
        SELECT count(*) INTO v_deleted_inspections FROM d5;

        -- Hapus detail items
        WITH d6 AS (DELETE FROM public.order_items WHERE order_id = ANY(v_order_ids) RETURNING id)
        SELECT count(*) INTO v_deleted_items FROM d6;

        -- Hapus invoices
        WITH d7 AS (DELETE FROM public.invoices WHERE order_id = ANY(v_order_ids) RETURNING id)
        SELECT count(*) INTO v_deleted_invoices FROM d7;

        -- Terakhir hapus master orders
        WITH d8 AS (DELETE FROM public.orders WHERE id = ANY(v_order_ids) RETURNING id)
        SELECT count(*) INTO v_deleted_orders FROM d8;
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'deleted_orders', v_deleted_orders,
        'deleted_order_items', v_deleted_items,
        'deleted_payments', v_deleted_payments,
        'deleted_team_members', v_deleted_team,
        'deleted_inspections', v_deleted_inspections,
        'deleted_warranties', v_deleted_warranties,
        'deleted_warranty_claims', v_deleted_claims,
        'deleted_invoices', v_deleted_invoices
    );
END;
$$;

-- 4. Wipe Finansial & Kas
CREATE OR REPLACE FUNCTION public.maintainer_wipe_finance(
    p_branch_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_deleted_cashflow int := 0;
    v_deleted_petty int := 0;
BEGIN
    PERFORM public.check_is_maintainer_or_owner();

    IF p_branch_id IS NULL THEN
        WITH d1 AS (DELETE FROM public.cash_flow RETURNING id) SELECT count(*) INTO v_deleted_cashflow FROM d1;
        WITH d2 AS (DELETE FROM public.petty_cash RETURNING id) SELECT count(*) INTO v_deleted_petty FROM d2;
    ELSE
        WITH d1 AS (DELETE FROM public.cash_flow WHERE branch_id = p_branch_id RETURNING id) SELECT count(*) INTO v_deleted_cashflow FROM d1;
        WITH d2 AS (DELETE FROM public.petty_cash WHERE branch_id = p_branch_id RETURNING id) SELECT count(*) INTO v_deleted_petty FROM d2;
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'deleted_cash_flow', v_deleted_cashflow,
        'deleted_petty_cash', v_deleted_petty
    );
END;
$$;

-- 5. Wipe Logs & Notifications
CREATE OR REPLACE FUNCTION public.maintainer_wipe_logs(
    p_branch_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_deleted_logs int := 0;
    v_deleted_notifs int := 0;
BEGIN
    PERFORM public.check_is_maintainer_or_owner();

    -- Hapus notifikasi & activity logs
    WITH d1 AS (DELETE FROM public.activity_logs RETURNING id) SELECT count(*) INTO v_deleted_logs FROM d1;
    WITH d2 AS (DELETE FROM public.notifications RETURNING id) SELECT count(*) INTO v_deleted_notifs FROM d2;

    RETURN jsonb_build_object(
        'success', true,
        'deleted_activity_logs', v_deleted_logs,
        'deleted_notifications', v_deleted_notifs
    );
END;
$$;

-- 6. MASTER RESET: Delete Semua Data Operasional Testing Kecuali Akun & Role
CREATE OR REPLACE FUNCTION public.maintainer_master_wipe(
    p_branch_id uuid DEFAULT NULL,
    p_delete_inventory_items boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_orders_res jsonb;
    v_finance_res jsonb;
    v_attendance_res jsonb;
    v_stock_res jsonb;
    v_logs_res jsonb;
BEGIN
    PERFORM public.check_is_maintainer_or_owner();

    -- Jalankan berurutan
    v_orders_res := public.maintainer_wipe_orders(p_branch_id);
    v_finance_res := public.maintainer_wipe_finance(p_branch_id);
    v_attendance_res := public.maintainer_wipe_attendance(p_branch_id);
    v_stock_res := public.maintainer_wipe_stock(p_branch_id, p_delete_inventory_items);
    v_logs_res := public.maintainer_wipe_logs(p_branch_id);

    RETURN jsonb_build_object(
        'success', true,
        'scope', CASE WHEN p_branch_id IS NULL THEN 'all_branches' ELSE p_branch_id::text END,
        'orders', v_orders_res,
        'finance', v_finance_res,
        'attendance', v_attendance_res,
        'stock', v_stock_res,
        'logs', v_logs_res,
        'preserved_tables', jsonb_build_array('profiles', 'branches', 'workshop_settings', 'app_settings', 'commission_settings', 'services')
    );
END;
$$;

-- 7. Benchmark / Speed & Health Check Database Diagnostic
CREATE OR REPLACE FUNCTION public.maintainer_ping_system(
    p_branch_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_t_start timestamptz;
    v_t_end timestamptz;
    v_query_duration_ms numeric;
    v_items_count int := 0;
    v_bundles_count int := 0;
    v_orders_count int := 0;
    v_attendances_count int := 0;
    v_cashflow_count int := 0;
    v_active_employees int := 0;
BEGIN
    PERFORM public.check_is_maintainer_or_owner();

    v_t_start := clock_timestamp();

    -- Ambil hitungan cepat untuk testing load
    IF p_branch_id IS NULL THEN
        SELECT count(*) INTO v_items_count FROM public.inventory_items;
        SELECT count(*) INTO v_bundles_count FROM public.bundle_items;
        SELECT count(*) INTO v_orders_count FROM public.orders;
        SELECT count(*) INTO v_attendances_count FROM public.attendance_logs;
        SELECT count(*) INTO v_cashflow_count FROM public.cash_flow;
        SELECT count(*) INTO v_active_employees FROM public.profiles;
    ELSE
        SELECT count(*) INTO v_items_count FROM public.inventory_items WHERE branch_id = p_branch_id;
        SELECT count(*) INTO v_bundles_count FROM public.bundle_items WHERE branch_id = p_branch_id;
        SELECT count(*) INTO v_orders_count FROM public.orders WHERE branch_id = p_branch_id;
        SELECT count(*) INTO v_attendances_count FROM public.attendance_logs WHERE profile_id IN (SELECT id FROM public.profiles WHERE branch_id = p_branch_id);
        SELECT count(*) INTO v_cashflow_count FROM public.cash_flow WHERE branch_id = p_branch_id;
        SELECT count(*) INTO v_active_employees FROM public.profiles WHERE branch_id = p_branch_id;
    END IF;

    v_t_end := clock_timestamp();
    v_query_duration_ms := round((EXTRACT(EPOCH FROM (v_t_end - v_t_start)) * 1000)::numeric, 2);

    RETURN jsonb_build_object(
        'status', 'healthy',
        'server_timestamp', now(),
        'db_query_duration_ms', v_query_duration_ms,
        'counts', jsonb_build_object(
            'inventory_items', v_items_count,
            'bundle_items', v_bundles_count,
            'orders', v_orders_count,
            'attendances', v_attendances_count,
            'cash_flow', v_cashflow_count,
            'profiles', v_active_employees
        )
    );
END;
$$;
