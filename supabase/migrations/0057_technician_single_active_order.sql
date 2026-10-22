-- 0057_technician_single_active_order.sql
--
-- Satu teknisi hanya boleh mengerjakan satu unit pada satu waktu. Sebelumnya
-- karyawan yang sama bisa dipilih menjadi tim di beberapa order sekaligus, lalu
-- memulai semuanya sehingga dua unit dikerjakan bersamaan oleh orang yang sama.
--
-- Aturan:
--   * Teknisi dianggap sibuk bila tercatat di tim order lain yang berstatus
--     in_progress atau qc_review (pekerjaan belum tuntas; qc_review masih bisa
--     dikembalikan untuk perbaikan).
--   * Penugasan (set_order_team / create_pos_order_with_hold) dan semua jalur
--     masuk in_progress (start_order_work / apply_order_status) menolak teknisi
--     yang sedang sibuk.
--   * Baris profil dikunci berurutan sebelum pemeriksaan, sehingga dua order
--     yang mencoba memakai teknisi sama pada saat bersamaan tidak bisa lolos
--     berdua (race condition).

CREATE OR REPLACE FUNCTION public.assert_staff_available(
  p_order_id uuid,
  p_ids uuid[]
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_ids  uuid[] := COALESCE(p_ids, ARRAY[]::uuid[]);
  v_id   uuid;
  v_nama text;
  v_busy text;
BEGIN
  IF array_length(v_ids, 1) IS NULL THEN
    RETURN;
  END IF;

  -- Kunci baris profil dalam urutan tetap supaya dua transaksi yang memakai
  -- teknisi tumpang tindih tidak saling mengunci (deadlock).
  PERFORM 1
     FROM public.profiles p
    WHERE p.id = ANY(v_ids)
    ORDER BY p.id
      FOR UPDATE;

  FOREACH v_id IN ARRAY v_ids LOOP
    SELECT o.order_number, p.full_name
      INTO v_busy, v_nama
      FROM public.order_team_members t
      JOIN public.orders o ON o.id = t.order_id
      JOIN public.profiles p ON p.id = t.profile_id
     WHERE t.profile_id = v_id
       AND o.id IS DISTINCT FROM p_order_id
       AND o.status IN ('in_progress'::public.order_status,
                        'qc_review'::public.order_status)
     ORDER BY o.started_at NULLS LAST
     LIMIT 1;

    IF v_busy IS NOT NULL THEN
      RAISE EXCEPTION
        'Teknisi % masih mengerjakan order %. Selesaikan order itu dulu sebelum memberi unit baru.',
        COALESCE(v_nama, 'yang dipilih'), v_busy;
    END IF;
  END LOOP;
END;
$function$;

REVOKE ALL ON FUNCTION public.assert_staff_available(uuid, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.assert_staff_available(uuid, uuid[]) TO authenticated;

-- ---------------------------------------------------------------------------
-- set_order_team: kunci order lebih dulu (sesuai urutan kunci start_order_work),
-- lalu tolak teknisi yang sedang mengerjakan unit lain.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_order_team(
  p_order_id uuid,
  p_profile_ids uuid[]
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_order_branch uuid;
  v_ids          uuid[] := COALESCE(p_profile_ids, ARRAY[]::uuid[]);
  v_lead         uuid;
BEGIN
  v_lead := v_ids[1];

  IF (SELECT auth.uid()) IS NULL THEN
    RAISE EXCEPTION 'Penugasan tim hanya bisa dilakukan oleh pengguna yang sudah masuk.';
  END IF;

  IF NOT COALESCE((SELECT public.has_role(
       ARRAY['owner','admin_kasir','maintainer']::public.user_role[])), false) THEN
    RAISE EXCEPTION 'Hanya owner, admin kasir, dan maintainer yang bisa menugaskan tim.';
  END IF;

  SELECT branch_id INTO v_order_branch
    FROM public.orders WHERE id = p_order_id
     FOR UPDATE;

  IF v_order_branch IS NULL THEN
    RAISE EXCEPTION 'Order tidak ditemukan.';
  END IF;

  IF NOT COALESCE(public.can_access_branch(v_order_branch), false) THEN
    RAISE EXCEPTION 'Order ini berada di luar cabang Anda.';
  END IF;

  PERFORM public.assert_order_team(v_order_branch, v_ids);
  PERFORM public.assert_staff_available(p_order_id, v_ids);

  DELETE FROM public.order_team_members WHERE order_id = p_order_id;

  INSERT INTO public.order_team_members (order_id, profile_id, is_lead)
  SELECT p_order_id, member, member = v_lead
    FROM unnest(v_ids) AS member;

  PERFORM pg_catalog.set_config('app.trusted_order_write', 'on', true);
  UPDATE public.orders
     SET assigned_to = v_lead
   WHERE id = p_order_id;
  PERFORM pg_catalog.set_config('app.trusted_order_write', 'off', true);

  INSERT INTO public.activity_logs (actor_id, action, entity, entity_id, metadata)
  VALUES (
    public.current_profile_id(),
    'order.team_assigned',
    'orders', p_order_id,
    jsonb_build_object(
      'order_number', (SELECT order_number FROM public.orders WHERE id = p_order_id),
      'branch_id', v_order_branch,
      'team', to_jsonb(v_ids),
      'lead', v_lead
    )
  );
END;
$function$;

-- ---------------------------------------------------------------------------
-- create_pos_order_with_hold: tim yang langsung dikerjakan harus bebas
-- ---------------------------------------------------------------------------
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
  v_service     public.services%rowtype;
  v_service_id  uuid;
  v_names       text[] := ARRAY[]::text[];
  v_item        jsonb;
  v_state       public.order_payment_state;
  v_category    text;
  v_holds_cash  boolean;
  v_service_pkg text;
  v_team        uuid[] := COALESCE(p_team_ids, ARRAY[]::uuid[]);
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN
    RAISE EXCEPTION 'Order hanya bisa dibuat oleh pengguna yang sudah masuk.';
  END IF;

  v_profile_id := (SELECT public.current_profile_id());
  IF v_profile_id IS NULL THEN
    RAISE EXCEPTION 'Sesi tidak valid.';
  END IF;

  v_role := (SELECT p.role FROM public.profiles p WHERE p.id = v_profile_id);
  v_is_staff := COALESCE(public.has_role(
    ARRAY['owner', 'admin_kasir', 'maintainer']::public.user_role[]
  ), false);

  IF v_role IS NULL THEN
    RAISE EXCEPTION 'Peran akun tidak dikenali.';
  END IF;

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
      RAISE EXCEPTION
        'Setiap item harus menunjuk layanan di katalog. Harga tidak lagi diterima dari perangkat kasir.';
    END IF;

    v_qty := COALESCE((v_item->>'qty')::numeric, 1);
    IF v_qty <= 0 OR v_qty > 999 THEN
      RAISE EXCEPTION 'Jumlah tiap layanan harus di antara 1 dan 999.';
    END IF;

    SELECT s.* INTO v_service
      FROM public.services s
     WHERE s.id = v_service_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Layanan pada katalog tidak ditemukan.';
    END IF;

    IF NOT COALESCE(v_service.is_active, false) THEN
      RAISE EXCEPTION 'Layanan % sedang tidak aktif dan tidak bisa dijual.', v_service.name;
    END IF;

    v_price := public.service_price_for_size(v_service, p_vehicle_size);

    IF v_price IS NULL OR v_price <= 0 THEN
      IF p_vehicle_size::text LIKE 'Motor %' THEN
        v_price := v_service.price_motor;
      END IF;
    END IF;

    IF v_price IS NULL OR v_price <= 0 THEN
      RAISE EXCEPTION
        'Layanan % tidak tersedia untuk ukuran kendaraan ini.',
        v_service.name;
    END IF;

    v_total := v_total + round(v_price * v_qty, 2);
    v_names := v_names || v_service.name;
  END LOOP;

  IF v_total <= 0 THEN
    RAISE EXCEPTION 'Total transaksi harus lebih dari nol.';
  END IF;

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

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_service_id := NULLIF(v_item->>'service_id', '')::uuid;
    v_qty := COALESCE((v_item->>'qty')::numeric, 1);

    SELECT s.* INTO v_service
      FROM public.services s
     WHERE s.id = v_service_id;

    v_price := public.service_price_for_size(v_service, p_vehicle_size);
    IF v_price IS NULL OR v_price <= 0 THEN
      IF p_vehicle_size::text LIKE 'Motor %' THEN
        v_price := v_service.price_motor;
      END IF;
    END IF;

    INSERT INTO public.order_items (order_id, service_id, item_name, price, quantity)
    VALUES (
      v_order.id,
      v_service_id,
      v_service.name,
      v_price,
      v_qty
    );
  END LOOP;

  IF v_state = 'paid'::public.order_payment_state THEN
    INSERT INTO public.cash_flow (
      type, amount, category, description, payment_method, order_id
    )
    VALUES (
      'in'::public.cash_flow_type,
      v_total,
      v_category,
      v_order.order_number || ' - ' || v_service_pkg
        || CASE WHEN v_is_staff THEN ''
                ELSE ' (kas titipan karyawan)' END,
      p_payment_method,
      v_order.id
    );
  END IF;

  IF COALESCE(p_start_work, false) THEN
    PERFORM public.assert_order_team(v_order.branch_id, v_team);
    PERFORM public.assert_staff_available(v_order.id, v_team);

    INSERT INTO public.order_team_members (order_id, profile_id, is_lead)
    SELECT v_order.id, member, member = v_team[1]
      FROM unnest(v_team) AS member;

    PERFORM pg_catalog.set_config('app.trusted_order_write', 'on', true);
    UPDATE public.orders
       SET status     = 'in_progress'::public.order_status,
           assigned_to = v_team[1],
           started_by = v_profile_id,
           started_at = now()
     WHERE id = v_order.id
    RETURNING * INTO v_order;
    PERFORM pg_catalog.set_config('app.trusted_order_write', 'off', true);
  ELSIF array_length(v_team, 1) IS NOT NULL THEN
    PERFORM public.assert_order_team(v_order.branch_id, v_team);
    PERFORM public.assert_staff_available(v_order.id, v_team);

    INSERT INTO public.order_team_members (order_id, profile_id, is_lead)
    SELECT v_order.id, member, member = v_team[1]
      FROM unnest(v_team) AS member;

    PERFORM pg_catalog.set_config('app.trusted_order_write', 'on', true);
    UPDATE public.orders
       SET assigned_to = v_team[1]
     WHERE id = v_order.id
    RETURNING * INTO v_order;
    PERFORM pg_catalog.set_config('app.trusted_order_write', 'off', true);
  END IF;

  INSERT INTO public.activity_logs (actor_id, action, entity, entity_id, metadata)
  VALUES (
    v_profile_id,
    'order.create',
    'order',
    v_order.id,
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

-- ---------------------------------------------------------------------------
-- start_order_work: teknisi harus bebas dari unit lain
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.start_order_work(p_order_id uuid)
RETURNS public.order_status
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_profile_id uuid;
  v_is_staff   boolean;
  v_order      public.orders%rowtype;
  v_next       public.order_status;
  v_team       uuid[];
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN
    RAISE EXCEPTION 'Order hanya bisa diubah oleh pengguna yang sudah masuk.';
  END IF;

  v_profile_id := (SELECT public.current_profile_id());
  IF v_profile_id IS NULL THEN
    RAISE EXCEPTION 'Sesi tidak valid.';
  END IF;

  v_is_staff := COALESCE((
    SELECT public.has_role(ARRAY['owner', 'admin_kasir', 'maintainer']::public.user_role[])
  ), false);

  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order tidak ditemukan.';
  END IF;

  IF NOT COALESCE(public.can_access_branch(v_order.branch_id), false) THEN
    RAISE EXCEPTION 'Order ini berada di luar cabang Anda.';
  END IF;

  IF NOT v_is_staff THEN
    IF v_order.created_by IS DISTINCT FROM v_profile_id
       AND NOT EXISTS (
         SELECT 1 FROM public.order_team_members t
          WHERE t.order_id = v_order.id AND t.profile_id = v_profile_id
       ) THEN
      RAISE EXCEPTION 'Anda hanya bisa memulai order yang Anda buat atau menjadi anggota timnya.';
    END IF;
  END IF;

  SELECT array_agg(t.profile_id) INTO v_team
    FROM public.order_team_members t
    JOIN public.profiles p ON p.id = t.profile_id
   WHERE t.order_id = v_order.id
     AND p.is_active
     AND p.role = 'karyawan'::public.user_role;

  IF array_length(v_team, 1) IS NULL THEN
    RAISE EXCEPTION 'Pilih minimal satu teknisi aktif sebelum memulai pengerjaan.';
  END IF;

  IF v_order.status <> 'queued'::public.order_status THEN
    RAISE EXCEPTION 'Order hanya bisa dimulai dari status Dalam Antrean.';
  END IF;

  PERFORM public.assert_staff_available(v_order.id, v_team);

  PERFORM pg_catalog.set_config('app.trusted_order_write', 'on', true);

  UPDATE public.orders
     SET status     = 'in_progress'::public.order_status,
         started_by = v_profile_id,
         started_at = now()
   WHERE id = v_order.id
  RETURNING status INTO v_next;

  PERFORM pg_catalog.set_config('app.trusted_order_write', 'off', true);

  RETURN v_next;
END;
$function$;

-- ---------------------------------------------------------------------------
-- apply_order_status: jalur transisi lain ikut memeriksa kesibukan teknisi
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
  v_team     uuid[];
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN
    RAISE EXCEPTION 'Status order hanya bisa diubah oleh pengguna yang sudah masuk.';
  END IF;

  v_officer := COALESCE((
    SELECT public.has_role(ARRAY['owner', 'admin_kasir', 'maintainer']::public.user_role[])
  ), false);

  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order tidak ditemukan.';
  END IF;

  IF NOT COALESCE(public.can_access_branch(v_order.branch_id), false) THEN
    RAISE EXCEPTION 'Order ini berada di luar cabang Anda.';
  END IF;

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

  IF p_status = 'in_progress' AND v_order.status <> 'in_progress' THEN
    SELECT array_agg(t.profile_id) INTO v_team
      FROM public.order_team_members t
      JOIN public.profiles p ON p.id = t.profile_id
     WHERE t.order_id = v_order.id
       AND p.is_active
       AND p.role = 'karyawan'::public.user_role;

    IF array_length(v_team, 1) IS NULL THEN
      RAISE EXCEPTION 'Pilih minimal satu teknisi aktif sebelum memulai pengerjaan.';
    END IF;

    PERFORM public.assert_staff_available(v_order.id, v_team);
  END IF;

  PERFORM pg_catalog.set_config('app.trusted_order_write', 'on', true);

  UPDATE public.orders
     SET status = p_status,
         completed_at = CASE
           WHEN p_status = 'completed' THEN now()
           WHEN v_order.status = 'completed' THEN NULL
           ELSE v_order.completed_at
         END
   WHERE id = p_order_id;

  PERFORM pg_catalog.set_config('app.trusted_order_write', 'off', true);

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
