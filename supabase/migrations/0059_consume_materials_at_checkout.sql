-- 0059: pemakaian bahan dipotong saat checkout, catatan rinci, dan
-- pengembalian otomatis saat order dibatalkan.
--
-- Sebelumnya consume_order_materials hanya dipanggil saat order completed,
-- sehingga stok gudang baru berkurang setelah unit selesai dikerjakan.
-- Kebutuhan operasional: begitu kasir menekan checkout, bahan yang akan
-- dipakai langsung terpotong agar sisa stok di gudang mencerminkan unit yang
-- sudah masuk antrean.
--
-- Konsekuensinya order yang dibatalkan harus mengembalikan bahan. Karena itu
-- cancel_order memanggil restore_order_materials, dan kedua fungsi dibuat
-- idempoten supaya pemanggilan berulang (mis. apply_order_status saat
-- completed) tidak memotong atau mengembalikan dua kali.
--
-- Catatan stock_logs kini menyebut item, jumlah, satuan, nomor order, plat,
-- ukuran kendaraan, dan nama layanan, sehingga laporan stok bisa dibaca
-- tanpa membuka order.

-- ---------------------------------------------------------------------------
-- 1. Pemotongan bahan dengan catatan rinci
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.consume_order_materials(p_order_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_order public.orders%rowtype;
  v_cut   integer := 0;
  r       record;
BEGIN
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order tidak ditemukan.';
  END IF;

  -- Jangan potong dua kali untuk order yang sama. Catatan lama
  -- ('auto: pemakaian bahan order') tetap dikenali lewat prefiks.
  IF EXISTS (
    SELECT 1
      FROM public.stock_logs l
     WHERE l.reference_id = p_order_id
       AND l.log_type = 'out'::public.stock_log_type
       AND l.note LIKE 'auto: pemakaian bahan order%'
  ) THEN
    RETURN 0;
  END IF;

  FOR r IN
    SELECT oi.service_id,
           oi.quantity AS service_qty,
           rec.item_id,
           rec.quantity AS per_unit,
           s.name AS service_name
      FROM public.order_items oi
      JOIN public.service_material_recipes rec
        ON rec.service_id = oi.service_id
       AND rec.branch_id = v_order.branch_id
      JOIN public.services s
        ON s.id = oi.service_id
     WHERE oi.order_id = p_order_id
       AND oi.service_id IS NOT NULL
  LOOP
    DECLARE
      v_amount numeric;
      v_item   public.inventory_items%rowtype;
      v_balance numeric;
    BEGIN
      v_amount := round(r.per_unit * r.service_qty, 2);
      IF v_amount <= 0 THEN
        CONTINUE;
      END IF;

      SELECT * INTO v_item
        FROM public.inventory_items
       WHERE id = r.item_id
       FOR UPDATE;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'Item stok resep sudah tidak ada: %', r.item_id;
      END IF;

      -- Saldo boleh negatif. Menolak di sini akan menahan checkout hanya
      -- karena bahan habis, sedangkan selisihnya tetap terlihat di laporan
      -- stok dan opname.
      v_balance := round(v_item.current_stock - v_amount, 2);

      UPDATE public.inventory_items
         SET current_stock = v_balance,
             updated_at = now()
       WHERE id = r.item_id;

      INSERT INTO public.stock_logs (
        branch_id, item_id, log_type, quantity, balance_after,
        reference_id, created_by, note
      )
      VALUES (
        v_order.branch_id, r.item_id, 'out'::public.stock_log_type, v_amount,
        v_balance, p_order_id, public.current_profile_id(),
        'auto: pemakaian bahan order Â· ' || v_item.item_name
          || ' ' || trim_scale(v_amount) || ' ' || v_item.unit
          || ' untuk ' || v_order.order_number
          || ' (' || v_order.license_plate
          || ', ' || v_order.vehicle_size::text || ') â€” ' || r.service_name
      );

      v_cut := v_cut + 1;
    END;
  END LOOP;

  RETURN v_cut;
END;
$function$;

REVOKE ALL ON FUNCTION public.consume_order_materials(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_order_materials(uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- 2. Pengembalian bahan saat order dibatalkan
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.restore_order_materials(p_order_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_order public.orders%rowtype;
  v_item  public.inventory_items%rowtype;
  v_balance numeric;
  v_count integer := 0;
  r record;
BEGIN
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order tidak ditemukan.';
  END IF;

  -- Idempoten: satu pembatalan hanya mengembalikan sekali.
  IF EXISTS (
    SELECT 1
      FROM public.stock_logs l
     WHERE l.reference_id = p_order_id
       AND l.log_type = 'in'::public.stock_log_type
       AND l.note LIKE 'auto: pembatalan order%'
  ) THEN
    RETURN 0;
  END IF;

  -- Gabungkan per item supaya satu item yang dipakai beberapa layanan tetap
  -- menghasilkan satu baris pengembalian.
  FOR r IN
    SELECT l.item_id, sum(l.quantity) AS qty
      FROM public.stock_logs l
     WHERE l.reference_id = p_order_id
       AND l.log_type = 'out'::public.stock_log_type
       AND l.note LIKE 'auto: pemakaian bahan order%'
     GROUP BY l.item_id
     ORDER BY l.item_id
  LOOP
    SELECT * INTO v_item
      FROM public.inventory_items
     WHERE id = r.item_id
     FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Item stok sudah tidak ada: %', r.item_id;
    END IF;

    v_balance := round(v_item.current_stock + r.qty, 2);

    UPDATE public.inventory_items
       SET current_stock = v_balance,
           updated_at = now()
     WHERE id = r.item_id;

    INSERT INTO public.stock_logs (
      branch_id, item_id, log_type, quantity, balance_after,
      reference_id, created_by, note
    )
    VALUES (
      v_order.branch_id, r.item_id, 'in'::public.stock_log_type, r.qty,
      v_balance, p_order_id, public.current_profile_id(),
      'auto: pembatalan order Â· ' || v_item.item_name
        || ' ' || trim_scale(r.qty) || ' ' || v_item.unit
        || ' untuk ' || v_order.order_number
        || ' (' || v_order.license_plate
        || ', ' || v_order.vehicle_size::text || ')'
    );

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$function$;

REVOKE ALL ON FUNCTION public.restore_order_materials(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.restore_order_materials(uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- 3. Checkout langsung memotong bahan
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

  -- Bahan dipotong di sini, bukan menunggu completed. Fungsi ini idempoten,
  -- jadi pemanggilan berikutnya saat order selesai tidak memotong lagi.
  PERFORM public.consume_order_materials(v_order.id);

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
-- 4. Pembatalan mengembalikan bahan
-- ---------------------------------------------------------------------------
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

  PERFORM pg_catalog.set_config('app.trusted_order_write', 'on', true);

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

  PERFORM pg_catalog.set_config('app.trusted_order_write', 'off', true);

  -- Bahan yang sudah terpotong saat checkout dikembalikan ke gudang.
  PERFORM public.restore_order_materials(p_order_id);

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

