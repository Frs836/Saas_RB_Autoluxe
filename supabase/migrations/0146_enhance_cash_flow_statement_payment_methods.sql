-- ============================================================
-- 0146_enhance_cash_flow_statement_payment_methods.sql
-- 1. Menyempurnakan RPC get_cash_flow_statement:
--    - Selalu mengembalikan ketiga metode pembayaran (cash, qris, bank_transfer) lengkap dengan jumlah transaksi (count_in, count_out).
--    - Memperkaya deskripsi transaksi pos_order dengan nomor order, plat nomor kendaraan, dan paket layanan.
--    - Mengurutkan riwayat transaksi secara presisi berdasarkan created_at DESC.
-- ============================================================

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

  IF v_role NOT IN ('owner','maintainer','maintener','manager','finance','admin_kasir') THEN
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
        COALESCE(
          cf.description,
          CASE 
            WHEN o.order_number IS NOT NULL THEN 'Order #' || o.order_number || COALESCE(' (' || o.license_plate || ')', '') || COALESCE(' - ' || o.service_package, '')
            ELSE NULL 
          END,
          cf.category
        ) AS description,
        COALESCE(cf.payment_method::text, 'cash') AS payment_method,
        cf.created_at::date AS txn_date,
        cf.created_at,
        cf.order_id
      FROM public.cash_flow cf
      LEFT JOIN public.orders o ON o.id = cf.order_id
      WHERE (p_branch_id IS NULL OR cf.branch_id = p_branch_id)
        AND (p_from IS NULL OR cf.created_at::date >= p_from)
        AND (p_to   IS NULL OR cf.created_at::date <= p_to)
    ),
    -- Masuk: pembayaran order & pemasukan lain
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
    -- Detail per metode pembayaran (selalu sertakan cash, qris, bank_transfer)
    methods_list AS (
      SELECT 'cash' AS method UNION ALL SELECT 'qris' UNION ALL SELECT 'bank_transfer'
    ),
    by_method AS (
      SELECT
        m.method,
        COALESCE(SUM(CASE WHEN t.type='in' THEN t.amount ELSE 0 END), 0) AS masuk,
        COALESCE(SUM(CASE WHEN t.type='out' THEN t.amount ELSE 0 END), 0) AS keluar,
        COALESCE(COUNT(CASE WHEN t.type='in' THEN 1 END), 0) AS count_in,
        COALESCE(COUNT(CASE WHEN t.type='out' THEN 1 END), 0) AS count_out
      FROM methods_list m
      LEFT JOIN txn t ON t.payment_method = m.method
      GROUP BY m.method
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
          'id', t.id, 
          'date', t.txn_date,
          'created_at', t.created_at,
          'type', t.type,
          'amount', t.amount, 
          'category', t.category,
          'description', t.description, 
          'payment_method', t.payment_method,
          'order_id', t.order_id
        ) ORDER BY t.created_at DESC, t.id
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
                       'method', m.method,
                       'masuk',  m.masuk,
                       'keluar', m.keluar,
                       'count_in', m.count_in,
                       'count_out', m.count_out
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
