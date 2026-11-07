-- 0108: RPC get_audit_trail — ambil activity_logs dengan join ke profiles
-- Dipakai oleh halaman /laporan/aktivitas (owner, maintainer, finance, manager).

CREATE OR REPLACE FUNCTION public.get_audit_trail(
  p_branch_id   uuid    DEFAULT NULL,
  p_category    text    DEFAULT 'all',  -- 'all','order','payment','staff','time_off','stock','system'
  p_from        date    DEFAULT NULL,
  p_to          date    DEFAULT NULL,
  p_limit       int     DEFAULT 50,
  p_offset      int     DEFAULT 0
)
RETURNS TABLE (
  id            uuid,
  created_at    timestamptz,
  action        text,
  category      text,
  actor_id      uuid,
  actor_name    text,
  actor_role    text,
  entity        text,
  entity_id     uuid,
  metadata      jsonb,
  -- Derived readable fields
  label         text,   -- human-readable action label
  order_number  text,   -- kalau entity adalah order
  target_name   text    -- nama target (staf yang diubah, dsb)
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_role text;
BEGIN
  -- Hanya manajerial
  v_caller_role := (SELECT p.role::text FROM public.profiles p WHERE p.id = (SELECT public.current_profile_id()));
  IF v_caller_role NOT IN ('owner','maintainer','manager','finance') THEN
    RAISE EXCEPTION 'Akses audit trail hanya untuk owner, maintainer, manager, atau finance.';
  END IF;

  RETURN QUERY
  SELECT
    al.id,
    al.created_at,
    al.action,
    -- Kategori
    CASE
      WHEN al.action LIKE 'order.%'     THEN 'order'
      WHEN al.action = 'payment_recorded' THEN 'payment'
      WHEN al.action LIKE 'staff.%'     THEN 'staff'
      WHEN al.action LIKE 'time_off.%'  THEN 'time_off'
      WHEN al.action LIKE 'stock.%'     THEN 'stock'
      WHEN al.action LIKE 'attendance.%'THEN 'attendance'
      WHEN al.action LIKE 'branch.%'    THEN 'system'
      WHEN al.action LIKE 'profile.%'   THEN 'system'
      ELSE 'system'
    END::text AS category,
    al.actor_id,
    COALESCE(actor.full_name, 'Sistem')::text AS actor_name,
    COALESCE(actor.role::text, '-')           AS actor_role,
    al.entity,
    al.entity_id,
    al.metadata,
    -- Label bahasa Indonesia
    CASE al.action
      WHEN 'order.create'              THEN 'Order dibuat'
      WHEN 'order.completed'           THEN 'Order diselesaikan'
      WHEN 'order.cancelled'           THEN 'Order dibatalkan'
      WHEN 'order.qc_revision'         THEN 'QC gagal — dikembalikan ke teknisi'
      WHEN 'order.status.in_progress'  THEN 'Pengerjaan dimulai'
      WHEN 'order.status.qc_review'    THEN 'Diajukan ke QC'
      WHEN 'order.status.completed'    THEN 'QC disetujui / order selesai'
      WHEN 'order.status.menunggu_diambil' THEN 'Ditandai siap diambil'
      WHEN 'order.status.diserahkan'   THEN 'Kendaraan diserahkan ke pelanggan'
      WHEN 'order.status.menunggu_pembayaran' THEN 'Menunggu pembayaran'
      WHEN 'payment_recorded'          THEN 'Pembayaran dicatat'
      WHEN 'staff.create'              THEN 'Akun staf dibuat'
      WHEN 'staff.update'              THEN 'Profil staf diubah'
      WHEN 'staff.delete'              THEN 'Akun staf dihapus'
      WHEN 'time_off.approved'         THEN 'Izin/cuti disetujui'
      WHEN 'time_off.rejected'         THEN 'Izin/cuti ditolak'
      WHEN 'stock.claim_confirmed'     THEN 'Klaim stok dikonfirmasi'
      WHEN 'stock.claim_rejected'      THEN 'Klaim stok ditolak'
      WHEN 'stock.opname.submitted'    THEN 'Opname stok diserahkan'
      WHEN 'attendance.check_in'       THEN 'Absen masuk'
      WHEN 'attendance.check_out'      THEN 'Absen keluar'
      WHEN 'branch.settings.update'    THEN 'Pengaturan cabang diubah'
      WHEN 'branch.created'            THEN 'Cabang baru dibuat'
      ELSE al.action
    END::text AS label,
    -- Order number jika ada
    (al.metadata->>'order_number')::text AS order_number,
    -- Target name (deleted_name untuk staff.delete, dll)
    COALESCE(
      al.metadata->>'deleted_name',
      al.metadata->>'full_name',
      al.metadata->>'target_name'
    )::text AS target_name

  FROM public.activity_logs al
  LEFT JOIN public.profiles actor ON actor.id = al.actor_id

  WHERE
    -- Filter kategori
    (p_category = 'all' OR
      CASE
        WHEN al.action LIKE 'order.%'     THEN 'order'
        WHEN al.action = 'payment_recorded' THEN 'payment'
        WHEN al.action LIKE 'staff.%'     THEN 'staff'
        WHEN al.action LIKE 'time_off.%'  THEN 'time_off'
        WHEN al.action LIKE 'stock.%'     THEN 'stock'
        WHEN al.action LIKE 'attendance.%'THEN 'attendance'
        ELSE 'system'
      END = p_category
    )
    -- Filter cabang via actor branch_id
    AND (p_branch_id IS NULL OR actor.branch_id = p_branch_id)
    -- Filter tanggal
    AND (p_from IS NULL OR al.created_at::date >= p_from)
    AND (p_to   IS NULL OR al.created_at::date <= p_to)

  ORDER BY al.created_at DESC
  LIMIT p_limit
  OFFSET p_offset;
END;
$$;

REVOKE ALL ON FUNCTION public.get_audit_trail(uuid, text, date, date, int, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_audit_trail(uuid, text, date, date, int, int) TO authenticated;

COMMENT ON FUNCTION public.get_audit_trail IS
  '0108: Audit trail untuk laporan aktivitas. Hanya manajerial.';
