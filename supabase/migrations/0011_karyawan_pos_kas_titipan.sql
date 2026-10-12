-- ============================================================================
-- RB AUTOLUXE - Migrasi 0011: Kas Titipan Karyawan & POS Karyawan
-- Proyek: qidtfssldidzvehssevk  |  Tanggal: 2026-10-13
-- Sifat: NON-DESTRUKTIF & IDEMPOTEN.
--
-- Latar: operasional cabang buka 07:30, kasir baru masuk ±10:00. Pada rentang
--   itu tidak ada kasir, sehingga karyawan harus bisa menerima order, membuat
--   struk, dan memegang uang tunai / QRIS / transfer milik pelanggan sebagai
--   KAS TITIPAN. Uang titipan wajib tercatat atas nama karyawan tersebut dan
--   hanya bisa divalidasi oleh admin kasir / owner / maintainer saat shift
--   dibuka (RPC open_shift_handoff sudah menghitungnya lewat
--   expected_cash_for_date).
--
-- Confidentialitas: karyawan TIDAK boleh melihat kas cabang maupun arus kas
--   perusahaan. Modul ini karena itu hanya mengekspos RPC my_cash_hold_today()
--   yang mengembalikan agregat milik MILIKNYA SENDIRI, bukan tabel cash_flow.
--
-- Isi:
--   1. Enum order_payment_state ('unpaid' | 'paid') + kolom pada orders:
--        payment_state, cash_hold_profile_id, cash_hold_amount,
--        cash_hold_payment_method, started_by.
--   2. create_pos_order_with_hold(): RPC POS yang menerima karyawan, mencatat
--      kas titipan bila dibayar, dan bisa langsung menstatuskan in_progress.
--   3. start_order_work(): karyawan boleh memulai order yang ia buat atau
--      menjadi anggota timnya; role manajerial bebas.
--   4. my_cash_hold_today(): agregat kas titipan milik pemanggil hari ini.
--   5. Index pendukung + REVOKE/GRANT yang konsisten dengan 0002.
-- ============================================================================

set search_path = public;

-- ---------------------------------------------------------------------------
-- 1. Tipe & kolom
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'order_payment_state' AND n.nspname = 'public'
  ) THEN
    CREATE TYPE public.order_payment_state AS ENUM ('unpaid', 'paid');
  END IF;
END
$$;

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS payment_state public.order_payment_state,
  ADD COLUMN IF NOT EXISTS cash_hold_profile_id uuid
    REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS cash_hold_amount numeric(12, 2),
  ADD COLUMN IF NOT EXISTS cash_hold_payment_method public.payment_method,
  ADD COLUMN IF NOT EXISTS started_by uuid
    REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS started_at timestamptz;

-- Backfill: order lama dianggap lunas karena create_pos_order lama selalu
-- menulis ke cash_flow sebagai 'in'.
UPDATE public.orders
   SET payment_state = 'paid'
 WHERE payment_state IS NULL;

ALTER TABLE public.orders
  ALTER COLUMN payment_state SET DEFAULT 'paid',
  ALTER COLUMN payment_state SET NOT NULL;

COMMENT ON COLUMN public.orders.payment_state IS
  'unpaid = bayar nanti (belum ada uang masuk), paid = sudah diterima';
COMMENT ON COLUMN public.orders.cash_hold_profile_id IS
  'Profil karyawan yang memegang kas titipan order ini; NULL bila(order cashier)';
COMMENT ON COLUMN public.orders.cash_hold_amount IS
  'Nominal kas titipan yang dipegang; NULL untuk order non-titipan';

CREATE INDEX IF NOT EXISTS orders_cash_hold_idx
  ON public.orders (cash_hold_profile_id, created_at DESC)
  WHERE cash_hold_profile_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS orders_payment_state_idx
  ON public.orders (payment_state)
  WHERE payment_state = 'unpaid';

-- ---------------------------------------------------------------------------
-- 2. create_pos_order_with_hold
--
--    Karyawan  : boleh membuat order. Bila 'paid', kas masuk cash_flow dengan
--                category 'employee_cash_hold' dan tercatat atas namanya.
--                Bila 'unpaid', TIDAK ada cash_flow sama sekali.
--    Manajerial: sama seperti create_pos_order lama (kas tetap category
--                'pos_order') supaya pembukuan kasir tidak berubah.
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
  v_item        jsonb;
  v_state       public.order_payment_state;
  v_category    text;
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN
    RAISE EXCEPTION 'Order hanya bisa dibuat oleh pengguna yang sudah masuk.';
  END IF;

  v_profile_id := (SELECT public.current_profile_id());
  IF v_profile_id IS NULL THEN
    RAISE EXCEPTION 'Sesi tidak valid.';
  END IF;

  v_role    := (SELECT p.role FROM public.profiles p WHERE p.id = v_profile_id);
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

  IF lower(COALESCE(p_payment_state, 'paid')) NOT IN ('paid', 'unpaid') THEN
    RAISE EXCEPTION 'Status pembayaran harus paid atau unpaid.';
  END IF;

  v_state := lower(COALESCE(p_payment_state, 'paid'))::public.order_payment_state;

  -- Role manajerial tidak diperbolehkan mencicil lewat kas titipan.
  IF v_is_staff AND v_state = 'unpaid' AND NOT COALESCE(p_start_work, false) THEN
    v_state := 'paid'::public.order_payment_state;
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    IF NOT (v_item ? 'name' AND v_item ? 'price') THEN
      RAISE EXCEPTION 'Setiap item wajib memiliki name dan price.';
    END IF;
    v_total := v_total + round(
      COALESCE((v_item->>'price')::numeric, 0)
      * COALESCE((v_item->>'qty')::numeric, 1), 2);
  END LOOP;

  IF v_total <= 0 THEN
    RAISE EXCEPTION 'Total transaksi harus lebih dari nol.';
  END IF;

  v_category := CASE WHEN v_is_staff THEN 'pos_order' ELSE 'employee_cash_hold' END;

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
    nullif(btrim(p_service_package), ''),
    v_total, p_payment_method,
    CASE WHEN COALESCE(p_start_work, false)
      THEN 'in_progress'::public.order_status
      ELSE 'queued'::public.order_status
    END,
    v_state,
    CASE WHEN v_is_staff THEN NULL ELSE v_profile_id END,
    CASE WHEN v_is_staff THEN NULL ELSE v_total END,
    CASE WHEN v_is_staff THEN NULL ELSE p_payment_method END,
    CASE WHEN COALESCE(p_start_work, false) THEN v_profile_id ELSE NULL END
  ) RETURNING * INTO v_order;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    INSERT INTO public.order_items (order_id, service_id, item_name, price, quantity)
    VALUES (
      v_order.id,
      NULLIF(v_item->>'service_id', '')::uuid,
      v_item->>'name',
      COALESCE((v_item->>'price')::numeric, 0),
      COALESCE((v_item->>'qty')::numeric, 1)
    );
  END LOOP;

  -- Uang benar-benar diterima hanya bila dibayar sekarang. Order 'unpaid'
  -- tidak boleh menyentuh tabel kas sama sekali.
  IF v_state = 'paid'::public.order_payment_state THEN
    INSERT INTO public.cash_flow (type, amount, category, description, payment_method)
    VALUES (
      'in'::public.cash_flow_type,
      v_total,
      v_category,
      v_order.order_number || ' - ' || COALESCE(v_order.service_package, '')
        || CASE WHEN v_is_staff THEN ''
                ELSE ' (kas titipan ' || COALESCE(v_role::text, 'karyawan') || ')' END,
      p_payment_method
    );
  END IF;

  RETURN v_order;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 3. start_order_work
--    Karyawan boleh memulai order yang ia buat sendiri atau order yang ia
--    masukkan sebagai anggota tim. Role manajerial bebas untuk seluruh order.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.start_order_work(p_order_id uuid)
RETURNS public.order_status
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_profile_id uuid;
  v_is_staff  boolean;
  v_order     public.orders%rowtype;
  v_next      public.order_status;
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN
    RAISE EXCEPTION 'Order hanya bisa diubah oleh pengguna yang sudah masuk.';
  END IF;

  v_profile_id := (SELECT public.current_profile_id());
  IF v_profile_id IS NULL THEN
    RAISE EXCEPTION 'Sesi tidak valid.';
  END IF;

  v_is_staff := COALESCE(public.has_role(
    ARRAY['owner', 'admin_kasir', 'maintainer']::public.user_role[]
  ), false);

  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order tidak ditemukan.';
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

  IF v_order.status <> 'queued'::public.order_status THEN
    RAISE EXCEPTION 'Order hanya bisa dimulai dari status Dalam Antrean.';
  END IF;

  UPDATE public.orders
     SET status       = 'in_progress'::public.order_status,
         started_by   = v_profile_id,
         started_at   = now()
   WHERE id = v_order.id
  RETURNING status INTO v_next;

  RETURN v_next;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 4. my_cash_hold_today
--    Agregat kas titipan milik pemanggil. Tidak ada parameter scope sehingga
--    karyawan tidak mungkin meminta data orang lain.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.my_cash_hold_today()
RETURNS TABLE (
  cash_amount     numeric,
  qris_amount     numeric,
  transfer_amount numeric,
  held_total     numeric,
  held_count     bigint,
  unpaid_total   numeric,
  unpaid_count   bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_profile_id uuid;
  v_today      date;
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN
    RAISE EXCEPTION 'Data kas titipan hanya bisa dibaca pengguna yang sudah masuk.';
  END IF;

  v_profile_id := (SELECT public.current_profile_id());
  IF v_profile_id IS NULL THEN
    RAISE EXCEPTION 'Sesi tidak valid.';
  END IF;

  v_today := (now() AT TIME ZONE 'Asia/Jakarta')::date;

  RETURN QUERY
  SELECT
    COALESCE(sum(o.cash_hold_amount) FILTER (WHERE o.payment_method = 'cash'::public.payment_method), 0),
    COALESCE(sum(o.cash_hold_amount) FILTER (WHERE o.payment_method = 'qris'::public.payment_method), 0),
    COALESCE(sum(o.cash_hold_amount) FILTER (WHERE o.payment_method = 'bank_transfer'::public.payment_method), 0),
    COALESCE(sum(o.cash_hold_amount), 0),
    count(*) FILTER (WHERE o.cash_hold_amount IS NOT NULL),
    COALESCE(sum(o.total_price) FILTER (WHERE o.payment_state = 'unpaid'::public.order_payment_state), 0),
    count(*) FILTER (WHERE o.payment_state = 'unpaid'::public.order_payment_state)
  FROM public.orders o
  WHERE o.cash_hold_profile_id = v_profile_id
    AND o.cash_hold_amount IS NOT NULL
    AND (o.created_at AT TIME ZONE 'Asia/Jakarta')::date = v_today;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 5. Hak eksekusi
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.create_pos_order_with_hold(
  text, text, public.vehicle_size, text, text, text, jsonb,
  public.payment_method, text, boolean
) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.create_pos_order_with_hold(
  text, text, public.vehicle_size, text, text, text, jsonb,
  public.payment_method, text, boolean
) TO authenticated;

REVOKE ALL ON FUNCTION public.start_order_work(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.start_order_work(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.my_cash_hold_today() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_cash_hold_today() TO authenticated;