-- ============================================================================
-- RB AUTOLUXE - Migrasi 0014: Cakupan Baca Order & Trigger Nomor Order
-- Proyek: qidtfssldidzvehssevk  |  Tanggal: 2026-10-13
-- Sifat: NON-DESTRUKTIF & IDEMPOTEN.
--
-- Dua masalah yang ditemukan pengujian integrasi:
--
-- 1. orders_select_authenticated memakai
--       has_role(...) OR assigned_to = current_profile_id() OR assigned_to IS NULL
--    current_profile_id() mengembalikan NULL untuk profil nonaktif sehingga
--    `assigned_to IS NULL` tetap bernilai TRUE. Akun yang sudah dinonaktifkan
--    ternyata tetap bisa membaca seluruh order yang belum ditugaskan. Kalimat
--    yang sama juga membuat karyawan membaca semua order cabang, bukan hanya
--    tugasnya sendiri.
--
-- 2. order_items, order_team_members, dan order_inspections memakai
--    USING (true), sehingga baris anak lebih longgar daripada induknya:
--    siapa pun yang login bisa membaca rincian order, anggota tim, dan seluruh
--    foto inspeksi dari cabang mana pun.
--
-- Rekursi policy: policy orders perlu mengecek keanggotaan tim, sedangkan
-- policy order_team_members perlu mengecek order induknya. Kalau keduanya memakai
-- subquery langsung, Postgres melaporkan "infinite recursion detected in policy
-- for relation orders". Karena itu satu helper SECURITY DEFINER dipakai
-- bersama; fungsi berjalan sebagai pemiliknya sehingga RLS di dalamnya tidak
-- dievaluasi.
--
-- Catatan: guard_order_identity sebelumnya selalu menimpa order_number dengan
-- next_order_number() sehingga migrasi seed tidak bisa menulis nomor order
-- historis. Sekarang hanya diisi bila pemanggil tidak menyediakannya. RPC
-- aplikasi tidak pernah mengirim kolom itu, jadi perilaku otomatis tetap utuh.
-- ============================================================================

set search_path = public;

-- ---------------------------------------------------------------------------
-- 1. guard_order_identity menghormati order_number & tracking_token eksplisit
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.guard_order_identity()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_role  public.user_role := (SELECT public.current_user_role());
  v_allow text[] := array[
    'status', 'completed_at', 'cancellation_reason', 'updated_at',
    'payment_state', 'started_by', 'started_at'
  ];
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NULLIF(btrim(COALESCE(NEW.order_number, '')), '') IS NULL THEN
      NEW.order_number := public.next_order_number();
    END IF;

    IF NULLIF(btrim(COALESCE(NEW.tracking_token, '')), '') IS NULL THEN
      NEW.tracking_token := public.new_tracking_token();
    END IF;

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

    IF NEW.started_by IS DISTINCT FROM OLD.started_by THEN
      IF NEW.started_by IS NULL
         OR NEW.started_by IS DISTINCT FROM (SELECT public.current_profile_id()) THEN
        RAISE EXCEPTION
          'Kolom started_by hanya dapat diisi dengan profil pemanggil.';
      END IF;
    END IF;

    IF (to_jsonb(NEW) - v_allow) IS DISTINCT FROM (to_jsonb(OLD) - v_allow) THEN
      RAISE EXCEPTION
        'Kolom order di luar daftar itu hanya dapat diubah oleh owner, admin kasir, atau maintainer.';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 2. Helper cakupan baca order
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.can_view_order(p_order_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
  select
    (select public.current_profile_id()) is not null
    and (
      (select public.has_role(
        array['owner', 'admin_kasir', 'maintainer']::public.user_role[]
      ))
      or exists (
        select 1
          from public.orders o
         where o.id = p_order_id
           and (o.assigned_to = (select public.current_profile_id())
             or o.created_by  = (select public.current_profile_id()))
      )
      or exists (
        select 1
          from public.orders o
          join public.order_team_members t on t.order_id = o.id
         where o.id = p_order_id
           and t.profile_id = (select public.current_profile_id())
      )
    );
$function$;

REVOKE ALL ON FUNCTION public.can_view_order(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_view_order(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. Policy order
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS orders_select_authenticated ON public.orders;

CREATE POLICY orders_select_authenticated
  ON public.orders FOR SELECT TO authenticated
  USING (public.can_view_order(id));

DROP POLICY IF EXISTS orders_update_authenticated ON public.orders;

CREATE POLICY orders_update_authenticated
  ON public.orders FOR UPDATE TO authenticated
  USING (public.can_view_order(id))
  WITH CHECK (public.can_view_order(id));

-- ---------------------------------------------------------------------------
-- 4. Policy baris anak tidak boleh lebih longgar daripada induknya
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS order_items_select_authenticated ON public.order_items;

CREATE POLICY order_items_select_authenticated
  ON public.order_items FOR SELECT TO authenticated
  USING (public.can_view_order(order_id));

DROP POLICY IF EXISTS order_team_members_select_authenticated
  ON public.order_team_members;

CREATE POLICY order_team_members_select_authenticated
  ON public.order_team_members FOR SELECT TO authenticated
  USING (public.can_view_order(order_id));

DROP POLICY IF EXISTS inspections_select_authenticated ON public.order_inspections;

CREATE POLICY inspections_select_authenticated
  ON public.order_inspections FOR SELECT TO authenticated
  USING (public.can_view_order(order_id));

-- ---------------------------------------------------------------------------
-- 5. Geser permukaan serangan anon
--    public_order_tracking dan public_order_inspections digantikan oleh
--    get_order_tracking(text) yang dipakai halaman lacak publik.
-- ---------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.public_order_tracking(text)
  FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.public_order_inspections(text)
  FROM anon, authenticated;