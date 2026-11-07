-- 0109: Fix get_audit_trail return type mismatch
-- Error: "structure of query does not match function result type"
-- Cause: RETURNS TABLE columns must match exactly with SELECT output types.
-- Fix: use SETOF to return untyped JSON rows, avoids type mismatch entirely.
-- Alternative fix: drop the old function and recreate with correct types.

DROP FUNCTION IF EXISTS public.get_audit_trail(uuid, text, date, date, int, int);

CREATE OR REPLACE FUNCTION public.get_audit_trail(
  p_branch_id   uuid    DEFAULT NULL,
  p_category    text    DEFAULT 'all',
  p_from        date    DEFAULT NULL,
  p_to          date    DEFAULT NULL,
  p_limit       int     DEFAULT 50,
  p_offset      int     DEFAULT 0
)
RETURNS SETOF json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_role text;
  r             record;
BEGIN
  -- Hanya manajerial
  v_caller_role := (
    SELECT p.role::text
    FROM public.profiles p
    WHERE p.id = (SELECT public.current_profile_id())
  );

  IF v_caller_role NOT IN ('owner','maintainer','manager','finance') THEN
    RAISE EXCEPTION 'Akses audit trail hanya untuk owner, maintainer, manager, atau finance.';
  END IF;

  FOR r IN
    SELECT
      al.id::text,
      al.created_at,
      al.action,
      CASE
        WHEN al.action LIKE 'order.%'        THEN 'order'
        WHEN al.action = 'payment_recorded'  THEN 'payment'
        WHEN al.action LIKE 'staff.%'        THEN 'staff'
        WHEN al.action LIKE 'time_off.%'     THEN 'time_off'
        WHEN al.action LIKE 'stock.%'        THEN 'stock'
        WHEN al.action LIKE 'attendance.%'   THEN 'attendance'
        ELSE 'system'
      END                                   AS category,
      al.actor_id::text,
      COALESCE(actor.full_name, 'Sistem')   AS actor_name,
      COALESCE(actor.role::text, '-')        AS actor_role,
      al.entity,
      al.entity_id::text,
      al.metadata,
      CASE al.action
        WHEN 'order.create'                      THEN 'Order dibuat'
        WHEN 'order.completed'                   THEN 'Order diselesaikan'
        WHEN 'order.cancelled'                   THEN 'Order dibatalkan'
        WHEN 'order.qc_revision'                 THEN 'QC gagal — dikembalikan ke teknisi'
        WHEN 'order.status.in_progress'          THEN 'Pengerjaan dimulai'
        WHEN 'order.status.qc_review'            THEN 'Diajukan ke QC'
        WHEN 'order.status.completed'            THEN 'QC disetujui / order selesai'
        WHEN 'order.status.menunggu_diambil'     THEN 'Ditandai siap diambil'
        WHEN 'order.status.diserahkan'           THEN 'Kendaraan diserahkan ke pelanggan'
        WHEN 'order.status.menunggu_pembayaran'  THEN 'Menunggu pembayaran'
        WHEN 'payment_recorded'                  THEN 'Pembayaran dicatat'
        WHEN 'staff.create'                      THEN 'Akun staf dibuat'
        WHEN 'staff.update'                      THEN 'Profil staf diubah'
        WHEN 'staff.delete'                      THEN 'Akun staf dihapus'
        WHEN 'time_off.approved'                 THEN 'Izin/cuti disetujui'
        WHEN 'time_off.rejected'                 THEN 'Izin/cuti ditolak'
        WHEN 'stock.claim_confirmed'             THEN 'Klaim stok dikonfirmasi'
        WHEN 'stock.claim_rejected'              THEN 'Klaim stok ditolak'
        WHEN 'stock.opname.submitted'            THEN 'Opname stok diserahkan'
        WHEN 'attendance.check_in'               THEN 'Absen masuk'
        WHEN 'attendance.check_out'              THEN 'Absen keluar'
        WHEN 'branch.settings.update'            THEN 'Pengaturan cabang diubah'
        WHEN 'branch.created'                    THEN 'Cabang baru dibuat'
        ELSE al.action
      END                                         AS label,
      (al.metadata->>'order_number')              AS order_number,
      COALESCE(
        al.metadata->>'deleted_name',
        al.metadata->>'full_name',
        al.metadata->>'target_name'
      )                                           AS target_name

    FROM public.activity_logs al
    LEFT JOIN public.profiles actor ON actor.id = al.actor_id

    WHERE
      (p_category = 'all' OR
        CASE
          WHEN al.action LIKE 'order.%'        THEN 'order'
          WHEN al.action = 'payment_recorded'  THEN 'payment'
          WHEN al.action LIKE 'staff.%'        THEN 'staff'
          WHEN al.action LIKE 'time_off.%'     THEN 'time_off'
          WHEN al.action LIKE 'stock.%'        THEN 'stock'
          WHEN al.action LIKE 'attendance.%'   THEN 'attendance'
          ELSE 'system'
        END = p_category
      )
      AND (p_branch_id IS NULL OR actor.branch_id = p_branch_id)
      AND (p_from IS NULL OR al.created_at::date >= p_from)
      AND (p_to   IS NULL OR al.created_at::date <= p_to)

    ORDER BY al.created_at DESC
    LIMIT p_limit
    OFFSET p_offset

  LOOP
    RETURN NEXT row_to_json(r);
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.get_audit_trail(uuid, text, date, date, int, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_audit_trail(uuid, text, date, date, int, int) TO authenticated;

COMMENT ON FUNCTION public.get_audit_trail IS
  '0109: Fix return type — SETOF json avoids column type mismatch.';
