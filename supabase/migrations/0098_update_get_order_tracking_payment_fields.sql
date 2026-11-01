CREATE OR REPLACE FUNCTION public.get_order_tracking(p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_order public.orders%rowtype;
  v_result jsonb;
BEGIN
  IF NULLIF(btrim(coalesce(p_token, '')), '') IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_order
    FROM public.orders o
   WHERE o.tracking_token = p_token;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  v_result := jsonb_build_object(
    'order', jsonb_build_object(
      'order_number',        v_order.order_number,
      'status',              v_order.status,
      'payment_state',       v_order.payment_state,
      'paid_amount',         v_order.paid_amount,
      'total_price',         v_order.total_price,
      'customer_name',       v_order.customer_name,
      'license_plate',       v_order.license_plate,
      'vehicle_model',       v_order.vehicle_model,
      'vehicle_size',        v_order.vehicle_size,
      'service_package',     v_order.service_package,
      'created_at',          v_order.created_at,
      'updated_at',          v_order.updated_at,
      'completed_at',        v_order.completed_at,
      'cancellation_reason', v_order.cancellation_reason
    ),
    'inspections', COALESCE((
      SELECT jsonb_agg(
               jsonb_build_object(
                 'phase',      i.phase,
                 'photo_url',  i.photo_url,
                 'notes',      i.notes,
                 'created_at', i.created_at
               )
               ORDER BY i.created_at
             )
        FROM public.order_inspections i
       WHERE i.order_id = v_order.id
    ), '[]'::jsonb),
    'warranty', (
      SELECT jsonb_build_object(
               'warranty_code', w.warranty_code,
               'start_date',    w.start_date,
               'end_date',      w.end_date,
               'status',        w.status
             )
        FROM public.warranties w
       WHERE w.order_id = v_order.id
       ORDER BY w.created_at DESC
       LIMIT 1
    ),
    'claims', COALESCE((
      SELECT jsonb_agg(
               jsonb_build_object(
                 'claim_date',           c.claim_date,
                 'problem_description',  c.problem_description,
                 'status',               c.status,
                 'resolution_note',      c.resolution_note,
                 'proof_photo_url',      c.proof_photo_url
               )
               ORDER BY c.claim_date
             )
        FROM public.warranty_claims c
       WHERE c.order_id = v_order.id
    ), '[]'::jsonb)
  );

  RETURN v_result;
END;
$function$;
