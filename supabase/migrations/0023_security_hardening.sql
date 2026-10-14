-- 0023_security_hardening.sql
--
-- Menutup kebocoran kas ke umum dan mengunci jalur yang bisa dilewati langsung
-- dari browser.
--
-- Ringkasan
-- --------
-- A. expected_cash_for_date bisa dipanggil anon dan membocorkan total kas
--    seluruh cabang. Tidak ada satu pun pemanggil langsung dari aplikasi,
--    jadi mencabut eksekusinya tidak merusak alur apa pun.
-- B. consume_order_materials tidak memeriksa identitas sama sekali.
-- C. Setiap guard_* melompat saat auth.uid() null, jadi satu kebocoran
--    service_role membuat seluruh penjaga tidak berlaku.
-- D. Insert attendance_logs dari klien membatalkan geofence, verifikasi wajah,
--    dan kalkulasi keterlambatan.
-- E. Pengajuan izin bisa dibuat langsung dengan status sudah disetujui.
-- F. Resep bahan dan opname bisa ditulis siapa pun di cabang itu.
--
-- Idempoten: aman dijalankan ulang.

-- ---------------------------------------------------------------------------
-- A. expected_cash_for_date bocor ke anon
-- ---------------------------------------------------------------------------
-- Terverifikasi langsung: klien anon tanpa sesi memanggil versi 3-arg dengan
-- p_branch_id null dan menerima total kas seluruh perusahaan.

-- Hapus default warisan PUBLIC pada KEDUA overload.
REVOKE EXECUTE ON FUNCTION public.expected_cash_for_date(date, numeric)
  FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.expected_cash_for_date(date, numeric, uuid)
  FROM PUBLIC, anon;

-- Tetap boleh dipakai sesi yang sudah masuk, untuk halaman kas dan rekap.
GRANT EXECUTE ON FUNCTION public.expected_cash_for_date(date, numeric)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.expected_cash_for_date(date, numeric, uuid)
  TO authenticated;

-- Fungsi lama yang sudah digantikan get_order_tracking. Sudah ditolak untuk
-- anon, tapi masih diwarisi PUBLIC. Ditutup penuh supaya tidak ada jalur
-- tambahan yang lupa ditutup nanti.
REVOKE EXECUTE ON FUNCTION public.public_order_tracking(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.public_order_inspections(text) FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- B. consume_order_materials tanpa cek identitas
-- ---------------------------------------------------------------------------
-- Fungsi ini boleh dipanggil sesi masuk mana pun dan memotong stok order
-- cabang mana pun. Yang pertama menang karena pemotongan hanya satu kali.
-- Setelah itu dipanggil dari apply_order_status, pemanggil dari luar tidak
-- diperlukan.

REVOKE EXECUTE ON FUNCTION public.consume_order_materials(uuid)
  FROM PUBLIC, anon, authenticated;

-- Dipanggil dari dalam apply_order_status yang berjalan sebagai owner, jadi
-- hantu hak eksekusi tidak diperlukan. Efek sampingnya: saat dipakai sebagai
-- pemanggil langsung, error yang muncul adalah permission denied, bukan
-- "order tidak ditemukan", sehingga penyebabnya jelas.

-- ---------------------------------------------------------------------------
-- C. Guard early-return saat auth.uid() null
-- ---------------------------------------------------------------------------
-- guard_order_identity, guard_cash_flow_identity, guard_created_by_identity,
-- dan guard_profile_privileges semuanya melompat begitu auth.uid() kosong.
-- Pola itu wajar untuk akses dari service role saat membuat data awal, tapi
-- berarti satu service_role key yang bocor membuat seluruh penjaga lenonggar:
-- created_by, branch_id, order_number, dan tracking_token bisa ditulis ulang.
--
-- Perbaikan: kunci berdasarkan role postgres/service_role, bukan sekadar uid
-- kosong. Sesi anon maupun sesi yang uid-nya hilang tidak lagi lolos.
--
-- Catatan:_service_role sering dipakai oleh integrasi test dan skrip admin.
-- Kunci justru diperketat supaya jalur itu punya jalur yang eksplisit.

CREATE OR REPLACE FUNCTION public.guard_order_identity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_role public.user_role := (SELECT public.current_user_role());
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

  -- Hanya pemanggil tepercaya yang boleh melewati penjaga ini. Service role dan
  -- postgres diizinkan karena integrasi dan skrip admin butuh menyusun data.
  IF COALESCE(current_setting('request.jwt.claim.role', true), '') NOT IN
       ('service_role', 'postgres', 'supabase_admin') THEN

    IF new.created_by IS DISTINCT FROM old.created_by
       OR new.order_number IS DISTINCT FROM old.order_number
       OR new.tracking_token IS DISTINCT FROM old.tracking_token
       OR new.branch_id IS DISTINCT FROM old.branch_id THEN
      RAISE EXCEPTION
        'Kolom created_by, order_number, tracking_token, dan branch_id pada order tidak dapat diubah.';
    END IF;

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
  END IF;

  RETURN new;
END;
$function$;

-- ---------------------------------------------------------------------------
-- D. Insert attendance_logs harus lewat RPC
-- ---------------------------------------------------------------------------
-- Tabel ini punya GRANT INSERT untuk authenticated. Policy INSERT-nya tidak
-- ada di repo, jadi insert langsung bisa menandai check-in tanpa geofence,
-- tanpa verifikasi wajah master, dan tanpa kalkulasi menit terlambat.

REVOKE INSERT ON public.attendance_logs FROM authenticated;

-- ---------------------------------------------------------------------------
-- E. Pengajuan izin tidak boleh dibuat dalam keadaan sudah disetujui
-- ---------------------------------------------------------------------------
-- Trigger yang ada hanya berjalan pada BEFORE UPDATE. Insert langsung tetap bisa
-- membuat baris dengan status approved dan approver_id milik sendiri.

CREATE OR REPLACE FUNCTION public.guard_time_off_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
BEGIN
  -- Kolom yang menentukan keputusan dipaksa ke bentuk awal, supaya insert
  -- langsung tidak bisa membuat pengajuan yang terlihat sudah disetujui.
  NEW.status := 'pending'::public.time_off_status;
  NEW.approver_id := NULL;
  NEW.decided_at := NULL;
  RETURN NEW;
END;
$function$;

-- WHEN hanya berlaku untuk sesi biasa. Insert lewat service role (admin, seed,
-- integrasi) tetap boleh membuat keputusan langsung.
DROP TRIGGER IF EXISTS time_off_insert_guard ON public.time_off_requests;
CREATE TRIGGER time_off_insert_guard
  BEFORE INSERT ON public.time_off_requests
  FOR EACH ROW
  WHEN (COALESCE(current_setting('request.jwt.claim.role', true), '')
        NOT IN ('service_role', 'postgres', 'supabase_admin'))
  EXECUTE FUNCTION public.guard_time_off_insert();

-- ---------------------------------------------------------------------------
-- F. Resep bahan dan opname butuh role, bukan hanya akses cabang
-- ---------------------------------------------------------------------------
-- can_access_branch() hanya berarti "orang iniMinimal punya cabang", jadi
-- karyawan biasa ikut lolos. Akibatnya karyawan bisa menulis resep bahan, dan
-- lebih buruk: bisa mengubah status opname jadi submitted sehingga opname bulan
-- itu terkunci tanpa pernah dihitung dan tanpa jejak stock_logs.

DROP POLICY IF EXISTS service_material_recipes_write_privileged
  ON public.service_material_recipes;
CREATE POLICY service_material_recipes_write_privileged
  ON public.service_material_recipes
  FOR ALL
  USING (
    public.has_role(ARRAY['owner','admin_kasir','maintainer']::public.user_role[])
    AND public.can_access_branch(branch_id)
  )
  WITH CHECK (
    public.has_role(ARRAY['owner','admin_kasir','maintainer']::public.user_role[])
    AND public.can_access_branch(branch_id)
  );

DROP POLICY IF EXISTS stock_opnames_write_privileged ON public.stock_opnames;
CREATE POLICY stock_opnames_write_privileged
  ON public.stock_opnames
  FOR ALL
  USING (
    public.has_role(ARRAY['owner','admin_kasir','maintainer']::public.user_role[])
    AND public.can_access_branch(branch_id)
  )
  WITH CHECK (
    public.has_role(ARRAY['owner','admin_kasir','maintainer']::public.user_role[])
    AND public.can_access_branch(branch_id)
  );

-- Baris item opname mengikuti hak baris induknya, bukan sekadar status draft.
DROP POLICY IF EXISTS stock_opname_lines_write ON public.stock_opname_lines;
CREATE POLICY stock_opname_lines_write ON public.stock_opname_lines
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.stock_opnames o
       WHERE o.id = stock_opname_lines.opname_id
         AND public.can_access_branch(o.branch_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.stock_opnames o
       WHERE o.id = stock_opname_lines.opname_id
         AND public.can_access_branch(o.branch_id)
         AND o.status = 'draft'::public.stock_opname_status
    )
  );

-- ---------------------------------------------------------------------------
-- G. Jejak audit untuk jalur yang sebelumnya tidak tercatat
-- ---------------------------------------------------------------------------

-- Stock masuk dari supplier sebelumnya hanya masuk ke stock_logs, tidak ada
-- jejak siapa yang mencatat.
CREATE OR REPLACE FUNCTION public.guard_stock_audit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
BEGIN
  -- Hanya perubahan saldo yang dicatat. Edit nama barang atau satuan tidak
  -- relevan untuk jejak audit.
  IF COALESCE(current_setting('request.jwt.claim.role', true), '')
       IN ('service_role', 'postgres', 'supabase_admin') THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.activity_logs (actor_id, action, entity, entity_id, metadata)
  VALUES (
    public.current_profile_id(),
    'stock.balance_changed',
    'inventory_item',
    NEW.id,
    jsonb_build_object(
      'item_name', NEW.item_name,
      'branch_id', NEW.branch_id,
      'stok_sebelum', OLD.current_stock,
      'stok_sesudah', NEW.current_stock,
      'selisih', round(NEW.current_stock - OLD.current_stock, 2)
    )
  );
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS stock_balance_audit ON public.inventory_items;
CREATE TRIGGER stock_balance_audit
  AFTER UPDATE ON public.inventory_items
  FOR EACH ROW
  WHEN (OLD.current_stock IS DISTINCT FROM NEW.current_stock)
  EXECUTE FUNCTION public.guard_stock_audit();

-- ---------------------------------------------------------------------------
-- H. Radius geofence tidak boleh dimatikan dari sisi database
-- ---------------------------------------------------------------------------
-- Batas 5-5000 meter hanya ada di browser. Fungsi database hanya menolak
-- nilai nol atau negatif, jadi radius 5 juta meter tetap diterima dan
-- geofence praktis hilang.

CREATE OR REPLACE FUNCTION public.set_branch_location(
  p_branch_id       uuid,
  p_latitude        numeric,
  p_longitude       numeric,
  p_radius_meters   numeric DEFAULT 30
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_branch public.branches%rowtype;
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN
    RAISE EXCEPTION 'Lokasi cabang hanya dapat diubah oleh pengguna yang sudah masuk.';
  END IF;

  IF NOT COALESCE(public.has_role(
       ARRAY['owner', 'maintainer']::public.user_role[]), false) THEN
    RAISE EXCEPTION 'Hanya owner atau maintainer yang dapat mengubah lokasi cabang.';
  END IF;

  IF NOT COALESCE(public.can_access_branch(p_branch_id), false)
     AND NOT COALESCE(public.has_role('maintainer'::public.user_role), false) THEN
    RAISE EXCEPTION 'Cabang di luar cakupan Anda.';
  END IF;

  IF p_latitude IS NULL OR p_longitude IS NULL THEN
    RAISE EXCEPTION 'Koordinat wajib diisi.';
  END IF;

  IF p_latitude < -90 OR p_latitude > 90
     OR p_longitude < -180 OR p_longitude > 180 THEN
    RAISE EXCEPTION 'Koordinat di luar rentang geografis yang valid.';
  END IF;

  -- Batas atas 5 km. Nilai yang lebih besar membatalkan fungsi geofence, jadi
  -- tidak boleh bisa diminta, bukan hanya tidak ditampilkan di UI.
  IF p_radius_meters IS NULL OR p_radius_meters < 5 OR p_radius_meters > 5000 THEN
    RAISE EXCEPTION 'Radius geofence harus antara 5 sampai 5000 meter.';
  END IF;

  UPDATE public.branches
     SET latitude = p_latitude,
         longitude = p_longitude,
         geofence_radius_meters = p_radius_meters,
         updated_at = now()
   WHERE id = p_branch_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cabang tidak ditemukan.';
  END IF;
END;
$function$;

REVOKE ALL ON FUNCTION public.set_branch_location(uuid, numeric, numeric, numeric)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_branch_location(uuid, numeric, numeric, numeric)
  TO authenticated;

-- ---------------------------------------------------------------------------
-- I. Batas tinggi radius di kolomnya sendiri
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'branches_geofence_radius_range'
  ) THEN
    ALTER TABLE public.branches
      ADD CONSTRAINT branches_geofence_radius_range
      CHECK (geofence_radius_meters >= 5 AND geofence_radius_meters <= 5000);
  END IF;
END;
$$;
