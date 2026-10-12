-- ============================================================================
-- RB AUTOLUXE - Migrasi 0001: Rekonsiliasi Skema v3.0
-- Proyek: qidtfssldidzvehssevk  |  Tanggal: 2026-10-11
-- Sifat: NON-DESTRUKTIF. Tidak ada DROP untuk objek yang mungkin berisi data.
-- Sumber kebenaran: backendspec.md v3.0
--
-- Isi:
--   1. Enum baru + order_status 'cancelled'
--   2. Tabel baru (multi-cabang, katalog, item, klaim garansi, inventaris,
--      izin, komisi, notifikasi, jejak aktivitas) + RLS otomatis
--   3. Kolom tambahan pada tabel live (branch_id, cancellation_reason,
--      proof_photo_url) + backfill ke cabang default
--   4. View petty_cash (baca cash_flow tipe 'out')
--   5. Policy RLS baru + perbaikan policy ganda pada shifts
--   6. RPC baru: create_pos_order, cancel_order, guard_created_by_identity
--   7. Perbaikan advisory: search_path, revoke anon, indeks FK, indeks duplikat
-- ============================================================================

set search_path = public;

-- ============================================================================
-- 1. ENUM
-- ============================================================================
DO $$ BEGIN
  CREATE TYPE public.service_category AS ENUM ('wash','coating','detailing','other');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE public.warranty_claim_status AS ENUM ('pending','approved','rejected');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE public.commission_type AS ENUM ('percent','flat');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE public.time_off_type AS ENUM ('izin','cuti','sakit');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE public.time_off_status AS ENUM ('pending','approved','rejected');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE public.stock_log_type AS ENUM ('in','out');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TYPE public.order_status ADD VALUE IF NOT EXISTS 'cancelled';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================================
-- 2. TABEL BARU
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.branches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_name VARCHAR(100) NOT NULL UNIQUE,
  address TEXT NOT NULL DEFAULT '',
  latitude NUMERIC(10,7) NULL,
  longitude NUMERIC(10,7) NULL,
  geofence_radius_meters NUMERIC(6,2) NOT NULL DEFAULT 30.0,
  operating_open_time TIME NOT NULL DEFAULT '07:30:00',
  operating_close_time TIME NOT NULL DEFAULT '21:00:00',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.branches ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.services (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL,
  category public.service_category NOT NULL DEFAULT 'wash',
  price_s NUMERIC(12,2) NOT NULL DEFAULT 0,
  price_m NUMERIC(12,2) NOT NULL DEFAULT 0,
  price_l NUMERIC(12,2) NOT NULL DEFAULT 0,
  price_xl NUMERIC(12,2) NOT NULL DEFAULT 0,
  price_motor NUMERIC(12,2) NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.services ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.bundling_packages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  package_name VARCHAR(100) NOT NULL,
  description TEXT,
  total_price NUMERIC(12,2) NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.bundling_packages ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.bundling_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id UUID NOT NULL REFERENCES public.bundling_packages(id) ON DELETE CASCADE,
  service_id UUID NOT NULL REFERENCES public.services(id) ON DELETE RESTRICT
);
ALTER TABLE public.bundling_items ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  service_id UUID NULL REFERENCES public.services(id) ON DELETE SET NULL,
  item_name VARCHAR(120) NOT NULL,
  price NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (price >= 0),
  quantity NUMERIC(10,2) NOT NULL DEFAULT 1 CHECK (quantity > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.inventory_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id UUID NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  item_name VARCHAR(100) NOT NULL,
  current_stock NUMERIC(10,2) NOT NULL DEFAULT 0,
  unit VARCHAR(20) NOT NULL DEFAULT 'ml',
  min_stock_alert NUMERIC(10,2) NOT NULL DEFAULT 5.0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.inventory_items ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.stock_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id UUID NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  item_id UUID NOT NULL REFERENCES public.inventory_items(id) ON DELETE CASCADE,
  log_type public.stock_log_type NOT NULL,
  quantity NUMERIC(10,2) NOT NULL CHECK (quantity > 0),
  balance_after NUMERIC(10,2) NOT NULL DEFAULT 0,
  reference_id UUID NULL,
  created_by UUID NULL REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.stock_logs ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.time_off_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  type public.time_off_type NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  reason TEXT NOT NULL,
  proof_photo_url TEXT,
  status public.time_off_status NOT NULL DEFAULT 'pending',
  approver_id UUID NULL REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  decided_at TIMESTAMPTZ NULL
);
ALTER TABLE public.time_off_requests ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.workshop_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id UUID NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  workshop_name VARCHAR(100) NOT NULL DEFAULT 'RB AUTOLUXE',
  latitude NUMERIC(10,7) NOT NULL,
  longitude NUMERIC(10,7) NOT NULL,
  radius_meters NUMERIC(6,2) NOT NULL DEFAULT 30.0,
  updated_by UUID NULL REFERENCES public.profiles(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.workshop_settings ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.commission_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  service_id UUID NULL REFERENCES public.services(id) ON DELETE SET NULL,
  commission_type public.commission_type NOT NULL DEFAULT 'percent',
  value NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (value >= 0),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by UUID NULL REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.commission_settings ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.warranty_claims (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES public.orders(id),
  claim_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  problem_description TEXT NOT NULL,
  proof_photo_url TEXT,
  status public.warranty_claim_status NOT NULL DEFAULT 'pending',
  resolution_note TEXT,
  handled_by UUID NULL REFERENCES public.profiles(id),
  created_by UUID NULL REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.warranty_claims ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  title VARCHAR(120) NOT NULL,
  body TEXT,
  category VARCHAR(40) NOT NULL DEFAULT 'system',
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  payload JSONB NULL,
  created_by UUID NULL REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.activity_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id UUID NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  action VARCHAR(60) NOT NULL,
  entity VARCHAR(40) NOT NULL,
  entity_id UUID NULL,
  metadata JSONB NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.activity_logs ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- 3. KOLOM TAMBAHAN PADA TABEL LIVE + BACKFILL CABANG DEFAULT
-- ============================================================================

ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS branch_id UUID NULL REFERENCES public.branches(id);
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS cancellation_reason TEXT;
ALTER TABLE public.cash_flow ADD COLUMN IF NOT EXISTS branch_id UUID NULL REFERENCES public.branches(id);
ALTER TABLE public.cash_flow ADD COLUMN IF NOT EXISTS proof_photo_url TEXT;
ALTER TABLE public.shift_handoffs ADD COLUMN IF NOT EXISTS branch_id UUID NULL REFERENCES public.branches(id);
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS branch_id UUID NULL REFERENCES public.branches(id);

-- Cabang default dibuat sekali (idempoten via unique branch_name)
INSERT INTO public.branches (branch_name, address, is_active)
SELECT 'Cabang Utama RB AUTOLUXE', '', TRUE
WHERE NOT EXISTS (SELECT 1 FROM public.branches WHERE branch_name = 'Cabang Utama RB AUTOLUXE');

-- Backfill: seluruh data live yang belum terikat cabang -> cabang default
DO $$
DECLARE v_branch_id uuid;
BEGIN
  SELECT id INTO v_branch_id FROM public.branches ORDER BY created_at ASC LIMIT 1;
  IF v_branch_id IS NULL THEN RETURN; END IF;

  UPDATE public.orders        SET branch_id = v_branch_id WHERE branch_id IS NULL;
  UPDATE public.cash_flow     SET branch_id = v_branch_id WHERE branch_id IS NULL;
  UPDATE public.shift_handoffs SET branch_id = v_branch_id WHERE branch_id IS NULL;
  UPDATE public.profiles      SET branch_id = v_branch_id WHERE branch_id IS NULL;
END $$;

-- ============================================================================
-- 4. VIEW PETTY CASH (kas keluar operasional, layar 11)
-- ============================================================================
CREATE OR REPLACE VIEW public.petty_cash AS
SELECT id, created_at, amount,
       COALESCE(category, 'petty_cash') AS category,
       description, proof_photo_url, branch_id, created_by,
       COALESCE(payment_method, 'cash') AS payment_method
FROM public.cash_flow
WHERE type = 'out';

-- ============================================================================
-- 5. POLICY RLS
-- Catatan: tabel baru tidak punya policy sebelumnya, sehingga CREATE POLICY
-- aman dijalankan sekali. Untuk perubahan pada objek lama (shifts) digunakan
-- DROP IF EXISTS + validasi keberadaan.
-- ============================================================================

-- branches
CREATE POLICY branches_select_authenticated ON public.branches FOR SELECT TO authenticated USING (true);
CREATE POLICY branches_maintainer_write ON public.branches FOR ALL TO authenticated
  USING (public.has_role(ARRAY['maintainer']::public.user_role[]))
  WITH CHECK (public.has_role(ARRAY['maintainer']::public.user_role[]));

-- services
CREATE POLICY services_select_authenticated ON public.services FOR SELECT TO authenticated USING (true);
CREATE POLICY services_insert_privileged ON public.services FOR INSERT TO authenticated
  WITH CHECK (public.has_role(ARRAY['owner','admin_kasir','maintainer']::public.user_role[]));
CREATE POLICY services_update_privileged ON public.services FOR UPDATE TO authenticated
  USING (public.has_role(ARRAY['owner','admin_kasir','maintainer']::public.user_role[]))
  WITH CHECK (public.has_role(ARRAY['owner','admin_kasir','maintainer']::public.user_role[]));
CREATE POLICY services_delete_maintainer ON public.services FOR DELETE TO authenticated
  USING (public.has_role(ARRAY['maintainer']::public.user_role[]));

-- order_items
CREATE POLICY order_items_select_authenticated ON public.order_items FOR SELECT TO authenticated USING (true);
CREATE POLICY order_items_insert_privileged ON public.order_items FOR INSERT TO authenticated
  WITH CHECK (public.has_role(ARRAY['owner','admin_kasir','maintainer']::public.user_role[]));
CREATE POLICY order_items_update_privileged ON public.order_items FOR UPDATE TO authenticated
  USING (public.has_role(ARRAY['owner','admin_kasir','maintainer']::public.user_role[]))
  WITH CHECK (public.has_role(ARRAY['owner','admin_kasir','maintainer']::public.user_role[]));
CREATE POLICY order_items_delete_maintainer ON public.order_items FOR DELETE TO authenticated
  USING (public.has_role(ARRAY['maintainer']::public.user_role[]));

-- bundling_packages & bundling_items
CREATE POLICY bundling_packages_public_select ON public.bundling_packages FOR SELECT TO authenticated USING (true);
CREATE POLICY bundling_packages_maintainer_write ON public.bundling_packages FOR ALL TO authenticated
  USING (public.has_role(ARRAY['maintainer']::public.user_role[]))
  WITH CHECK (public.has_role(ARRAY['maintainer']::public.user_role[]));
CREATE POLICY bundling_items_public_select ON public.bundling_items FOR SELECT TO authenticated USING (true);
CREATE POLICY bundling_items_maintainer_write ON public.bundling_items FOR ALL TO authenticated
  USING (public.has_role(ARRAY['maintainer']::public.user_role[]))
  WITH CHECK (public.has_role(ARRAY['maintainer']::public.user_role[]));

-- warranty_claims
CREATE POLICY warranty_claims_insert_privileged ON public.warranty_claims FOR INSERT TO authenticated
  WITH CHECK (public.has_role(ARRAY['owner','admin_kasir','maintainer']::public.user_role[]));
CREATE POLICY warranty_claims_select_authenticated ON public.warranty_claims FOR SELECT TO authenticated
  USING (public.has_role(ARRAY['owner','admin_kasir','maintainer']::public.user_role[]));
CREATE POLICY warranty_claims_update_privileged ON public.warranty_claims FOR UPDATE TO authenticated
  USING (public.has_role(ARRAY['owner','admin_kasir','maintainer']::public.user_role[]))
  WITH CHECK (public.has_role(ARRAY['owner','admin_kasir','maintainer']::public.user_role[]));
CREATE POLICY warranty_claims_delete_maintainer ON public.warranty_claims FOR DELETE TO authenticated
  USING (public.has_role(ARRAY['maintainer']::public.user_role[]));

-- inventory_items
CREATE POLICY inventory_items_select_privileged ON public.inventory_items FOR SELECT TO authenticated
  USING (public.has_role(ARRAY['owner','admin_kasir','maintainer']::public.user_role[]));
CREATE POLICY inventory_items_insert_privileged ON public.inventory_items FOR INSERT TO authenticated
  WITH CHECK (public.has_role(ARRAY['owner','admin_kasir','maintainer']::public.user_role[]));
CREATE POLICY inventory_items_update_privileged ON public.inventory_items FOR UPDATE TO authenticated
  USING (public.has_role(ARRAY['owner','admin_kasir','maintainer']::public.user_role[]))
  WITH CHECK (public.has_role(ARRAY['owner','admin_kasir','maintainer']::public.user_role[]));
CREATE POLICY inventory_items_delete_maintainer ON public.inventory_items FOR DELETE TO authenticated
  USING (public.has_role(ARRAY['maintainer']::public.user_role[]));

-- stock_logs
CREATE POLICY stock_logs_select_privileged ON public.stock_logs FOR SELECT TO authenticated
  USING (public.has_role(ARRAY['owner','admin_kasir','maintainer']::public.user_role[]));
CREATE POLICY stock_logs_insert_privileged ON public.stock_logs FOR INSERT TO authenticated
  WITH CHECK (public.has_role(ARRAY['owner','admin_kasir','maintainer']::public.user_role[]));
CREATE POLICY stock_logs_update_privileged ON public.stock_logs FOR UPDATE TO authenticated
  USING (public.has_role(ARRAY['owner','admin_kasir','maintainer']::public.user_role[]))
  WITH CHECK (public.has_role(ARRAY['owner','admin_kasir','maintainer']::public.user_role[]));
CREATE POLICY stock_logs_delete_maintainer ON public.stock_logs FOR DELETE TO authenticated
  USING (public.has_role(ARRAY['maintainer']::public.user_role[]));

-- time_off_requests
CREATE POLICY time_off_insert_own ON public.time_off_requests FOR INSERT TO authenticated
  WITH CHECK (profile_id = public.current_profile_id());
CREATE POLICY time_off_select_own_or_privileged ON public.time_off_requests FOR SELECT TO authenticated
  USING (profile_id = public.current_profile_id()
         OR public.has_role(ARRAY['owner','admin_kasir','maintainer']::public.user_role[]));
CREATE POLICY time_off_update_own ON public.time_off_requests FOR UPDATE TO authenticated
  USING (profile_id = public.current_profile_id())
  WITH CHECK (profile_id = public.current_profile_id());
CREATE POLICY time_off_approve_privileged ON public.time_off_requests FOR UPDATE TO authenticated
  USING (public.has_role(ARRAY['owner','maintainer']::public.user_role[]))
  WITH CHECK (public.has_role(ARRAY['owner','maintainer']::public.user_role[]));

-- workshop_settings
CREATE POLICY workshop_settings_select_maintainer ON public.workshop_settings FOR SELECT TO authenticated
  USING (public.has_role(ARRAY['maintainer']::public.user_role[]));
CREATE POLICY workshop_settings_write_maintainer ON public.workshop_settings FOR ALL TO authenticated
  USING (public.has_role(ARRAY['maintainer']::public.user_role[]))
  WITH CHECK (public.has_role(ARRAY['maintainer']::public.user_role[]));

-- commission_settings
CREATE POLICY commission_settings_select_privileged ON public.commission_settings FOR SELECT TO authenticated
  USING (public.has_role(ARRAY['owner','admin_kasir','maintainer']::public.user_role[]));
CREATE POLICY commission_settings_insert_privileged ON public.commission_settings FOR INSERT TO authenticated
  WITH CHECK (public.has_role(ARRAY['owner','admin_kasir','maintainer']::public.user_role[]));
CREATE POLICY commission_settings_update_privileged ON public.commission_settings FOR UPDATE TO authenticated
  USING (public.has_role(ARRAY['owner','admin_kasir','maintainer']::public.user_role[]))
  WITH CHECK (public.has_role(ARRAY['owner','admin_kasir','maintainer']::public.user_role[]));
CREATE POLICY commission_settings_delete_maintainer ON public.commission_settings FOR DELETE TO authenticated
  USING (public.has_role(ARRAY['maintainer']::public.user_role[]));

-- notifications
CREATE POLICY notifications_select_own ON public.notifications FOR SELECT TO authenticated
  USING (recipient_id = public.current_profile_id()
         OR public.has_role(ARRAY['owner','admin_kasir','maintainer']::public.user_role[]));
CREATE POLICY notifications_insert_privileged ON public.notifications FOR INSERT TO authenticated
  WITH CHECK (recipient_id = public.current_profile_id()
              OR public.has_role(ARRAY['owner','admin_kasir','maintainer']::public.user_role[]));
CREATE POLICY notifications_update_own ON public.notifications FOR UPDATE TO authenticated
  USING (recipient_id = public.current_profile_id())
  WITH CHECK (recipient_id = public.current_profile_id());

-- activity_logs
CREATE POLICY activity_logs_select_privileged ON public.activity_logs FOR SELECT TO authenticated
  USING (public.has_role(ARRAY['owner','admin_kasir','maintainer']::public.user_role[]));
CREATE POLICY activity_logs_insert_privileged ON public.activity_logs FOR INSERT TO authenticated
  WITH CHECK (public.has_role(ARRAY['owner','admin_kasir','maintainer']::public.user_role[]));

-- Perbaikan advisory: policy SELECT ganda pada shifts.
DROP POLICY IF EXISTS shifts_maintainer_write ON public.shifts;
CREATE POLICY shifts_maintainer_write ON public.shifts FOR INSERT TO authenticated
  WITH CHECK (public.has_role(ARRAY['maintainer']::public.user_role[]));
CREATE POLICY shifts_maintainer_update ON public.shifts FOR UPDATE TO authenticated
  USING (public.has_role(ARRAY['maintainer']::public.user_role[]))
  WITH CHECK (public.has_role(ARRAY['maintainer']::public.user_role[]));
CREATE POLICY shifts_maintainer_delete ON public.shifts FOR DELETE TO authenticated
  USING (public.has_role(ARRAY['maintainer']::public.user_role[]));

-- ============================================================================
-- 6. RPC & TRIGGER
-- ============================================================================

-- 6a. Trigger umum identitas created_by (tabel baru)
CREATE OR REPLACE FUNCTION public.guard_created_by_identity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.created_by := (SELECT public.current_profile_id());
  ELSIF NEW.created_by IS DISTINCT FROM OLD.created_by THEN
    RAISE EXCEPTION 'Kolom created_by tidak dapat diubah.';
  END IF;
  RETURN NEW;
END;
$function$;

-- 6b. Perbaikan advisory search_path pada trigger yang sudah ada.
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO ''
AS $function$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.set_warranty_code()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO ''
AS $function$
BEGIN
  IF NEW.warranty_code IS NULL OR NEW.warranty_code = '' THEN
    NEW.warranty_code := 'WRT-' || upper(substr(replace(NEW.id::text, '-', ''), 1, 12));
  END IF;
  RETURN NEW;
END;
$function$;

-- 6c. Perluasan guard order: isi branch_id otomatis dari profil pemilik sesi.
CREATE OR REPLACE FUNCTION public.guard_order_identity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_role  public.user_role := (SELECT public.current_user_role());
  v_allow text[] := array['status', 'completed_at', 'updated_at'];
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.order_number  := public.next_order_number();
    NEW.tracking_token := public.new_tracking_token();

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

    IF (to_jsonb(NEW) - v_allow) IS DISTINCT FROM (to_jsonb(OLD) - v_allow) THEN
      RAISE EXCEPTION
        'Kolom order di luar daftar itu hanya dapat diubah oleh owner, admin kasir, atau maintainer.';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

-- 6d. Perluasan guard cash flow: isi branch_id pada insert.
CREATE OR REPLACE FUNCTION public.guard_cash_flow_identity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.created_by := (SELECT public.current_profile_id());
    NEW.branch_id  := COALESCE(
      NEW.branch_id,
      (SELECT p.branch_id FROM public.profiles p WHERE p.id = NEW.created_by)
    );
  ELSE
    IF NEW.created_by IS DISTINCT FROM OLD.created_by THEN
      RAISE EXCEPTION 'Kolom created_by pada arus kas tidak dapat diubah.';
    END IF;
    IF NEW.branch_id IS DISTINCT FROM OLD.branch_id THEN
      RAISE EXCEPTION 'Kolom branch_id pada arus kas tidak dapat diubah.';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

-- 6e. RPC create_pos_order
CREATE OR REPLACE FUNCTION public.create_pos_order(
  p_license_plate TEXT,
  p_vehicle_model TEXT,
  p_vehicle_size public.vehicle_size,
  p_customer_name TEXT,
  p_customer_phone TEXT,
  p_service_package TEXT,
  p_items JSONB,
  p_payment_method public.payment_method DEFAULT 'cash'
)
RETURNS public.orders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_profile_id uuid;
  v_order      public.orders%rowtype;
  v_total      numeric(12,2) := 0;
  v_item       jsonb;
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN
    RAISE EXCEPTION 'Order hanya bisa dibuat oleh pengguna yang sudah masuk.';
  END IF;

  IF NOT (SELECT public.has_role(ARRAY['owner','admin_kasir','maintainer']::public.user_role[])) THEN
    RAISE EXCEPTION 'Hanya owner, admin kasir, dan maintainer yang bisa membuat order POS.';
  END IF;

  v_profile_id := (SELECT public.current_profile_id());
  IF v_profile_id IS NULL THEN
    RAISE EXCEPTION 'Sesi tidak valid.';
  END IF;

  IF NULLIF(btrim(p_license_plate), '') IS NULL THEN
    RAISE EXCEPTION 'Plat nomor wajib diisi.';
  END IF;

  IF jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Rincian layanan POS tidak boleh kosong.';
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

  INSERT INTO public.orders (
    license_plate, vehicle_model, vehicle_size,
    customer_name, customer_phone, service_package,
    total_price, payment_method, status
  ) VALUES (
    upper(nullif(btrim(p_license_plate), '')),
    nullif(btrim(p_vehicle_model), ''),
    p_vehicle_size,
    nullif(btrim(p_customer_name), ''),
    nullif(btrim(p_customer_phone), ''),
    nullif(btrim(p_service_package), ''),
    v_total, p_payment_method, 'queued'::public.order_status
  ) RETURNING * INTO v_order;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    INSERT INTO public.order_items (order_id, service_id, item_name, price, quantity)
    VALUES (
      v_order.id,
      (v_item->>'service_id')::uuid,
      v_item->>'name',
      COALESCE((v_item->>'price')::numeric, 0),
      COALESCE((v_item->>'qty')::numeric, 1)
    );
  END LOOP;

  INSERT INTO public.cash_flow (type, amount, category, description, payment_method)
  VALUES (
    'in'::public.cash_flow_type,
    v_total,
    'pos_order',
    v_order.order_number || ' - ' || COALESCE(v_order.service_package, ''),
    p_payment_method
  );

  RETURN v_order;
END;
$function$;

-- 6f. RPC cancel_order
CREATE OR REPLACE FUNCTION public.cancel_order(p_order_id uuid, p_reason TEXT DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_order public.orders%rowtype;
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

  IF v_order.status NOT IN ('queued', 'in_progress') THEN
    RAISE EXCEPTION 'Hanya order berstatus antre atau dikerjakan yang bisa dibatalkan.';
  END IF;

  UPDATE public.orders
     SET status = 'cancelled'::public.order_status,
         cancellation_reason = nullif(btrim(coalesce(p_reason, '')), ''),
         completed_at = NULL,
         updated_at = now()
   WHERE id = p_order_id;

  INSERT INTO public.activity_logs (actor_id, action, entity, entity_id, metadata)
  VALUES (
    (SELECT public.current_profile_id()),
    'order.cancelled',
    'orders', p_order_id,
    jsonb_build_object('order_number', v_order.order_number, 'reason', p_reason)
  );
END;
$function$;

-- 6g. Pasang trigger set_updated_at pada tabel baru yang punya updated_at.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['branches','services','bundling_packages','inventory_items',
                          'commission_settings','warranty_claims']::text[] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_trigger
      WHERE tgname = t || '_set_updated_at' AND tgrelid = (t || '')::regclass::oid
    ) THEN
      EXECUTE format('CREATE TRIGGER %I AFTER UPDATE ON public.%I
                      FOR EACH ROW EXECUTE FUNCTION public.set_updated_at()',
                     t || '_set_updated_at', t);
    END IF;
  END LOOP;
END $$;

-- 6h. Pasang trigger guard_created_by_identity pada tabel yang punya created_by.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['commission_settings','warranty_claims','notifications',
                          'activity_logs','stock_logs']::text[] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_trigger
      WHERE tgname = t || '_guard_created_by' AND tgrelid = (t || '')::regclass::oid
    ) THEN
      EXECUTE format('CREATE TRIGGER %I BEFORE INSERT OR UPDATE ON public.%I
                      FOR EACH ROW EXECUTE FUNCTION public.guard_created_by_identity()',
                     t || '_guard_created_by', t);
    END IF;
  END LOOP;
END $$;

-- ============================================================================
-- 7. REMEDIASI ADVISORY
-- ============================================================================

-- Indeks FK yang belum tertutup (unindexed_foreign_keys)
CREATE INDEX IF NOT EXISTS cash_flow_created_by_idx        ON public.cash_flow (created_by);
CREATE INDEX IF NOT EXISTS orders_created_by_idx           ON public.orders (created_by);
CREATE INDEX IF NOT EXISTS profiles_shift_id_idx           ON public.profiles (shift_id);
CREATE INDEX IF NOT EXISTS shift_handoffs_shift_id_idx     ON public.shift_handoffs (shift_id);
CREATE INDEX IF NOT EXISTS shift_handoffs_opened_by_idx    ON public.shift_handoffs (opened_by);
CREATE INDEX IF NOT EXISTS shift_handoffs_closed_by_idx    ON public.shift_handoffs (closed_by);

-- Indeks untuk tabel baru
CREATE INDEX IF NOT EXISTS orders_branch_id_idx            ON public.orders (branch_id, created_at DESC);
CREATE INDEX IF NOT EXISTS cash_flow_branch_created_idx    ON public.cash_flow (branch_id, created_at DESC);
CREATE INDEX IF NOT EXISTS profiles_branch_id_idx          ON public.profiles (branch_id);
CREATE INDEX IF NOT EXISTS shift_handoffs_branch_date_idx  ON public.shift_handoffs (branch_id, shift_date DESC);
CREATE INDEX IF NOT EXISTS order_items_order_id_idx        ON public.order_items (order_id);
CREATE INDEX IF NOT EXISTS order_items_service_id_idx      ON public.order_items (service_id);
CREATE INDEX IF NOT EXISTS services_is_active_idx          ON public.services (is_active);
CREATE INDEX IF NOT EXISTS inventory_items_branch_idx      ON public.inventory_items (branch_id);
CREATE INDEX IF NOT EXISTS stock_logs_item_idx             ON public.stock_logs (item_id, created_at DESC);
CREATE INDEX IF NOT EXISTS stock_logs_branch_idx           ON public.stock_logs (branch_id);
CREATE INDEX IF NOT EXISTS warranty_claims_order_idx       ON public.warranty_claims (order_id);
CREATE INDEX IF NOT EXISTS warranty_claims_status_idx      ON public.warranty_claims (status);
CREATE INDEX IF NOT EXISTS commission_settings_profile_idx ON public.commission_settings (profile_id);
CREATE INDEX IF NOT EXISTS notifications_recipient_idx     ON public.notifications (recipient_id, is_read, created_at DESC);
CREATE INDEX IF NOT EXISTS activity_logs_entity_idx        ON public.activity_logs (entity, entity_id, created_at DESC);
CREATE INDEX IF NOT EXISTS time_off_profile_idx            ON public.time_off_requests (profile_id, start_date DESC);

-- Indeks duplikat (duplicate_index): constraint unik tetap, indeks duplikat dibuang
DROP INDEX IF EXISTS public.orders_tracking_token_idx;

-- Sempitkan permukaan anon: fungsi admin/helper tidak boleh dieksekusi via REST anon.
REVOKE EXECUTE ON FUNCTION
  public.current_profile_id(),
  public.current_user_role(),
  public.has_role(public.user_role[]),
  public.rls_auto_enable(),
  public.promote_profile_role(uuid, public.user_role),
  public.guard_attendance_photo(),
  public.handle_new_auth_user(),
  public.guard_created_by_identity(),
  public.create_pos_order(text, text, public.vehicle_size, text, text, text, jsonb, public.payment_method),
  public.cancel_order(uuid, text)
FROM anon;

-- Data integrity: order wajib punya cabang (trigger sudah memastikan saat insert).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.orders WHERE branch_id IS NULL
  ) THEN
    ALTER TABLE public.orders ALTER COLUMN branch_id SET NOT NULL;
  END IF;
END $$;

-- ============================================================================
-- 8. VERIFIKASI CETAK
-- ============================================================================
SELECT 'TABEL' AS objek, count(*)::text AS jumlah FROM pg_tables WHERE schemaname='public'
UNION ALL SELECT 'POLICY', count(*)::text FROM pg_policies WHERE schemaname='public'
UNION ALL SELECT 'RPC', count(*)::text FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public'
UNION ALL SELECT 'TRIGGER', count(*)::text FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
  WHERE NOT t.tgisinternal AND c.relnamespace='public'::regnamespace;