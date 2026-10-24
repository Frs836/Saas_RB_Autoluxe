-- ============================================================
-- Phase 3: Cleanup Jobs + pg_cron scheduling
-- ============================================================
-- Membersihkan data usang secara berkala:
-- 1. Garansi expired: klaim garansi yang sudah ditolak > 30 hari
-- 2. Avatar orphan: file di storage profile-avatars tanpa referensi profil,
--    dan profil dengan avatar_path tapi file tidak ada
-- 3. Inspeksi cancelled: inspeksi untuk order yang status=cancelled
-- ============================================================

-- ---------------------------------------------------------------------------
-- 1. CLEANUP EXPIRED WARRANTY CLAIMS
-- ---------------------------------------------------------------------------
-- Hapus warranty_claims yang status=rejected dan created_at > 30 hari lalu
-- (sudah pasti tidak akan diproses lagi)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cleanup_expired_warranty_claims()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_deleted integer := 0;
BEGIN
  DELETE FROM public.warranty_claims
  WHERE status = 'rejected'::public.warranty_claim_status
    AND created_at < now() - interval '30 days';
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$function$;

REVOKE ALL ON FUNCTION public.cleanup_expired_warranty_claims() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cleanup_expired_warranty_claims() TO authenticated;

-- ---------------------------------------------------------------------------
-- 2. CLEANUP ORPHAN AVATAR FILES
-- ---------------------------------------------------------------------------
-- a) Hapus file di storage.profile-avatars yang tidak dirujuk profil manapun
-- b) Hapus avatar_path di profil yang file-nya sudah tidak ada di storage
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cleanup_orphan_avatars()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_result jsonb := jsonb_build_object(
    'storage_deleted', 0,
    'profile_cleared', 0
  );
  v_storage_files text[];
  v_profile_avatars text[];
  v_orphan_files text[];
  v_missing_files text[];
  v_file text;
  v_deleted integer := 0;
BEGIN
  -- Ambil semua file di bucket profile-avatars
  SELECT array_agg(name) INTO v_storage_files
  FROM storage.objects
  WHERE bucket_id = 'profile-avatars';

  -- Ambil semua avatar_path dari profil yang tidak null
  SELECT array_agg(avatar_path) INTO v_profile_avatars
  FROM public.profiles
  WHERE avatar_path IS NOT NULL;

  -- File di storage tapi tidak dirujuk profil manapun
  IF v_storage_files IS NOT NULL AND v_profile_avatars IS NOT NULL THEN
    v_orphan_files := v_storage_files;
    FOREACH v_file IN ARRAY v_profile_avatars LOOP
      v_orphan_files := array_remove(v_orphan_files, v_file);
    END LOOP;
  ELSIF v_storage_files IS NOT NULL THEN
    v_orphan_files := v_storage_files;
  END IF;

  -- Hapus file orphan di storage
  IF v_orphan_files IS NOT NULL AND array_length(v_orphan_files, 1) > 0 THEN
    DELETE FROM storage.objects
    WHERE bucket_id = 'profile-avatars'
      AND name = ANY(v_orphan_files);
    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    v_result := v_result || jsonb_build_object('storage_deleted', v_deleted);
  END IF;

  -- Profil yang avatar_path-nya tapi file tidak ada di storage
  IF v_profile_avatars IS NOT NULL AND v_storage_files IS NOT NULL THEN
    v_missing_files := v_profile_avatars;
    FOREACH v_file IN ARRAY v_storage_files LOOP
      v_missing_files := array_remove(v_missing_files, v_file);
    END LOOP;
  ELSIF v_profile_avatars IS NOT NULL THEN
    v_missing_files := v_profile_avatars;
  END IF;

  -- Kosongkan avatar_path profil yang file-nya hilang
  IF v_missing_files IS NOT NULL AND array_length(v_missing_files, 1) > 0 THEN
    UPDATE public.profiles
    SET avatar_path = NULL, updated_at = now()
    WHERE avatar_path = ANY(v_missing_files);
    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    v_result := v_result || jsonb_build_object('profile_cleared', v_deleted);
  END IF;

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.cleanup_orphan_avatars() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cleanup_orphan_avatars() TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. CLEANUP INSPECTIONS FOR CANCELLED ORDERS
-- ---------------------------------------------------------------------------
-- Hapus order_inspections yang order-nya status=cancelled
-- (inspeksi untuk order batal tidak berguna lagi)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cleanup_cancelled_order_inspections()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_deleted integer := 0;
BEGIN
  DELETE FROM public.order_inspections oi
  USING public.orders o
  WHERE oi.order_id = o.id
    AND o.status = 'cancelled'::public.order_status;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$function$;

REVOKE ALL ON FUNCTION public.cleanup_cancelled_order_inspections() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cleanup_cancelled_order_inspections() TO authenticated;

-- ---------------------------------------------------------------------------
-- 4. MASTER CLEANUP FUNCTION (dipanggil pg_cron)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.run_daily_cleanup()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_result jsonb := jsonb_build_object(
    'warranty_deleted', 0,
    'avatar_storage_deleted', 0,
    'avatar_profile_cleared', 0,
    'inspections_deleted', 0,
    'run_at', now()
  );
  v_avatar_result jsonb;
BEGIN
  -- 1. Garansi expired
  SELECT public.cleanup_expired_warranty_claims() INTO v_result->>'warranty_deleted';

  -- 2. Avatar orphan
  v_avatar_result := public.cleanup_orphan_avatars();
  v_result := v_result || jsonb_build_object(
    'avatar_storage_deleted', v_avatar_result->>'storage_deleted',
    'avatar_profile_cleared', v_avatar_result->>'profile_cleared'
  );

  -- 3. Inspeksi cancelled
  SELECT public.cleanup_cancelled_order_inspections() INTO v_result->>'inspections_deleted';

  -- Log ke activity_logs
  INSERT INTO public.activity_logs (actor_id, action, entity, metadata)
  VALUES (
    (SELECT id FROM public.profiles WHERE role = 'owner' LIMIT 1),
    'cleanup.daily',
    'system',
    v_result
  );

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.run_daily_cleanup() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.run_daily_cleanup() TO authenticated;

-- ---------------------------------------------------------------------------
-- 5. PG_CRON SCHEDULING
-- ---------------------------------------------------------------------------
-- Jalankan cleanup harian jam 02:00 WIB (19:00 UTC hari sebelumnya)
-- catatan: pg_cron pakai UTC, jadi 19:00 UTC = 02:00 WIB
-- ---------------------------------------------------------------------------
SELECT cron.schedule(
  'daily-cleanup-jobs',
  '0 19 * * *',  -- 19:00 UTC = 02:00 WIB
  $$ SELECT public.run_daily_cleanup(); $$
);

-- Juga jalankan cleanup inspeksi cancelled setiap 6 jam (lebih sering)
SELECT cron.schedule(
  'cleanup-cancelled-inspections',
  '0 */6 * * *',
  $$ SELECT public.cleanup_cancelled_order_inspections(); $$
);

-- ============================================================
-- CATATAN:
-- - Semua fungsi SECURITY DEFINER jalan sebagai owner (bypass RLS)
-- - Hanya authenticated yang bisa eksekusi manual
-- - pg_cron jalan sebagai postgres superuser (bypass RLS otomatis)
-- - Log cleanup masuk activity_logs untuk audit
-- ============================================================