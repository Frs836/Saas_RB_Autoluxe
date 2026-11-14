-- 0120_fix_wash_no_qc_custom_price.sql
-- ============================================================
-- FIX 1: Wash tidak perlu QC dan karyawan tim bisa selesaikan
--        (menggantikan logika di 0107 dan 0118 yang mungkin
--         tidak ter-apply karena race condition)
--
-- FIX 2: Support custom price / promo di order items
--        Tambah kolom custom_price di order_items
--        Update create_pos_order_with_hold untuk menerima
--        custom price per item
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- FIX 1: apply_order_status final — wash tanpa QC, tim bisa selesaikan
-- ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.apply_order_status(
  p_order_id uuid,
  p_status   public.order_status
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_order        public.orders%rowtype;
  v_profile      uuid;
  v_started      timestamptz;
  v_warranty     text;
  v_reviewer     uuid;
  v_next_status  public.order_status;
  v_category     text;
  v_needs_qc     boolean;
  v_has_warranty boolean;
  v_is_manager   boolean;
  v_in_team      boolean;
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN
    RAISE EXCEPTION 'Perubahan status hanya bisa dilakukan oleh pengguna yang sudah masuk.';
  END IF;

  v_profile := (SELECT public.current_profile_id());
  IF v_profile IS NULL THEN RAISE EXCEPTION 'Sesi tidak valid.'; END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Order tidak ditemukan.'; END IF;

  IF NOT COALESCE(public.can_access_branch(v_order.branch_id), false) THEN
    RAISE EXCEPTION 'Order ini berada di luar cabang Anda.';
  END IF;

  v_category     := public.detect_service_category(COALESCE(v_order.service_package, ''));
  v_needs_qc     := public.category_needs_qc(v_category);
  v_has_warranty := public.category_has_warranty(v_category);

  v_is_manager := COALESCE((
    SELECT public.has_role(ARRAY[
      'owner','admin_kasir','maintainer','manager','kepala_karyawan'
    ]::public.user_role[])
  ), false);

  -- ── queued / qc_review → in_progress ──────────────────────
  IF p_status = 'in_progress'::public.order_status THEN
    IF v_order.status NOT IN ('queued','qc_review') THEN
      RAISE EXCEPTION 'Order hanya bisa dimulai dari status antre atau dikembalikan dari QC.';
    END IF;
    IF v_order.assigned_to IS NULL THEN
      RAISE EXCEPTION 'Order belum memiliki teknisi. Tetapkan tim terlebih dahulu.';
    END IF;

    PERFORM pg_catalog.set_config('app.trusted_order_write', 'on', true);
    UPDATE public.orders SET
      status     = 'in_progress',
      started_by = CASE WHEN v_order.status = 'queued' THEN v_profile ELSE started_by END,
      started_at = CASE WHEN v_order.status = 'queued' THEN now()     ELSE started_at END
    WHERE id = p_order_id;
    PERFORM pg_catalog.set_config('app.trusted_order_write', 'off', true);

    IF v_order.status = 'queued' THEN
      PERFORM public.consume_order_materials(p_order_id);
    ELSE
      INSERT INTO public.activity_logs (actor_id, action, entity, entity_id, metadata)
      VALUES (v_profile, 'order.qc_revision', 'order', p_order_id,
        jsonb_build_object('order_number', v_order.order_number,
                           'category', v_category, 'reason', 'QC gagal — revisi'));
    END IF;
    RETURN null;
  END IF;

  -- ── in_progress → qc_review ────────────────────────────────
  IF p_status = 'qc_review'::public.order_status THEN
    IF v_order.status <> 'in_progress' THEN
      RAISE EXCEPTION 'Hanya order yang sedang dikerjakan yang bisa masuk QC.';
    END IF;
    IF NOT v_needs_qc THEN
      RAISE EXCEPTION 'Paket "%" tidak memerlukan QC. Gunakan tombol Selesaikan.', v_order.service_package;
    END IF;

    PERFORM pg_catalog.set_config('app.trusted_order_write', 'on', true);
    UPDATE public.orders SET status = 'qc_review' WHERE id = p_order_id;
    PERFORM pg_catalog.set_config('app.trusted_order_write', 'off', true);

    INSERT INTO public.notifications (recipient_id, title, body, category, payload)
    SELECT p.id,
           'QC Review: ' || v_order.order_number,
           'Unit ' || v_order.license_plate || ' siap QC.',
           'order',
           jsonb_build_object('order_id', p_order_id, 'action', 'qc_review')
    FROM public.profiles p
    WHERE p.branch_id = v_order.branch_id
      AND p.role IN ('owner','admin_kasir','maintainer','manager','kepala_karyawan')
      AND p.is_active;
    RETURN null;
  END IF;

  -- ── → completed ─────────────────────────────────────────────
  IF p_status = 'completed'::public.order_status THEN

    IF v_needs_qc THEN
      -- Coating/Detailing: wajib dari qc_review, hanya manajerial
      IF v_order.status <> 'qc_review' THEN
        RAISE EXCEPTION 'Paket "%" harus melewati QC sebelum bisa diselesaikan.', v_order.service_package;
      END IF;
      IF NOT v_is_manager THEN
        RAISE EXCEPTION 'Penyelesaian QC hanya bisa dilakukan oleh kepala karyawan, manager, atau manajerial.';
      END IF;
    ELSE
      -- Wash: langsung dari in_progress, tim order ATAU manajerial
      IF v_order.status <> 'in_progress' THEN
        RAISE EXCEPTION 'Paket "%" hanya bisa diselesaikan saat sedang dikerjakan.', v_order.service_package;
      END IF;

      -- Cek apakah caller ada di tim order
      v_in_team := EXISTS (
        SELECT 1 FROM public.order_team_members t
         WHERE t.order_id = p_order_id AND t.profile_id = v_profile
      );

      IF NOT v_in_team AND NOT v_is_manager THEN
        RAISE EXCEPTION 'Hanya anggota tim order atau manajerial yang bisa menyelesaikan order ini.';
      END IF;
    END IF;

    v_started := now();
    IF v_order.payment_state = 'paid' THEN
      v_next_status := 'menunggu_diambil';
    ELSE
      v_next_status := 'menunggu_pembayaran';
    END IF;

    IF v_has_warranty THEN
      INSERT INTO public.warranties (order_id, warranty_code, start_date, end_date)
      VALUES (p_order_id, 'WRT-' || v_order.order_number, v_started, v_started + interval '180 days')
      ON CONFLICT (order_id) DO NOTHING
      RETURNING warranty_code INTO v_warranty;

      IF v_warranty IS NULL THEN
        SELECT w.warranty_code INTO v_warranty FROM public.warranties w WHERE w.order_id = p_order_id;
      END IF;

      SELECT o.assigned_to INTO v_reviewer FROM public.orders o WHERE o.id = p_order_id;
      IF v_reviewer IS NOT NULL THEN
        INSERT INTO public.notifications (recipient_id, title, body, category, payload)
        VALUES (v_reviewer, 'QC selesai: ' || v_order.order_number,
          'Garansi diterbitkan: ' || COALESCE(v_warranty, '-'), 'order',
          jsonb_build_object('order_id', p_order_id, 'warranty_code', v_warranty));
      END IF;
    END IF;

    PERFORM pg_catalog.set_config('app.trusted_order_write', 'on', true);
    UPDATE public.orders SET
      status = v_next_status, completed_at = v_started, updated_at = now()
    WHERE id = p_order_id;
    PERFORM pg_catalog.set_config('app.trusted_order_write', 'off', true);

    INSERT INTO public.activity_logs (actor_id, action, entity, entity_id, metadata)
    VALUES (v_profile, 'order.completed', 'order', p_order_id,
      jsonb_build_object('order_number', v_order.order_number, 'category', v_category,
        'warranty', v_has_warranty, 'warranty_code', v_warranty, 'routed_to', v_next_status::text));

    RETURN v_warranty;
  END IF;

  RAISE EXCEPTION 'Transisi status % tidak didukung.', p_status;
END;
$function$;

COMMENT ON FUNCTION public.apply_order_status IS
  '0120: Wash = tim order atau manajerial bisa selesaikan langsung. Coating/Detailing = wajib QC + hanya manajerial.';

-- ─────────────────────────────────────────────────────────────
-- FIX 2: Custom price support di order_items
-- ─────────────────────────────────────────────────────────────

-- Tambah kolom custom_price dan discount_amount ke order_items
ALTER TABLE public.order_items
  ADD COLUMN IF NOT EXISTS custom_price  numeric(12,2),
  ADD COLUMN IF NOT EXISTS discount_note text;

-- custom_price NULL = pakai harga katalog
-- custom_price IS NOT NULL = harga yang dipakai (setelah promo/nego)
-- discount_note = keterangan promo (opsional, contoh: "Promo lebaran -20%")

COMMENT ON COLUMN public.order_items.custom_price IS
  '0120: Harga custom setelah promo/nego. NULL = pakai harga katalog.';
COMMENT ON COLUMN public.order_items.discount_note IS
  '0120: Keterangan promo atau alasan penyesuaian harga.';

-- ─────────────────────────────────────────────────────────────
-- Update create_pos_order_with_hold untuk support custom price
-- Item JSON sekarang bisa punya field "custom_price" (opsional)
-- ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.create_pos_order_with_hold(
  p_license_plate   TEXT,
  p_vehicle_model   TEXT,
  p_vehicle_size    public.vehicle_size,
  p_customer_name   TEXT,
  p_customer_phone  TEXT,
  p_service_package TEXT,
  p_items           JSONB,
  p_payment_method  public.payment_method DEFAULT 'cash',
  p_payment_state   TEXT DEFAULT 'paid',
  p_start_work      BOOLEAN DEFAULT FALSE,
  p_team_ids        uuid[] DEFAULT NULL
)
RETURNS public.orders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_profile_id  uuid;
  v_role        public.user_role;
  v_is_staff    boolean;
  v_order       public.orders%rowtype;
  v_total       numeric(12,2) := 0;
  v_qty         numeric(12,2);
  v_price       numeric(12,2);
  v_custom_price numeric(12,2);
  v_final_price numeric(12,2);
  v_service     public.services%rowtype;
  v_service_id  uuid;
  v_names       text[] := ARRAY[]::text[];
  v_item        jsonb;
  v_state       public.order_payment_state;
  v_category    text;
  v_holds_cash  boolean;
  v_service_pkg text;
  v_team        uuid[] := COALESCE(p_team_ids, ARRAY[]::uuid[]);
  v_discount_note text;
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN
    RAISE EXCEPTION 'Order hanya bisa dibuat oleh pengguna yang sudah masuk.';
  END IF;

  v_profile_id := (SELECT public.current_profile_id());
  IF v_profile_id IS NULL THEN RAISE EXCEPTION 'Sesi tidak valid.'; END IF;

  v_role := (SELECT p.role FROM public.profiles p WHERE p.id = v_profile_id);
  v_is_staff := COALESCE(public.has_role(
    ARRAY['owner', 'admin_kasir', 'maintainer']::public.user_role[]
  ), false);

  IF v_role IS NULL THEN RAISE EXCEPTION 'Peran akun tidak dikenali.'; END IF;
  IF NOT v_is_staff AND v_role <> 'karyawan'::public.user_role THEN
    RAISE EXCEPTION 'Peran Anda tidak berwenang membuat order POS.';
  END IF;
  IF NULLIF(btrim(p_license_plate), '') IS NULL THEN
    RAISE EXCEPTION 'Plat nomor wajib diisi.';
  END IF;
  IF jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Rincian layanan POS tidak boleh kosong.';
  END IF;
  IF jsonb_array_length(p_items) > 40 THEN
    RAISE EXCEPTION 'Rincian layanan melebihi batas 40 baris.';
  END IF;
  IF lower(COALESCE(p_payment_state, 'paid')) NOT IN ('paid', 'unpaid') THEN
    RAISE EXCEPTION 'Status pembayaran harus paid atau unpaid.';
  END IF;
  IF COALESCE(p_start_work, false) AND array_length(v_team, 1) IS NULL THEN
    RAISE EXCEPTION 'Pilih minimal satu teknisi sebelum memulai pengerjaan.';
  END IF;

  v_state := lower(COALESCE(p_payment_state, 'paid'))::public.order_payment_state;
  IF v_is_staff AND v_state = 'unpaid' AND NOT COALESCE(p_start_work, false) THEN
    v_state := 'paid'::public.order_payment_state;
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_service_id := NULLIF(v_item->>'service_id', '')::uuid;
    IF v_service_id IS NULL THEN
      RAISE EXCEPTION 'Setiap item harus menunjuk layanan di katalog.';
    END IF;

    v_qty := COALESCE((v_item->>'qty')::numeric, 1);
    IF v_qty <= 0 OR v_qty > 999 THEN
      RAISE EXCEPTION 'Jumlah tiap layanan harus di antara 1 dan 999.';
    END IF;

    SELECT s.* INTO v_service FROM public.services s WHERE s.id = v_service_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Layanan pada katalog tidak ditemukan.'; END IF;
    IF NOT COALESCE(v_service.is_active, false) THEN
      RAISE EXCEPTION 'Layanan % sedang tidak aktif.', v_service.name;
    END IF;

    v_price := public.service_price_for_size(v_service, p_vehicle_size);
    IF (v_price IS NULL OR v_price <= 0) AND p_vehicle_size::text LIKE 'Motor %' THEN
      v_price := v_service.price_motor;
    END IF;
    IF v_price IS NULL OR v_price <= 0 THEN
      RAISE EXCEPTION 'Layanan % tidak tersedia untuk ukuran kendaraan ini.', v_service.name;
    END IF;

    -- Cek custom price (promo/nego)
    v_custom_price := NULLIF((v_item->>'custom_price')::numeric, 0);
    v_discount_note := NULLIF(btrim(COALESCE(v_item->>'discount_note', '')), '');

    -- Validasi: custom price tidak boleh negatif, boleh 0 (gratis) untuk promo
    IF v_custom_price IS NOT NULL AND v_custom_price < 0 THEN
      RAISE EXCEPTION 'Harga custom tidak boleh negatif untuk layanan %.', v_service.name;
    END IF;

    -- Harga final: custom_price jika ada, otherwise harga katalog
    v_final_price := COALESCE(v_custom_price, v_price);
    v_total := v_total + round(v_final_price * v_qty, 2);
    v_names := v_names || v_service.name;
  END LOOP;

  IF v_total < 0 THEN RAISE EXCEPTION 'Total transaksi tidak boleh negatif.'; END IF;

  v_service_pkg := array_to_string(v_names, ', ');
  v_category := CASE WHEN v_is_staff THEN 'pos_order' ELSE 'employee_cash_hold' END;
  v_holds_cash := (NOT v_is_staff) AND v_state = 'paid'::public.order_payment_state;

  INSERT INTO public.orders (
    license_plate, vehicle_model, vehicle_size,
    customer_name, customer_phone, service_package,
    total_price, payment_method, status, payment_state,
    cash_hold_profile_id, cash_hold_amount, cash_hold_payment_method
  ) VALUES (
    upper(nullif(btrim(p_license_plate), '')),
    nullif(btrim(p_vehicle_model), ''),
    p_vehicle_size,
    nullif(btrim(p_customer_name), ''),
    nullif(btrim(p_customer_phone), ''),
    v_service_pkg,
    v_total, p_payment_method,
    'queued'::public.order_status,
    v_state,
    CASE WHEN v_holds_cash THEN v_profile_id END,
    CASE WHEN v_holds_cash THEN v_total END,
    CASE WHEN v_holds_cash THEN p_payment_method END
  ) RETURNING * INTO v_order;

  -- Insert order items dengan custom price jika ada
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_service_id  := NULLIF(v_item->>'service_id', '')::uuid;
    v_qty         := COALESCE((v_item->>'qty')::numeric, 1);
    v_custom_price := NULLIF((v_item->>'custom_price')::numeric, 0);
    v_discount_note := NULLIF(btrim(COALESCE(v_item->>'discount_note', '')), '');

    SELECT s.* INTO v_service FROM public.services s WHERE s.id = v_service_id;
    v_price := public.service_price_for_size(v_service, p_vehicle_size);
    IF (v_price IS NULL OR v_price <= 0) AND p_vehicle_size::text LIKE 'Motor %' THEN
      v_price := v_service.price_motor;
    END IF;
    v_final_price := COALESCE(v_custom_price, v_price);

    INSERT INTO public.order_items (order_id, service_id, item_name, price, quantity, custom_price, discount_note)
    VALUES (
      v_order.id,
      v_service_id,
      v_service.name,
      v_final_price,  -- harga yang digunakan (custom atau katalog)
      v_qty,
      v_custom_price,  -- NULL jika pakai harga katalog
      v_discount_note
    );
  END LOOP;

  IF v_state = 'paid'::public.order_payment_state THEN
    INSERT INTO public.cash_flow (type, amount, category, description, payment_method, order_id)
    VALUES ('in'::public.cash_flow_type, v_total, v_category,
      v_order.order_number || ' - ' || v_service_pkg
        || CASE WHEN v_is_staff THEN '' ELSE ' (kas titipan karyawan)' END,
      p_payment_method, v_order.id);
  END IF;

  IF COALESCE(p_start_work, false) THEN
    PERFORM public.assert_order_team(v_order.branch_id, v_team);
    PERFORM public.assert_staff_available(v_order.id, v_team);
    INSERT INTO public.order_team_members (order_id, profile_id, is_lead)
    SELECT v_order.id, member, member = v_team[1] FROM unnest(v_team) AS member;
    PERFORM pg_catalog.set_config('app.trusted_order_write', 'on', true);
    UPDATE public.orders SET
      status = 'in_progress', assigned_to = v_team[1],
      started_by = v_profile_id, started_at = now()
    WHERE id = v_order.id RETURNING * INTO v_order;
    PERFORM pg_catalog.set_config('app.trusted_order_write', 'off', true);
  ELSIF array_length(v_team, 1) IS NOT NULL THEN
    PERFORM public.assert_order_team(v_order.branch_id, v_team);
    PERFORM public.assert_staff_available(v_order.id, v_team);
    INSERT INTO public.order_team_members (order_id, profile_id, is_lead)
    SELECT v_order.id, member, member = v_team[1] FROM unnest(v_team) AS member;
    PERFORM pg_catalog.set_config('app.trusted_order_write', 'on', true);
    UPDATE public.orders SET assigned_to = v_team[1] WHERE id = v_order.id RETURNING * INTO v_order;
    PERFORM pg_catalog.set_config('app.trusted_order_write', 'off', true);
  END IF;

  INSERT INTO public.activity_logs (actor_id, action, entity, entity_id, metadata)
  VALUES (v_profile_id, 'order.create', 'order', v_order.id,
    jsonb_build_object(
      'order_number', v_order.order_number,
      'branch_id', v_order.branch_id,
      'total_price', v_total,
      'payment_method', p_payment_method::text,
      'payment_state', v_state::text,
      'cash_hold', v_holds_cash,
      'items', p_items,
      'team', to_jsonb(v_team),
      'harga_dari_katalog', true
    )
  );

  RETURN v_order;
END;
$function$;

REVOKE ALL ON FUNCTION public.create_pos_order_with_hold(
  text, text, public.vehicle_size, text, text, text, jsonb,
  public.payment_method, text, boolean, uuid[]
) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.create_pos_order_with_hold(
  text, text, public.vehicle_size, text, text, text, jsonb,
  public.payment_method, text, boolean, uuid[]
) TO authenticated;

COMMENT ON FUNCTION public.create_pos_order_with_hold IS
  '0120: Support custom_price dan discount_note per item untuk promo/nego harga.';
