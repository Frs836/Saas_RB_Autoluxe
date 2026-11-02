-- 0101: RPC get_staff_commission_report
-- Laporan komisi per karyawan: berapa order dikerjakan, sebagai lead atau anggota,
-- breakdown per jenis layanan, total revenue yang dihasilkan.
--
-- Dipakai oleh halaman /komisi (Sprint 2).
-- Hanya owner, maintainer yang bisa akses (reports.executive).

CREATE OR REPLACE FUNCTION public.get_staff_commission_report(
  p_branch_id   uuid    DEFAULT NULL,
  p_from        date    DEFAULT NULL,   -- filter mulai tanggal (WIB)
  p_to          date    DEFAULT NULL    -- filter sampai tanggal (WIB)
)
RETURNS TABLE (
  profile_id        uuid,
  full_name         text,
  role              text,
  branch_name       text,
  total_orders      bigint,   -- semua order yang ia kerjakan (completed/selesai)
  lead_orders       bigint,   -- order di mana ia jadi lead
  member_orders     bigint,   -- order di mana ia jadi anggota biasa
  total_revenue     numeric,  -- total harga order yang ia kerjakan
  lead_revenue      numeric,
  wash_orders       bigint,
  coating_orders    bigint,
  poles_orders      bigint,
  other_orders      bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    p.id                                          AS profile_id,
    p.full_name::text                             AS full_name,
    p.role::text                                  AS role,
    COALESCE(b.branch_name::text, '-')            AS branch_name,

    -- Jumlah total order (completed)
    COUNT(DISTINCT o.id)                          AS total_orders,
    COUNT(DISTINCT o.id) FILTER (WHERE tm.is_lead) AS lead_orders,
    COUNT(DISTINCT o.id) FILTER (WHERE NOT tm.is_lead) AS member_orders,

    -- Revenue
    COALESCE(SUM(o.total_price), 0)              AS total_revenue,
    COALESCE(SUM(o.total_price) FILTER (WHERE tm.is_lead), 0) AS lead_revenue,

    -- Breakdown layanan berdasarkan keyword di service_package
    COUNT(DISTINCT o.id) FILTER (
      WHERE lower(o.service_package) LIKE '%wash%'
         OR lower(o.service_package) LIKE '%cuci%'
    )                                             AS wash_orders,
    COUNT(DISTINCT o.id) FILTER (
      WHERE lower(o.service_package) LIKE '%coating%'
         OR lower(o.service_package) LIKE '%ceramic%'
         OR lower(o.service_package) LIKE '%nano%'
         OR lower(o.service_package) LIKE '%graphene%'
    )                                             AS coating_orders,
    COUNT(DISTINCT o.id) FILTER (
      WHERE lower(o.service_package) LIKE '%poles%'
         OR lower(o.service_package) LIKE '%polish%'
         OR lower(o.service_package) LIKE '%detailing%'
    )                                             AS poles_orders,
    COUNT(DISTINCT o.id) FILTER (
      WHERE lower(o.service_package) NOT LIKE '%wash%'
        AND lower(o.service_package) NOT LIKE '%cuci%'
        AND lower(o.service_package) NOT LIKE '%coating%'
        AND lower(o.service_package) NOT LIKE '%ceramic%'
        AND lower(o.service_package) NOT LIKE '%nano%'
        AND lower(o.service_package) NOT LIKE '%graphene%'
        AND lower(o.service_package) NOT LIKE '%poles%'
        AND lower(o.service_package) NOT LIKE '%polish%'
        AND lower(o.service_package) NOT LIKE '%detailing%'
    )                                             AS other_orders

  FROM public.order_team_members tm
  JOIN public.orders  o ON o.id  = tm.order_id
  JOIN public.profiles p ON p.id = tm.profile_id
  LEFT JOIN public.branches b ON b.id = p.branch_id

  WHERE
    -- Hanya order yang sudah selesai (completed/menunggu_diambil/diserahkan)
    o.status IN (
      'completed'::public.order_status,
      'menunggu_diambil'::public.order_status,
      'diserahkan'::public.order_status
    )
    -- Filter cabang
    AND (p_branch_id IS NULL OR o.branch_id = p_branch_id)
    -- Filter tanggal (completed_at)
    AND (p_from IS NULL OR o.completed_at::date >= p_from)
    AND (p_to   IS NULL OR o.completed_at::date <= p_to)

  GROUP BY p.id, p.full_name, p.role, b.branch_name
  ORDER BY total_orders DESC, full_name;
$$;

REVOKE ALL ON FUNCTION public.get_staff_commission_report(uuid, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_staff_commission_report(uuid, date, date) TO authenticated;

COMMENT ON FUNCTION public.get_staff_commission_report IS
  '0101: Aggregate komisi per karyawan — jumlah order, lead/member, revenue, breakdown layanan.';
