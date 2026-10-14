-- 0022_server_side_pricing.sql
--
-- Harga POS dihitung ulang di server.
--
-- Masalah yang diperbaiki
-- ---------------------
-- create_pos_order_with_hold menjumlahkan (p_items->>'price') yang dikirim
-- browser. Angka itu tidak pernah dibandingkan dengan tabel services, jadi
-- siapa pun yang punya sesi POS bisa membuat order dengan harga sendiri.
-- Total yang sama ikut dipakai untuk order_items.price, cash_flow.amount, dan
-- cash_hold_amount, sehingga uang receivable, pembukuan kas, serta selisih tutup
-- shift ikut salah.
--
-- Prinsip: browser hanya memilih JENIS layanan. Server yang menentukan harga,
-- nama layanan, dan nama paket.
--
-- Semua pemeriksaan dibuat idempoten supaya migrasi ini aman dijalankan ulang.

-- ---------------------------------------------------------------------------
-- 1. Batas jumlah item dan jumlah per item
-- ---------------------------------------------------------------------------
-- Tiga lapis: constraint di tabel, default terkait di services, dan validasi
-- di fungsi. Yang penting fungsi, karena harga sudah tidak lagi dipercaya.

-- ---------------------------------------------------------------------------
-- 2. Harga dan paket dihitung server
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
  p_start_work      BOOLEAN DEFAULT FALSE
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

  v_state := lower(COALESCE(p_payment_state, 'paid'))::public.order_payment_state;

  IF v_is_staff AND v_state = 'unpaid' AND NOT COALESCE(p_start_work, false) THEN
    v_state := 'paid'::public.order_payment_state;
  END IF;

  -- Harga tidak lagi dibaca dari p_items. Yang dibaca hanya service_id dan qty.
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

    v_price := CASE p_vehicle_size
      WHEN 'S'     THEN v_service.price_s
      WHEN 'M'     THEN v_service.price_m
      WHEN 'L'     THEN v_service.price_l
      WHEN 'XL'    THEN v_service.price_xl
      WHEN 'Motor' THEN v_service.price_motor
    END;

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

  -- Paket layanan disusun dari katalog, bukan dari browser. Nama paket ikut
  -- menentukan penerbitan sertifikat garansi, jadi ia tidak boleh datang dari
  -- perangkat kasir.
  v_service_pkg := array_to_string(v_names, ', ');

  v_category := CASE WHEN v_is_staff THEN 'pos_order' ELSE 'employee_cash_hold' END;

  -- Uang dianggap benar-benar dipegang hanya bila dibayar sekarang.
  v_holds_cash := (NOT v_is_staff) AND v_state = 'paid'::public.order_payment_state;

  INSERT INTO public.orders (
    license_plate, vehicle_model, vehicle_size,
    customer_name, customer_phone, service_package,
    total_price, payment_method, status, payment_state,
    cash_hold_profile_id, cash_hold_amount, cash_hold_payment_method,
    started_by
  ) VALUES (
    upper(nullif(btrim(p_license_plate), '')),
    nullif(btrim(p_vehicle_model), ''),
    p_vehicle_size,
    nullif(btrim(p_customer_name), ''),
    nullif(btrim(p_customer_phone), ''),
    v_service_pkg,
    v_total, p_payment_method,
    CASE WHEN COALESCE(p_start_work, false)
      THEN 'in_progress'::public.order_status
      ELSE 'queued'::public.order_status
    END,
    v_state,
    CASE WHEN v_holds_cash THEN v_profile_id END,
    CASE WHEN v_holds_cash THEN v_total END,
    CASE WHEN v_holds_cash THEN p_payment_method END,
    CASE WHEN COALESCE(p_start_work, false) THEN v_profile_id ELSE NULL END
  ) RETURNING * INTO v_order;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_service_id := NULLIF(v_item->>'service_id', '')::uuid;
    v_qty := COALESCE((v_item->>'qty')::numeric, 1);

    SELECT s.* INTO v_service
      FROM public.services s
     WHERE s.id = v_service_id;

    v_price := CASE p_vehicle_size
      WHEN 'S'     THEN v_service.price_s
      WHEN 'M'     THEN v_service.price_m
      WHEN 'L'     THEN v_service.price_l
      WHEN 'XL'    THEN v_service.price_xl
      WHEN 'Motor' THEN v_service.price_motor
    END;

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

  -- Jejak audit. Sebelumnya pembuatan order POS sama sekali tidak tercatat,
  -- sehingga tidak ada cara untuk tahu siapa membuat order, berapa, dan berisi
  -- apa.
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
      'harga_dari_katalog', true
    )
  );

  RETURN v_order;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 3. cash_flow ditautkan ke order
-- ---------------------------------------------------------------------------
-- Sebelumnya kas hanya terhubung lewat teks deskripsi, sehingga pembatalan
-- order tidak bisa tahu baris mana yang harus dikoreksi. Kolom ini yang
-- memungkinkan koreksi kas saat order dibatalkan.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'cash_flow' AND column_name = 'order_id'
  ) THEN
    ALTER TABLE public.cash_flow
      ADD COLUMN order_id uuid REFERENCES public.orders(id) ON DELETE SET NULL;
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS cash_flow_order_id_idx ON public.cash_flow(order_id);

-- Backfill order lama dari awalan nomor order pada deskripsi.
UPDATE public.cash_flow cf
   SET order_id = o.id
  FROM public.orders o
 WHERE cf.order_id IS NULL
   AND cf.description LIKE o.order_number || '%';

-- ---------------------------------------------------------------------------
-- 4. Batas jumlah item di tabel
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'order_items_quantity_positive'
  ) THEN
    ALTER TABLE public.order_items
      ADD CONSTRAINT order_items_quantity_positive CHECK (quantity > 0 AND quantity <= 999);
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- 5. cash_flow tidak boleh nol atau negatif
-- ---------------------------------------------------------------------------
--(create_cash_transaction sudah memvalidasi, tapi policy INSERT membuat nilai
-- nol dan negatif bisa masuk lewat insert langsung.)

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'cash_flow_amount_positive'
  ) THEN
    ALTER TABLE public.cash_flow
      ADD CONSTRAINT cash_flow_amount_positive CHECK (amount > 0);
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- 6. Cash keluar wajib punya bukti
-- ---------------------------------------------------------------------------
-- Sama seperti butir 4: RPC mewajibkan foto, policy INSERT tidak.

DROP POLICY IF EXISTS cash_flow_insert_privileged ON public.cash_flow;

CREATE POLICY cash_flow_insert_privileged ON public.cash_flow
  FOR INSERT
  WITH CHECK (
    public.has_role(ARRAY['owner','admin_kasir','maintainer']::public.user_role[])
    AND public.can_access_branch(branch_id)
    AND amount > 0
    AND (type <> 'out'::public.cash_flow_type OR proof_photo_url IS NOT NULL)
  );

-- ---------------------------------------------------------------------------
-- 7. Nama layanan unik
-- ---------------------------------------------------------------------------
-- Resep bahan dan seed menunjuk layanan lewat nama. Dua baris dengan nama sama
-- membuat ambiguitas diam-diam.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.services GROUP BY name HAVING count(*) > 1
  ) THEN
    RAISE NOTICE 'Ada nama layanan duplikat. Dibiarkan apa adanya; constraint tidak dipasang agar migrasi tidak gagal.';
  ELSE
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint WHERE conname = 'services_name_unique'
    ) THEN
      ALTER TABLE public.services ADD CONSTRAINT services_name_unique UNIQUE (name);
    END IF;
  END IF;
END;
$$;