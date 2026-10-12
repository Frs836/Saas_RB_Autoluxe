-- ============================================================================
-- 0007_allow_cancellation_reason_in_order_guard.sql
-- Perbaikan trigger guard_order_identity.
-- Sifat: non-destruktif + idempoten (aman dijalankan ulang).
--
-- Masalah: cancel_order() meng-update kolom cancellation_reason, tetapi
-- guard_order_identity() menolak setiap kolom di luar allow-list sehingga
-- pembatalan order gagal dengan 'Kolom order di luar daftar itu hanya dapat
-- diubah oleh owner, admin kasir, atau maintainer.'
--
-- Perbaikan: tambahkan cancellation_reason ke allow-list dasar pada UPDATE.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.guard_order_identity()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_role  public.user_role := (SELECT public.current_user_role());
  v_allow text[] := array['status', 'completed_at', 'cancellation_reason', 'updated_at'];
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.order_number  := public.next_order_number();
    NEW.tracking_token := public.new_tracking_token();

    IF (SELECT auth.uid()) IS NOT NULL THEN
      NEW.created_by := (SELECT public.current_profile_id());
      NEW.branch_id  := COALESCE(
        NEW.branch_id,
        (SELECT p.branch_id FROM public.profiles p WHERE p.id = NEW.created_by)
      );
    END IF;

    RETURN NEW;
  END IF;

  IF (SELECT auth.uid()) IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.created_by IS DISTINCT FROM OLD.created_by
     OR NEW.order_number IS DISTINCT FROM OLD.order_number
     OR NEW.tracking_token IS DISTINCT FROM OLD.tracking_token
     OR NEW.branch_id IS DISTINCT FROM OLD.branch_id THEN
    RAISE EXCEPTION
      'Kolom created_by, order_number, tracking_token, dan branch_id pada order tidak dapat diubah.';
  END IF;

  IF v_role IS DISTINCT FROM 'maintainer'::public.user_role THEN
    IF (SELECT public.has_role(ARRAY['owner','admin_kasir']::public.user_role[])) THEN
      v_allow := v_allow || array['assigned_to'];
    END IF;

    IF (to_jsonb(NEW) - v_allow) IS DISTINCT FROM (to_jsonb(OLD) - v_allow) THEN
      RAISE EXCEPTION
        'Kolom order di luar daftar itu hanya dapat diubah oleh owner, admin kasir, atau maintainer.';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;
