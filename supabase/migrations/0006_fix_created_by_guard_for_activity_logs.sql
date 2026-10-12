-- ============================================================================
-- 0006_fix_created_by_guard_for_activity_logs.sql
-- Perbaikan trigger guard_created_by_identity.
-- Sifat: non-destruktif + idempoten (aman dijalankan ulang).
--
-- Masalah: fungsi guard_created_by_identity() selalu menyentuh NEW.created_by,
-- padahal trigger yang sama juga terpasang di public.activity_logs yang tidak
-- memiliki kolom created_by (identitasnya memakai actor_id). Setiap INSERT ke
-- activity_logs (mis. dari set_order_team / apply_order_status / cancel_order)
-- gagal dengan 'record "new" has no field "created_by"'.
--
-- Perbaikan: fungsi berhenti lebih awal bila baris tidak punya kolom
-- created_by, dan trigger created_by pada activity_logs dilepas karena tidak
-- relevan di tabel tersebut.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.guard_created_by_identity()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  IF NOT (pg_catalog.to_jsonb(NEW) ? 'created_by') THEN
    RETURN NEW;
  END IF;

  IF (SELECT auth.uid()) IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.created_by := (SELECT public.current_profile_id());
  ELSIF NEW.created_by IS DISTINCT FROM OLD.created_by THEN
    RAISE EXCEPTION 'Kolom created_by tidak dapat diubah.';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS activity_logs_guard_created_by ON public.activity_logs;
