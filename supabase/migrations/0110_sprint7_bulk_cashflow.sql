-- 0110: Sprint 7 — RPCs untuk tambah item stok, bulk import, cash flow report

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. RPC: create_inventory_item — buat item stok baru
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.create_inventory_item(
  p_item_name      text,
  p_unit           text,
  p_current_stock  numeric  DEFAULT 0,
  p_min_stock_alert numeric DEFAULT 0,
  p_unit_cost      numeric  DEFAULT NULL,
  p_branch_id      uuid     DEFAULT NULL
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
BEGIN
  v_profile_id := (SELECT public.current_profile_id());
  IF v_profile_id IS NULL THEN RAISE EXCEPTION 'Sesi tidak valid.'; END IF;

  SELECT role::text INTO v_role FROM public.profiles WHERE id = v_profile_id;
  IF v_role NOT IN ('owner','maintainer','manager','kepala_karyawan') THEN
    RAISE EXCEPTION 'Hanya owner, maintainer, manager, atau kepala karyawan yang bisa menambah item stok.';
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

  INSERT INTO public.inventory_items (
    item_name, unit, current_stock, min_stock_alert, unit_cost, branch_id
  ) VALUES (
    btrim(p_item_name), COALESCE(btrim(p_unit),'pcs'),
    GREATEST(0, COALESCE(p_current_stock,0)),
    GREATEST(0, COALESCE(p_min_stock_alert,0)),
    p_unit_cost,
    v_branch_id
  ) RETURNING * INTO v_item;

  INSERT INTO public.activity_logs (actor_id, action, entity, entity_id, metadata)
  VALUES (v_profile_id, 'stock.item_created', 'inventory_items', v_item.id,
    jsonb_build_object('item_name', v_item.item_name, 'unit', v_item.unit,
      'initial_stock', p_current_stock));

  RETURN v_item;
END;
$$;

REVOKE ALL ON FUNCTION public.create_inventory_item(text,text,numeric,numeric,numeric,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.create_inventory_item(text,text,numeric,numeric,numeric,uuid) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. RPC: bulk_import_inventory — import stok dari Excel
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.bulk_import_inventory(
  p_items    jsonb,   -- [{item_name,unit,current_stock,min_stock_alert,unit_cost}]
  p_branch_id uuid DEFAULT NULL
)
RETURNS jsonb   -- {imported: n, skipped: n, errors: [...]}
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
BEGIN
  v_profile_id := (SELECT public.current_profile_id());
  SELECT role::text INTO v_role FROM public.profiles WHERE id = v_profile_id;
  IF v_role NOT IN ('owner','maintainer','manager') THEN
    RAISE EXCEPTION 'Hanya owner, maintainer, atau manager yang bisa bulk import stok.';
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
    BEGIN
      INSERT INTO public.inventory_items (item_name, unit, current_stock, min_stock_alert, unit_cost, branch_id)
      VALUES (
        v_name,
        COALESCE(NULLIF(btrim(v_item->>'unit'),''),'pcs'),
        GREATEST(0, COALESCE((v_item->>'current_stock')::numeric,0)),
        GREATEST(0, COALESCE((v_item->>'min_stock_alert')::numeric,0)),
        NULLIF((v_item->>'unit_cost')::numeric, 0),
        v_branch_id
      )
      ON CONFLICT (item_name, branch_id) DO UPDATE SET
        current_stock    = EXCLUDED.current_stock,
        min_stock_alert  = EXCLUDED.min_stock_alert,
        unit_cost        = COALESCE(EXCLUDED.unit_cost, inventory_items.unit_cost),
        updated_at       = now();
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

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. RPC: bulk_import_cash_flow — import kas historis
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.bulk_import_cash_flow(
  p_rows      jsonb,   -- [{type,amount,category,description,payment_method,created_at}]
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
  v_row        jsonb;
  v_imported   int := 0;
  v_skipped    int := 0;
  v_errors     jsonb := '[]'::jsonb;
BEGIN
  v_profile_id := (SELECT public.current_profile_id());
  SELECT role::text INTO v_role FROM public.profiles WHERE id = v_profile_id;
  IF v_role NOT IN ('owner','maintainer','finance') THEN
    RAISE EXCEPTION 'Hanya owner, maintainer, atau finance yang bisa import kas historis.';
  END IF;
  v_branch_id := COALESCE(p_branch_id,
    (SELECT branch_id FROM public.profiles WHERE id = v_profile_id));

  FOR v_row IN SELECT * FROM jsonb_array_elements(p_rows)
  LOOP
    BEGIN
      INSERT INTO public.cash_flow (
        type, amount, category, description, payment_method, branch_id, created_by,
        created_at
      ) VALUES (
        COALESCE(v_row->>'type','in')::public.cash_flow_type,
        GREATEST(0, (v_row->>'amount')::numeric),
        COALESCE(NULLIF(btrim(v_row->>'category'),''),'Lainnya'),
        NULLIF(btrim(COALESCE(v_row->>'description','')),''),
        COALESCE(v_row->>'payment_method','cash')::public.payment_method,
        v_branch_id,
        v_profile_id,
        COALESCE(NULLIF(v_row->>'created_at','')::timestamptz, now())
      );
      v_imported := v_imported + 1;
    EXCEPTION WHEN OTHERS THEN
      v_errors := v_errors || jsonb_build_object('row', v_row, 'error', SQLERRM);
      v_skipped := v_skipped + 1;
    END;
  END LOOP;

  RETURN jsonb_build_object('imported', v_imported, 'skipped', v_skipped, 'errors', v_errors);
END;
$$;

REVOKE ALL ON FUNCTION public.bulk_import_cash_flow(jsonb,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.bulk_import_cash_flow(jsonb,uuid) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. RPC: get_cash_flow_statement — laporan cash flow per periode
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_cash_flow_statement(
  p_branch_id uuid  DEFAULT NULL,
  p_from      date  DEFAULT NULL,
  p_to        date  DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text;
BEGIN
  v_role := (SELECT p.role::text FROM public.profiles p
    WHERE p.id = (SELECT public.current_profile_id()));

  IF v_role NOT IN ('owner','maintainer','manager','finance','admin_kasir') THEN
    RAISE EXCEPTION 'Akses ditolak.';
  END IF;

  RETURN (
    WITH
    -- Semua transaksi kas dalam periode
    txn AS (
      SELECT
        cf.id,
        cf.type,
        cf.amount,
        cf.category,
        cf.description,
        cf.payment_method,
        cf.created_at::date AS txn_date,
        cf.order_id
      FROM public.cash_flow cf
      WHERE (p_branch_id IS NULL OR cf.branch_id = p_branch_id)
        AND (p_from IS NULL OR cf.created_at::date >= p_from)
        AND (p_to   IS NULL OR cf.created_at::date <= p_to)
    ),
    -- Masuk: pembayaran order
    inflow AS (
      SELECT
        COALESCE(SUM(CASE WHEN category IN ('pos_order','employee_cash_hold_settlement') THEN amount ELSE 0 END),0) AS from_orders,
        COALESCE(SUM(CASE WHEN category NOT IN ('pos_order','employee_cash_hold_settlement') AND type='in' THEN amount ELSE 0 END),0) AS other_in,
        COALESCE(SUM(CASE WHEN type='in' THEN amount ELSE 0 END),0) AS total_in
      FROM txn WHERE type = 'in'
    ),
    -- Keluar: petty cash, operasional
    outflow AS (
      SELECT
        COALESCE(SUM(CASE WHEN category IN ('Perlengkapan Wash','Bahan Detailing') THEN amount ELSE 0 END),0) AS bahan,
        COALESCE(SUM(CASE WHEN category IN ('Konsumsi Staf') THEN amount ELSE 0 END),0) AS konsumsi,
        COALESCE(SUM(CASE WHEN category IN ('Operasional Umum') THEN amount ELSE 0 END),0) AS operasional,
        COALESCE(SUM(CASE WHEN category NOT IN ('Perlengkapan Wash','Bahan Detailing','Konsumsi Staf','Operasional Umum') AND type='out' THEN amount ELSE 0 END),0) AS lainnya,
        COALESCE(SUM(CASE WHEN type='out' THEN amount ELSE 0 END),0) AS total_out
      FROM txn WHERE type = 'out'
    ),
    -- Detail per metode pembayaran
    by_method AS (
      SELECT
        payment_method::text,
        SUM(CASE WHEN type='in' THEN amount ELSE 0 END) AS masuk,
        SUM(CASE WHEN type='out' THEN amount ELSE 0 END) AS keluar
      FROM txn
      GROUP BY payment_method
    ),
    -- Trend harian
    daily AS (
      SELECT
        txn_date,
        SUM(CASE WHEN type='in'  THEN amount ELSE 0 END) AS masuk,
        SUM(CASE WHEN type='out' THEN amount ELSE 0 END) AS keluar,
        SUM(CASE WHEN type='in'  THEN amount ELSE -amount END) AS net
      FROM txn
      GROUP BY txn_date
      ORDER BY txn_date
    ),
    -- Semua transaksi detail
    detail AS (
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', t.id, 'date', t.txn_date, 'type', t.type,
          'amount', t.amount, 'category', t.category,
          'description', t.description, 'payment_method', t.payment_method,
          'order_id', t.order_id
        ) ORDER BY t.txn_date DESC, t.id
      ) AS rows FROM txn t
    )
    SELECT jsonb_build_object(
      'period',      jsonb_build_object('from', p_from, 'to', p_to),
      'inflow',      jsonb_build_object(
                       'from_orders', i.from_orders,
                       'other',       i.other_in,
                       'total',       i.total_in
                     ),
      'outflow',     jsonb_build_object(
                       'bahan',        o.bahan,
                       'konsumsi',     o.konsumsi,
                       'operasional',  o.operasional,
                       'lainnya',      o.lainnya,
                       'total',        o.total_out
                     ),
      'net_cash',    i.total_in - o.total_out,
      'by_method',   COALESCE((SELECT jsonb_agg(jsonb_build_object(
                       'method', m.payment_method,
                       'masuk',  m.masuk, 'keluar', m.keluar
                     )) FROM by_method m), '[]'),
      'daily',       COALESCE((SELECT jsonb_agg(jsonb_build_object(
                       'date', d.txn_date, 'masuk', d.masuk,
                       'keluar', d.keluar, 'net', d.net
                     )) FROM daily d), '[]'),
      'transactions', COALESCE((SELECT d.rows FROM detail d), '[]'),
      'generated_at', now()
    )
    FROM inflow i, outflow o
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_cash_flow_statement(uuid,date,date) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_cash_flow_statement(uuid,date,date) TO authenticated;

COMMENT ON FUNCTION public.get_cash_flow_statement IS
  '0110: Cash flow statement — inflow/outflow/net + detail transaksi + trend harian.';
