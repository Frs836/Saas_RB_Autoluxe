-- 0024_branch_isolation.sql
--
-- Isolasi cabang dan koreksi kas saat pembatalan.
--
-- Masalah yang diperbaiki
-- ---------------------
-- 1. apply_order_status tidak memeriksa cabang. Admin kasir cabang A bisa
--    menyetujui QC, mengembalikan ke pengerjaan, atau menyelesaikan order
--    cabang B. can_view_order memberi akses global ke admin_kasir, jadi
--    pembatasan cabang di layar antrean hanya tampilan.
--
-- 2. cancel_order tidak memeriksa cabang, dan tidak membalik kas. Order yang
--    sudah tercatat pemasukan tetap tercatat pemasukan setelah dibatalkan,
--    cash_hold_amount tidak dilepas, dan payment_state tetap paid. Angka
--    omzet, arus kas, dan selisih tutup shift semuanya jadi tidak cocok dengan
--    kenyataan.
--
-- 3. set_order_team tidak memeriksa cabang order maupun cabang teknisi.
--    Teknisi cabang B bisa ditugaskan ke order cabang A, dan penugasan itu
--    otomatis memberinya akses ke order tersebut.
--
-- 4. confirm_stock_claim dan reject_stock_claim tidak memeriksa cabang, padahal
--    create_stock_claim sudah diperiksa. Admin kasir cabang A bisa memotong
--    stok cabang B.
--
-- 5. Beberapa policy hanya memeriksa role tanpa cabang: inventory_items,
--    order_items, commission_settings, stock_logs, warranty_claims, dan
--    keputusan time off.
--
-- Semua perubahan idempoten.

-- ---------------------------------------------------------------------------
-- 1. apply_order_status dibatasi ke cabang
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.apply_order_status(
  p_order_id uuid,
  p_status public.order_status
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_order    public.orders%rowtype;
  v_started  date := (now() at time zone 'Asia/Jakarta')::date;
  v_warranty text;
  v_officer  boolean;
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN
    RAISE EXCEPTION 'Status order hanya bisa diubah oleh pengguna yang sudah masuk.';
  END IF;

  v_officer := COALESCE((
    SELECT public.has_role(array['owner', 'admin_kasir', 'maintainer']::public.user_role[])
  ), false);

  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order tidak ditemukan.';
  END IF;

-- Owner dan maintainer memang punya akses global sesuai PRD. Selain keduanya, hanya
  -- cabang tempat orang itu ditugaskan yang boleh disentuh.
  IF NOT COALESCE(public.can_access_branch(v_order.branch_id), false) THEN
    RAISE EXCEPTION 'Order ini berada di luar cabang Anda.';
  END IF;

  -- Role non-manajerial boleh menjalankan transisi miliknya sendiri dari
  -- queued ke in_progress lalu ke qc_review. Namun keluar dari qc_review
  -- adalah keputusan mutu dan hanya boleh diambil tim manajerial.
  IF p_status <> v_order.status
     AND v_order.status IN ('qc_review', 'completed')
     AND NOT v_officer THEN
    RAISE EXCEPTION
      'Persetujuan dan penolakan QC hanya bisa dilakukan oleh owner, admin kasir, atau maintainer.';
  END IF;

  IF p_status <> v_order.status THEN
    IF NOT (
      (v_order.status = 'queued'      AND p_status = 'in_progress') OR
      (v_order.status = 'in_progress' AND p_status = 'qc_review')   OR
      (v_order.status = 'qc_review'   AND p_status = 'in_progress') OR
      (v_order.status = 'qc_review'   AND p_status = 'completed')
    ) THEN
      RAISE EXCEPTION 'Status tidak bisa berubah dari % ke %.', v_order.status, p_status;
    END IF;
  END IF;

  PERFORM public.set_config('app.trusted_order_write', 'on', true);

  UPDATE public.orders
     SET status = p_status,
         completed_at = CASE
           WHEN p_status = 'completed' THEN now()
           WHEN v_order.status = 'completed' THEN NULL
           ELSE v_order.completed_at
         END
   WHERE id = p_order_id;

  PERFORM public.set_config('app.trusted_order_write', 'off', true);

  IF p_status <> v_order.status THEN
    INSERT INTO public.activity_logs (actor_id, action, entity, entity_id, metadata)
    VALUES (
      public.current_profile_id(),
      'order.status.' || p_status::text,
      'order', p_order_id,
      jsonb_build_object(
        'from', v_order.status, 'to', p_status,
        'order_number', v_order.order_number, 'branch_id', v_order.branch_id
      )
    );
  END IF;

  -- Pemotongan bahan otomatis sesuai resep layanan.
  IF p_status = 'completed' AND v_order.status <> 'completed' THEN
    PERFORM public.consume_order_materials(p_order_id);
  END IF;

  IF p_status <> 'completed' THEN
    RETURN NULL;
  END IF;

  IF NOT (
    strpos(lower(COALESCE(v_order.service_package, '')), 'coating') > 0
    OR strpos(lower(COALESCE(v_order.service_package, '')), 'ceramic') > 0
    OR strpos(lower(COALESCE(v_order.service_package, '')), 'liquid glass') > 0
    OR strpos(lower(COALESCE(v_order.service_package, '')), 'nano') > 0
  ) THEN
    RETURN NULL;
  END IF;

  INSERT INTO public.warranties (order_id, warranty_code, start_date, end_date)
  VALUES (p_order_id, 'WRT-' || v_order.order_number, v_started, v_started + 180)
  ON CONFLICT (order_id) DO NOTHING
  RETURNING warranty_code INTO v_warranty;

  RETURN v_warranty;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 2. cancel_order dibatasi cabang, dan kas dikoreksi
-- ---------------------------------------------------------------------------
-- Koreksi dibuat sebagai baris 'out', bukan menghapus baris 'in' asli.
-- Menghapus riwayat kas akan menghilangkan bukti untuk audit selisih shift.

CREATE OR REPLACE FUNCTION public.cancel_order(p_order_id uuid, p_reason TEXT DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_order      public.orders%rowtype;
  v_reversed   numeric(12,2);
  v_count      integer;
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN
    RAISE EXCEPTION 'Pembatalan hanya bisa dilakukan oleh pengguna yang sudah masuk.';
  END IF;

  IF NOT (SELECT public.has_role(ARRAY['owner','admin_kasir','maintainer']::public.user_role[])) THEN
    RAISE EXCEPTION 'Hanya owner, admin kasir, dan maintainer yang bisa membatalkan order.';
  END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order tidak ditemukan.';
  END IF;

  IF NOT COALESCE(public.can_access_branch(v_order.branch_id), false) THEN
    RAISE EXCEPTION 'Order ini berada di luar cabang Anda.';
  END IF;

  IF v_order.status NOT IN ('queued', 'in_progress') THEN
    RAISE EXCEPTION 'Hanya order berstatus antre atau dikerjakan yang bisa dibatalkan.';
  END IF;

  PERFORM public.set_config('app.trusted_order_write', 'on', true);

  -- Pembatalan melepas uang titipan dan menandai order belum dibayar, supaya
  -- saldo kas dan status pembayaran tidak lagi menyebut nominal yang sudah
  -- dibatalkan.
  UPDATE public.orders
     SET status = 'cancelled'::public.order_status,
         cancellation_reason = NULLIF(btrim(COALESCE(p_reason, '')), ''),
         completed_at = NULL,
         payment_state = 'unpaid'::public.order_payment_state,
         cash_hold_profile_id = NULL,
         cash_hold_amount = NULL,
         cash_hold_payment_method = NULL,
         updated_at = now()
   WHERE id = p_order_id;

  PERFORM public.set_config('app.trusted_order_write', 'off', true);

  -- Koreksi kas hanya untuk order yang benar-benar mencatat pemasukan.
  IF v_order.payment_state = 'paid'::public.order_payment_state THEN
    SELECT COALESCE(SUM(cf.amount), 0)
      INTO v_reversed
      FROM public.cash_flow cf
     WHERE cf.order_id = p_order_id
       AND cf.type = 'in'::public.cash_flow_type;

    SELECT count(*) INTO v_count
      FROM public.cash_flow cf
     WHERE cf.order_id = p_order_id
       AND cf.type = 'in'::public.cash_flow_type;

    IF v_count > 0 AND v_reversed > 0 THEN
      INSERT INTO public.cash_flow (
        type, amount, category, description, payment_method, branch_id, order_id
      )
      VALUES (
        'out'::public.cash_flow_type,
        v_reversed,
        'order_cancelled',
        v_order.order_number || ' - koreksi pembatalan order',
        v_order.payment_method,
        v_order.branch_id,
        p_order_id
      );
    END IF;
  END IF;

  INSERT INTO public.activity_logs (actor_id, action, entity, entity_id, metadata)
  VALUES (
    public.current_profile_id(),
    'order.cancelled',
    'orders', p_order_id,
    jsonb_build_object(
      'order_number', v_order.order_number,
      'branch_id', v_order.branch_id,
      'reason', p_reason,
      'koreksi_kas', COALESCE(v_reversed, 0)
    )
  );
END;
$function$;

-- ---------------------------------------------------------------------------
-- 3. set_order_team dibatasi cabang
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_order_team(p_order_id uuid, p_profile_ids uuid[])
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_order_branch uuid;
  v_staff_branch uuid;
  v_target       uuid;
  v_role         public.user_role;
  v_aktif        boolean;
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN
    RAISE EXCEPTION 'Penugasan tim hanya bisa dilakukan oleh pengguna yang sudah masuk.';
  END IF;

  IF NOT COALESCE((SELECT public.has_role(
       ARRAY['owner','admin_kasir','maintainer']::public.user_role[])), false) THEN
    RAISE EXCEPTION 'Hanya owner, admin kasir, dan maintainer yang bisa menugaskan tim.';
  END IF;

  SELECT branch_id INTO v_order_branch FROM public.orders WHERE id = p_order_id;
  IF v_order_branch IS NULL THEN
    RAISE EXCEPTION 'Order tidak ditemukan.';
  END IF;

  IF NOT COALESCE(public.can_access_branch(v_order_branch), false) THEN
    RAISE EXCEPTION 'Order ini berada di luar cabang Anda.';
  END IF;

  FOREACH v_target IN ARRAY COALESCE(p_profile_ids, ARRAY[]::uuid[]) LOOP
    SELECT p.role, p.is_active, p.branch_id
      INTO v_role, v_aktif, v_staff_branch
      FROM public.profiles p
     WHERE p.id = v_target;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Karyawan tidak ditemukan.';
    END IF;

    IF NOT COALESCE(v_aktif, false) THEN
      RAISE EXCEPTION 'Karyawan sudah tidak aktif dan tidak bisa ditugaskan.';
    END IF;

    IF v_role <> 'karyawan'::public.user_role THEN
      RAISE EXCEPTION 'Tim order hanya bisa diisi oleh karyawan lapangan.';
    END IF;

    -- Teknisi harus satu cabang dengan ordernya. Tanpa ini, teknisi cabang
    -- lain otomatis mendapat akses ke order ini lewat can_view_order.
    IF v_staff_branch IS DISTINCT FROM v_order_branch THEN
      RAISE EXCEPTION
        'Karyawan yang dipilih berada di cabang lain dari order ini.';
    END IF;
  END LOOP;

  DELETE FROM public.order_team_members WHERE order_id = p_order_id;

  INSERT INTO public.order_team_members (order_id, profile_id)
  SELECT p_order_id, v_target
  FROM unnest(COALESCE(p_profile_ids, ARRAY[]::uuid[])) AS v_target
  ON CONFLICT DO NOTHING;

  PERFORM public.set_config('app.trusted_order_write', 'on', true);
  UPDATE public.orders
     SET assigned_to = COALESCE(
       (array_agg(profile_id ORDER BY profile_id))[1], NULL
     )
   WHERE id = p_order_id;
  PERFORM public.set_config('app.trusted_order_write', 'off', true);

  INSERT INTO public.activity_logs (actor_id, action, entity, entity_id, metadata)
  VALUES (
    public.current_profile_id(),
    'order.team_assigned',
    'orders', p_order_id,
    jsonb_build_object(
      'order_number', (SELECT order_number FROM public.orders WHERE id = p_order_id),
      'branch_id', v_order_branch,
      'team', to_jsonb(COALESCE(p_profile_ids, ARRAY[]::uuid[]))
    )
  );
END;
$function$;

-- ---------------------------------------------------------------------------
-- 4. Konfirmasi dan penolakan klaim stok dibatasi cabang
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.confirm_stock_claim(p_claim_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_profile_id uuid := (SELECT public.current_profile_id());
  v_claim      public.stock_claims%rowtype;
  v_item       public.inventory_items%rowtype;
  v_balance    numeric;
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN
    RAISE EXCEPTION 'Konfirmasi stok hanya bisa dilakukan oleh pengguna yang sudah masuk.';
  END IF;

  IF NOT (SELECT public.has_role(ARRAY['owner','admin_kasir','maintainer']::public.user_role[])) THEN
    RAISE EXCEPTION 'Hanya owner, admin kasir, dan maintainer yang bisa mengonfirmasi klaim stok.';
  END IF;

  SELECT * INTO v_claim FROM public.stock_claims WHERE id = p_claim_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Klaim stok tidak ditemukan.';
  END IF;

  IF NOT COALESCE(public.can_access_branch(v_claim.branch_id), false) THEN
    RAISE EXCEPTION 'Klaim stok ini berada di luar cabang Anda.';
  END IF;

  IF v_claim.status <> 'pending' THEN
    RAISE EXCEPTION 'Klaim ini sudah % dan tidak bisa dikonfirmasi lagi.', v_claim.status;
  END IF;

  SELECT * INTO v_item FROM public.inventory_items WHERE id = v_claim.item_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Item stok tidak ditemukan.';
  END IF;

  IF v_item.current_stock < v_claim.quantity THEN
    RAISE EXCEPTION 'Stok % tidak cukup (tersisa %, diminta %).',
      v_item.item_name, v_item.current_stock, v_claim.quantity;
  END IF;

  v_balance := v_item.current_stock - v_claim.quantity;

  UPDATE public.inventory_items SET current_stock = v_balance WHERE id = v_item.id;

  INSERT INTO public.stock_logs (
    branch_id, item_id, log_type, quantity, balance_after, reference_id, created_by
  )
  VALUES (
    v_claim.branch_id, v_claim.item_id, 'out'::public.stock_log_type,
    v_claim.quantity, v_balance, v_claim.id, v_profile_id
  );

  UPDATE public.stock_claims
     SET status = 'confirmed', confirmed_by = v_profile_id, confirmed_at = now()
   WHERE id = p_claim_id;

  INSERT INTO public.activity_logs (actor_id, action, entity, entity_id, metadata)
  VALUES (
    v_profile_id, 'stock.claim_confirmed', 'stock_claims', p_claim_id,
    jsonb_build_object(
      'item_id', v_claim.item_id, 'quantity', v_claim.quantity,
      'balance_after', v_balance, 'branch_id', v_claim.branch_id
    )
  );
END;
$function$;

-- ---------------------------------------------------------------------------
-- 5. Policy yang hanya memeriksa role, sekarang ikut cabang
-- ---------------------------------------------------------------------------
-- can_access_branch sudah memberi akses global untuk owner dan maintainer,
-- jadi menambahkan pemeriksaan ini tidak mengubah perilaku mereka.

DROP POLICY IF EXISTS inventory_items_insert_privileged ON public.inventory_items;
CREATE POLICY inventory_items_insert_privileged ON public.inventory_items
  FOR INSERT
  WITH CHECK (
    public.has_role(ARRAY['owner','admin_kasir','maintainer']::public.user_role[])
    AND public.can_access_branch(branch_id)
  );

DROP POLICY IF EXISTS inventory_items_update_privileged ON public.inventory_items;
CREATE POLICY inventory_items_update_privileged ON public.inventory_items
  FOR UPDATE
  USING (
    public.has_role(ARRAY['owner','admin_kasir','maintainer']::public.user_role[])
    AND public.can_access_branch(branch_id)
  )
  WITH CHECK (
    public.has_role(ARRAY['owner','admin_kasir','maintainer']::public.user_role[])
    AND public.can_access_branch(branch_id)
  );

-- order_items tidak punya branch_id sendiri, jadi scoping lewat order induknya.
DROP POLICY IF EXISTS order_items_insert_privileged ON public.order_items;
CREATE POLICY order_items_insert_privileged ON public.order_items
  FOR INSERT
  WITH CHECK (
    public.has_role(ARRAY['owner','admin_kasir','maintainer']::public.user_role[])
    AND EXISTS (
      SELECT 1 FROM public.orders o
       WHERE o.id = order_id AND public.can_access_branch(o.branch_id)
    )
  );

DROP POLICY IF EXISTS order_items_update_privileged ON public.order_items;
CREATE POLICY order_items_update_privileged ON public.order_items
  FOR UPDATE
  USING (
    public.has_role(ARRAY['owner','admin_kasir','maintainer']::public.user_role[])
    AND EXISTS (
      SELECT 1 FROM public.orders o
       WHERE o.id = order_id AND public.can_access_branch(o.branch_id)
    )
  )
  WITH CHECK (
    public.has_role(ARRAY['owner','admin_kasir','maintainer']::public.user_role[])
    AND EXISTS (
      SELECT 1 FROM public.orders o
       WHERE o.id = order_id AND public.can_access_branch(o.branch_id)
    )
  );

DROP POLICY IF EXISTS stock_logs_insert_privileged ON public.stock_logs;
CREATE POLICY stock_logs_insert_privileged ON public.stock_logs
  FOR INSERT
  WITH CHECK (
    public.has_role(ARRAY['owner','admin_kasir','maintainer']::public.user_role[])
    AND public.can_access_branch(branch_id)
  );

-- Log stok adalah bukti. Setelah ditulis tidak boleh diedit atau dihapus,
-- termasuk oleh maintainer, karena_changes akan menghapus jejak.
DROP POLICY IF EXISTS stock_logs_update_privileged ON public.stock_logs;
DROP POLICY IF EXISTS stock_logs_delete_maintainer ON public.stock_logs;

-- warranty_claims juga tidak punya branch_id, scoping lewat order.
DROP POLICY IF EXISTS warranty_claims_select_privileged ON public.warranty_claims;
CREATE POLICY warranty_claims_select_privileged ON public.warranty_claims
  FOR SELECT
  USING (
    public.has_role(ARRAY['owner','admin_kasir','maintainer']::public.user_role[])
    AND EXISTS (
      SELECT 1 FROM public.orders o
       WHERE o.id = warranty_claims.order_id
         AND public.can_access_branch(o.branch_id)
    )
  );

DROP POLICY IF EXISTS warranty_claims_insert_privileged ON public.warranty_claims;
CREATE POLICY warranty_claims_insert_privileged ON public.warranty_claims
  FOR INSERT
  WITH CHECK (
    public.has_role(ARRAY['owner','admin_kasir','maintainer']::public.user_role[])
    AND EXISTS (
      SELECT 1 FROM public.orders o
       WHERE o.id = warranty_claims.order_id
         AND public.can_access_branch(o.branch_id)
    )
  );

DROP POLICY IF EXISTS warranty_claims_update_privileged ON public.warranty_claims;
CREATE POLICY warranty_claims_update_privileged ON public.warranty_claims
  FOR UPDATE
  USING (
    public.has_role(ARRAY['owner','admin_kasir','maintainer']::public.user_role[])
    AND EXISTS (
      SELECT 1 FROM public.orders o
       WHERE o.id = warranty_claims.order_id
         AND public.can_access_branch(o.branch_id)
    )
  )
  WITH CHECK (
    public.has_role(ARRAY['owner','admin_kasir','maintainer']::public.user_role[])
    AND EXISTS (
      SELECT 1 FROM public.orders o
       WHERE o.id = warranty_claims.order_id
         AND public.can_access_branch(o.branch_id)
    )
  );

DROP POLICY IF EXISTS warranty_claims_delete_privileged ON public.warranty_claims;
CREATE POLICY warranty_claims_delete_privileged ON public.warranty_claims
  FOR DELETE
  USING (
    public.has_role(ARRAY['owner','maintainer']::public.user_role[])
    AND EXISTS (
      SELECT 1 FROM public.orders o
       WHERE o.id = warranty_claims.order_id
         AND public.can_access_branch(o.branch_id)
    )
  );

-- Keputusan izin harus satu cabang.
DROP POLICY IF EXISTS time_off_decide_privileged ON public.time_off_requests;
CREATE POLICY time_off_decide_privileged ON public.time_off_requests
  FOR UPDATE
  USING (
    public.has_role(ARRAY['owner','admin_kasir','maintainer']::public.user_role[])
    AND EXISTS (
      SELECT 1 FROM public.profiles t
       WHERE t.id = profile_id AND public.can_access_branch(t.branch_id)
    )
  )
  WITH CHECK (
    public.has_role(ARRAY['owner','admin_kasir','maintainer']::public.user_role[])
    AND EXISTS (
      SELECT 1 FROM public.profiles t
       WHERE t.id = profile_id AND public.can_access_branch(t.branch_id)
    )
  );

DROP POLICY IF EXISTS time_off_select_own_or_privileged ON public.time_off_requests;
CREATE POLICY time_off_select_own_or_privileged ON public.time_off_requests
  FOR SELECT
  USING (
    profile_id = (SELECT public.current_profile_id())
    OR (
      public.has_role(ARRAY['owner','admin_kasir','maintainer']::public.user_role[])
      AND EXISTS (
        SELECT 1 FROM public.profiles t
         WHERE t.id = profile_id AND public.can_access_branch(t.branch_id)
      )
    )
  );

-- ----------------------------------------------------------------------------
-- 6. Index pendukung untuk query yang dipakai policy di atas
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS stock_logs_branch_id_idx
  ON public.stock_logs(branch_id, created_at DESC);
CREATE INDEX IF NOT EXISTS inventory_items_branch_id_idx
  ON public.inventory_items(branch_id);
CREATE INDEX IF NOT EXISTS warranty_claims_order_id_idx
  ON public.warranty_claims(order_id);
CREATE INDEX IF NOT EXISTS time_off_requests_profile_id_idx
  ON public.time_off_requests(profile_id);
CREATE INDEX IF NOT EXISTS orders_branch_status_idx
  ON public.orders(branch_id, status);
