-- 0127: RPC get_production_cost_report untuk Laporan Biaya Produksi Finance & Owner
CREATE OR REPLACE FUNCTION public.get_production_cost_report(
  p_branch_id uuid DEFAULT NULL,
  p_from      timestamptz DEFAULT NULL,
  p_to        timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile_id uuid;
  v_role       text;
  v_from       timestamptz;
  v_to         timestamptz;
  v_result     jsonb;
BEGIN
  v_profile_id := (SELECT public.current_profile_id());
  IF v_profile_id IS NOT NULL THEN
    SELECT role::text INTO v_role FROM public.profiles WHERE id = v_profile_id;
    IF v_role NOT IN ('owner','maintainer','manager','finance') THEN
      RAISE EXCEPTION 'Hanya owner, maintainer, manager, atau finance yang bisa melihat laporan biaya produksi.';
    END IF;
  END IF;

  v_from := COALESCE(p_from, date_trunc('month', now()));
  v_to   := COALESCE(p_to, now());

  WITH order_materials AS (
    SELECT
      l.reference_id AS order_id,
      l.branch_id,
      l.created_at AS log_time,
      jsonb_build_object(
        'item_id', l.item_id,
        'item_name', i.item_name,
        'unit', i.unit,
        'quantity', l.quantity,
        'unit_cost', COALESCE(l.unit_cost, i.unit_cost, 0),
        'cost_amount', COALESCE(l.cost_amount, l.quantity * COALESCE(l.unit_cost, i.unit_cost, 0))
      ) AS material_item,
      COALESCE(l.cost_amount, l.quantity * COALESCE(l.unit_cost, i.unit_cost, 0)) AS item_cost,
      l.quantity AS item_qty,
      i.item_name,
      i.unit
    FROM public.stock_logs l
    JOIN public.inventory_items i ON i.id = l.item_id
    WHERE l.log_type = 'out'::public.stock_log_type
      AND l.note LIKE 'auto: pemakaian bahan order%'
      AND (p_branch_id IS NULL OR l.branch_id = p_branch_id)
      AND l.created_at >= v_from
      AND l.created_at <= v_to
  ),
  aggregated_orders AS (
    SELECT
      om.order_id,
      o.order_number,
      o.license_plate,
      o.vehicle_model,
      o.vehicle_size::text AS vehicle_size,
      o.service_package,
      COALESCE(o.total_price, 0) AS total_price,
      o.status::text AS order_status,
      o.completed_at,
      o.created_at AS order_created_at,
      b.branch_name,
      SUM(om.item_cost) AS total_production_cost,
      jsonb_agg(om.material_item) AS materials
    FROM order_materials om
    JOIN public.orders o ON o.id = om.order_id
    LEFT JOIN public.branches b ON b.id = om.branch_id
    GROUP BY
      om.order_id, o.order_number, o.license_plate, o.vehicle_model,
      o.vehicle_size, o.service_package, o.total_price, o.status,
      o.completed_at, o.created_at, b.branch_name
    ORDER BY o.created_at DESC
  ),
  material_totals AS (
    SELECT
      om.item_name,
      om.unit,
      SUM(om.item_qty) AS total_qty,
      SUM(om.item_cost) AS total_cost
    FROM order_materials om
    GROUP BY om.item_name, om.unit
    ORDER BY total_cost DESC
  )
  SELECT jsonb_build_object(
    'summary', jsonb_build_object(
      'total_production_cost', COALESCE((SELECT SUM(total_production_cost) FROM aggregated_orders), 0),
      'total_revenue', COALESCE((SELECT SUM(total_price) FROM aggregated_orders), 0),
      'total_orders', COALESCE((SELECT COUNT(*) FROM aggregated_orders), 0),
      'total_gross_profit', COALESCE((SELECT SUM(total_price - total_production_cost) FROM aggregated_orders), 0)
    ),
    'orders', COALESCE((SELECT jsonb_agg(row_to_json(ao)) FROM aggregated_orders ao), '[]'::jsonb),
    'material_breakdown', COALESCE((SELECT jsonb_agg(row_to_json(mt)) FROM material_totals mt), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_production_cost_report(uuid,timestamptz,timestamptz) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_production_cost_report(uuid,timestamptz,timestamptz) TO authenticated;
