-- 0099: Fix PGRST203 — drop all overloads of get_order_queue_with_team
-- then recreate with single canonical signature.
--
-- Error: "Could not choose the best candidate function" (PGRST203)
-- Cause: Multiple overloads exist in production after migrations 0078 and 0079
-- were both applied. PostgREST cannot pick one when p_branch_id is passed.
--
-- Fix: DROP all variants then CREATE OR REPLACE the single correct version.

-- Drop every overload that may exist (including stale ones from earlier migrations)
DROP FUNCTION IF EXISTS public.get_order_queue_with_team(uuid, int, text);
DROP FUNCTION IF EXISTS public.get_order_queue_with_team(text, int, text);
DROP FUNCTION IF EXISTS public.get_order_queue_with_team(int, text);
DROP FUNCTION IF EXISTS public.get_order_queue_with_team(text, text);
DROP FUNCTION IF EXISTS public.get_order_queue_with_team();
-- Stale overloads found in production (from earlier feature branches):
DROP FUNCTION IF EXISTS public.get_order_queue_with_team(uuid, vehicle_size, integer);
DROP FUNCTION IF EXISTS public.get_order_queue_with_team(uuid, vehicle_size[], text, integer);

CREATE OR REPLACE FUNCTION public.get_order_queue_with_team(
    p_branch_id   uuid    DEFAULT NULL,
    p_limit       int     DEFAULT 300,
    p_status_filter text  DEFAULT 'all'
)
RETURNS TABLE (
    id                  uuid,
    order_number        text,
    license_plate       text,
    vehicle_model       text,
    vehicle_size        text,
    customer_name       text,
    customer_phone      text,
    service_package     text,
    status              text,
    total_price         numeric,
    payment_method      text,
    payment_state       text,
    created_at          timestamptz,
    completed_at        timestamptz,
    assigned_to         uuid,
    cancellation_reason text,
    branch_id           uuid,
    team                jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_status_filter public.order_status[];
BEGIN
    IF p_status_filter = 'all' THEN
        v_status_filter := ARRAY[
            'queued',
            'in_progress',
            'qc_review',
            'completed',
            'menunggu_pembayaran',
            'menunggu_diambil',
            'diserahkan'
        ]::public.order_status[];
    ELSIF p_status_filter = 'selesai' THEN
        v_status_filter := ARRAY[
            'completed',
            'menunggu_pembayaran',
            'menunggu_diambil',
            'diserahkan'
        ]::public.order_status[];
    ELSE
        v_status_filter := ARRAY[p_status_filter]::public.order_status[];
    END IF;

    RETURN QUERY
    SELECT
        o.id,
        o.order_number::text,
        o.license_plate::text,
        o.vehicle_model::text,
        o.vehicle_size::text,
        o.customer_name::text,
        o.customer_phone::text,
        o.service_package::text,
        o.status::text,
        o.total_price,
        o.payment_method::text,
        o.payment_state::text,
        o.created_at,
        o.completed_at,
        o.assigned_to,
        o.cancellation_reason::text,
        o.branch_id,
        COALESCE(
            (
                SELECT jsonb_agg(
                    jsonb_build_object(
                        'id',        tm.profile_id,
                        'full_name', p.full_name,
                        'is_lead',   tm.is_lead
                    )
                    ORDER BY tm.is_lead DESC, p.full_name
                )
                FROM public.order_team_members tm
                JOIN public.profiles          p ON p.id = tm.profile_id
                WHERE tm.order_id = o.id
            ),
            '[]'::jsonb
        ) AS team
    FROM public.orders o
    WHERE (p_branch_id IS NULL OR o.branch_id = p_branch_id)
      AND o.status = ANY(v_status_filter)
    ORDER BY o.created_at DESC
    LIMIT p_limit;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_order_queue_with_team(uuid, int, text) TO authenticated;

COMMENT ON FUNCTION public.get_order_queue_with_team(uuid, int, text) IS
  '0099: Single canonical overload. Includes menunggu_pembayaran in all/selesai filters.';
