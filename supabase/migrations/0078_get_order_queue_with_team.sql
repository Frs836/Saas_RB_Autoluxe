-- RPC: get_order_queue_with_team
-- Single query to fetch orders with team members (fix N+1)
-- Returns: order fields + team array (id, full_name, is_lead)
-- Usage: SELECT * FROM get_order_queue_with_team(p_branch_id := 'uuid', p_limit := 300, p_status_filter := 'all')

CREATE OR REPLACE FUNCTION public.get_order_queue_with_team(
    p_branch_id uuid DEFAULT NULL,
    p_limit int DEFAULT 300,
    p_status_filter text DEFAULT 'all'  -- 'all', 'queued', 'in_progress', 'qc_review', 'selesai', 'cancelled'
)
RETURNS TABLE (
    id uuid,
    order_number text,
    license_plate text,
    vehicle_model text,
    vehicle_size text,
    customer_name text,
    customer_phone text,
    service_package text,
    status text,
    total_price numeric,
    payment_method text,
    payment_state text,
    created_at timestamptz,
    completed_at timestamptz,
    assigned_to uuid,
    cancellation_reason text,
    branch_id uuid,
    team jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_status_filter text[] := ARRAY['queued','in_progress','qc_review','completed','menunggu_diambil','diserahkan'];
BEGIN
    -- Parse status filter
    IF p_status_filter = 'all' THEN
        v_status_filter := ARRAY['queued','in_progress','qc_review','completed','menunggu_diambil','diserahkan'];
    ELSIF p_status_filter = 'selesai' THEN
        v_status_filter := ARRAY['completed','menunggu_diambil','diserahkan'];
    ELSE
        v_status_filter := ARRAY[p_status_filter];
    END IF;

    RETURN QUERY
    SELECT
        o.id,
        o.order_number,
        o.license_plate,
        o.vehicle_model,
        o.vehicle_size,
        o.customer_name,
        o.customer_phone,
        o.service_package,
        o.status,
        o.total_price,
        o.payment_method,
        o.payment_state,
        o.created_at,
        o.completed_at,
        o.assigned_to,
        o.cancellation_reason,
        o.branch_id,
        COALESCE(
            (
                SELECT jsonb_agg(
                    jsonb_build_object(
                        'id', tm.profile_id,
                        'full_name', p.full_name,
                        'is_lead', tm.is_lead
                    )
                    ORDER BY tm.is_lead DESC, p.full_name
                )
                FROM public.order_team_members tm
                JOIN public.profiles p ON p.id = tm.profile_id
                WHERE tm.order_id = o.id
            ),
            '[]'::jsonb
        ) AS team
    FROM public.orders o
    WHERE (p_branch_id IS NULL OR o.branch_id = p_branch_id)
      AND o.status = ANY(v_status_filter)
      AND o.status <> 'cancelled'  -- cancelled handled separately if needed
    ORDER BY o.created_at DESC
    LIMIT p_limit;
END;
$$;

-- Grant execute to authenticated
GRANT EXECUTE ON FUNCTION public.get_order_queue_with_team(uuid, int, text) TO authenticated;

-- Comment
COMMENT ON FUNCTION public.get_order_queue_with_team(uuid, int, text) IS 'Fetch orders with team members in single query. Fixes N+1 in OrderQueue page. Returns team as jsonb array of {id, full_name, is_lead}.';