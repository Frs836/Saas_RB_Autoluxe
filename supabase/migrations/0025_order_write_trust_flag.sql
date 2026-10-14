-- 0025_order_write_trust_flag.sql
--
-- Memulihkan penghormatan terhadap flag app.trusted_order_write.
--
-- Apa yang rusak
-- --------------
-- start_order_work dan apply_order_status menyalakan flag ini sebelum mengubah
-- status order, sebagai tanda bahwa perubahan itu datang dari alur kerja yang
-- sudah divalidasi, bukan dari klien. guard_order_identity sebelumnya menghormati
-- flag tersebut.
--
-- 0023 memasang ulang guard_order_identity dari versi yang tertinggal di repo,
-- dan versi itu justru tidak membaca flag. Akibatnya setiap transisi status
-- ditolak, termasuk yang sah: teknisi tidak bisa memulai order, admin kasir
-- tidak bisa menyetujui QC, dan garansi tidak pernah terbit.
--
-- Pelajaran: file migrasi di repo tidak selalu sama dengan isi database. Memperbaiki
-- satu hal dengan mengambil versi lama justru membatalkan perbaikan yang sudah
-- berjalan di produksi.
--
-- Yang dipulihkan
-- ---------------
-- 1. Kolom identitas (created_by, order_number, tracking_token, branch_id)
--    tetap dilindungi untuk semua pemanggil biasa. Ini tidak pernah boleh
--    ditembus, dari RPC maupun bukan.
--
-- 2. Perubahan status, payment_state, dan kolom lain hanya boleh lewat RPC
--    yang menyalakan flag, atau lewat service role untuk integrasi dan skrip
--    admin.
--
-- 3. Menyalakan flag sendiri lewat set_config dari klien tidak mungkin karena
--    current_setting hanya dibaca di dalam sesi database, bukan lewat
--    permintaan HTTP terpisah.

CREATE OR REPLACE FUNCTION public.guard_order_identity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_role     public.user_role := (SELECT public.current_user_role());
  v_trusted  boolean;
  v_admin    boolean;
BEGIN
  IF tg_op = 'INSERT' THEN
    IF NULLIF(btrim(COALESCE(new.order_number, '')), '') IS NULL THEN
      new.order_number := public.next_order_number();
    END IF;

    IF NULLIF(btrim(COALESCE(new.tracking_token, '')), '') IS NULL THEN
      new.tracking_token := public.new_tracking_token();
    END IF;

    IF (SELECT auth.uid()) IS NOT NULL THEN
      new.created_by := (SELECT public.current_profile_id());
      new.branch_id := COALESCE(
        new.branch_id,
        (SELECT p.branch_id FROM public.profiles p WHERE p.id = new.created_by)
      );
    END IF;

    RETURN new;
  END IF;

  -- Service role dan postgres memakai jalur integrasi dan skrip admin. Mereka
  -- melewati seluruh penjaga, sama seperti sebelumnya.
  v_admin := COALESCE(current_setting('request.jwt.claim.role', true), '')
             IN ('service_role', 'postgres', 'supabase_admin');
  IF v_admin THEN
    RETURN NEW;
  END IF;

  -- Flag disalakan oleh start_order_work dan apply_order_status tepat sebelum
  -- mengubah status, dan dimatikan lagi setelahnya. Sesi tanpa sesi
  -- keanggotaan tidak pernah menyalakannya.
  v_trusted := COALESCE(current_setting('app.trusted_order_write', true), 'off') = 'on';

  -- Kolom identitas tidak pernah boleh berubah lewat jalur mana pun yang
  -- bukan penyusunan data, termasuk lewat RPC.
  IF new.created_by IS DISTINCT FROM old.created_by
     OR new.order_number IS DISTINCT FROM old.order_number
     OR new.tracking_token IS DISTINCT FROM old.tracking_token
     OR new.branch_id IS DISTINCT FROM old.branch_id THEN
    RAISE EXCEPTION
      'Kolom created_by, order_number, tracking_token, dan branch_id pada order tidak dapat diubah.';
  END IF;

  IF v_trusted THEN
    RETURN NEW;
  END IF;

  -- Tanpa flag, perubahan status hanya boleh oleh maintainer. Ini yang menahan
  -- klien dari menyetel status secara langsung lewat PostgREST.
  IF v_role IS DISTINCT FROM 'maintainer'::public.user_role THEN
    IF new.status IS DISTINCT FROM old.status THEN
      RAISE EXCEPTION
        'Status order hanya dapat diubah melalui alur kerja yang telah tervalidasi, bukan langsung dari klien.';
    END IF;

    IF new.payment_state IS DISTINCT FROM old.payment_state THEN
      RAISE EXCEPTION
        'Status pembayaran order hanya dapat diubah melalui alur kerja yang telah tervalidasi.';
    END IF;

    IF (to_jsonb(new) - array['updated_at', 'started_by', 'started_at']) IS DISTINCT FROM
       (to_jsonb(old) - array['updated_at', 'started_by', 'started_at']) THEN
      RAISE EXCEPTION
        'Kolom order di luar daftar itu hanya dapat diubah oleh maintainer.';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

-- Flag wajib dimatikan kembali setelah dipakai, kalau tidak ada sesi berikutnya
-- yang menulis order di sesi sama, flag itu ikut terbawa.
CREATE OR REPLACE FUNCTION public.guard_trusted_flag_cleanup()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  PERFORM pg_catalog.set_config('app.trusted_order_write', 'off', true);
  RETURN NULL;
END;
$function$;

DROP TRIGGER IF EXISTS orders_trusted_flag_cleanup ON public.orders;
CREATE TRIGGER orders_trusted_flag_cleanup
  AFTER UPDATE ON public.orders
  FOR EACH STATEMENT
  EXECUTE FUNCTION public.guard_trusted_flag_cleanup();

REVOKE ALL ON FUNCTION public.guard_trusted_flag_cleanup() FROM PUBLIC, anon;