# Backend Specification RB AUTOLUXE — Versi 3.0 (Rekonsiliasi Skema Live)

Dokumen ini adalah sumber kebenaran skema database PostgreSQL Supabase untuk aplikasi POS dan Operasional RB AUTOLUXE. Versi 3.0 merekonsiliasi **skema yang sudah hidup di database** (tabel, enum, fungsi, trigger, policy yang sudah terpasang dan berisi data) dengan **kebutuhan fitur seluruh layar frontend** (stitch design system) yang selama ini belum tertutup.

Prinsip perancangan:
- **Skema live adalah fondasi.** Nama tabel, kolom, enum, helper (`current_profile_id`, `current_user_role`, `has_role`, `current_jwt_role`, `next_order_number`, `new_tracking_token`), guard trigger, dan pola penamaan policy dipertahankan apa adanya agar data dan API yang sudah ada tidak rusak.
- **Migrasi non-destruktif.** Tidak ada `DROP` untuk objek berisi data. Semua tambahan memakai `IF NOT EXISTS` / `ADD VALUE IF NOT EXISTS` / `CREATE OR REPLACE`.
- **Multi-cabang ditambahkan** karena layar login multi-cabang, branch switcher owner, dan laporan keuangan harian per cabang membutuhkannya. Model keamanan tetap berbasis role seperti live (pola `*_insert_privileged`, `*_select_authenticated`, `*_delete_maintainer`).
- Modul baru hanya dibuat bila benar-benar diminta oleh layar/plan: `branches`, `services` (POS + size matrix), `bundling_*`, `order_items` (POS itemized), `warranty_claims` (klaim komplain), `inventory_*` (stok obat), `time_off_requests`, `workshop_settings` (geofence), `commission_settings` (komisi staf), `notifications` + `activity_logs` (pusat notifikasi), `petty_cash` (view atas `cash_flow`).

Versi 2.0 dianggap digantikan (skemanya berbeda dari yang terpasang di database).

---

## 1. Arsitektur Database PostgreSQL (Supabase)

### 1.1 Custom Types & Enums

Tipe yang SUDAH ADA di live (dipakai apa adanya, TIDAK diubah urutan anggotanya):

```sql
user_role            ('karyawan','admin_kasir','owner','maintainer')
vehicle_size         ('S','M','L','XL','Motor')
order_status         ('queued','in_progress','qc_review','completed')  -- + 'cancelled' (ditambah)
payment_method       ('cash','qris','bank_transfer')
attendance_status    ('hadir','libur_shift','izin','sakit')
inspection_phase     ('before','process','after')
shift_handoff_status ('open','closed')
warranty_status      ('active','expired','claimed')  -- garansi terbit (issued)
cash_flow_type       ('in','out')
```

Tipe yang DITAMBAHKAN pada versi 3.0:

```sql
CREATE TYPE service_category AS ENUM (
  'wash','coating','detailing','other'
);

CREATE TYPE warranty_claim_status AS ENUM (
  'pending','approved','rejected'
);

CREATE TYPE commission_type AS ENUM (   -- cara hitung komisi staf
  'percent','flat'
);

CREATE TYPE time_off_type AS ENUM (
  'izin','cuti','sakit'
);

CREATE TYPE time_off_status AS ENUM (
  'pending','approved','rejected'
);

CREATE TYPE stock_log_type AS ENUM (
  'in','out'
);

ALTER TYPE order_status ADD VALUE IF NOT EXISTS 'cancelled';
```

### 1.2 Tabel Database (Rekonsiliasi v3)

#### Sudah Ada di Live (dokumentasi status)

| Tabel | Baris | Catatan |
| --- | --- | --- |
| `shifts` | 0 | shift kerja (name, start_time, end_time, bay_location) |
| `profiles` | 4 | `auth_id` FK ke `auth.users`; `role`, `shift_id`, `default_off_day`, `face_descriptor`, `is_active`. **v3 menambah kolom `branch_id`** |
| `attendance_logs` | 1 | absensi harian per profil (clock_in/out, GPS, foto, status hadir/izin/sakit/libur_shift) |
| `orders` | 20 | transaksi pengerjaan (order_number, tracking_token, vehicle_size, customer_name, service_package, total_price, payment_method, status, created_by, assigned_to). **v3 menambah `branch_id` dan `cancellation_reason`** |
| `order_inspections` | 33 | foto SOP before/process/after + public_id untuk tracking publik |
| `cash_flow` | 2 | arus kas (type in/out, amount, category, payment_method). **v3 menambah `proof_photo_url`** |
| `warranties` | 17 | garansi terbit (warranty_code, start/end_date, status active/expired/claimed) |
| `shift_handoffs` | 0 | serah terima kas (`opening_cash`, `expected_cash`, `actual_cash`, `difference`). **v3 menambah `branch_id`** |

#### Tabel Baru v3.0

```sql
-- 1. Cabang workshop (multi-branch, login & switcher owner)
CREATE TABLE branches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_name VARCHAR(100) NOT NULL UNIQUE,
  address TEXT NOT NULL DEFAULT '',
  latitude NUMERIC(10, 7) NULL,
  longitude NUMERIC(10, 7) NULL,
  geofence_radius_meters NUMERIC(6, 2) NOT NULL DEFAULT 30.0,
  operating_open_time TIME NOT NULL DEFAULT '07:30:00',
  operating_close_time TIME NOT NULL DEFAULT '21:00:00',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Katalog layanan POS + matriks harga per ukuran kendaraan (layar 5/5.1/6/17)
CREATE TABLE services (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL,
  category service_category NOT NULL DEFAULT 'wash',
  price_s NUMERIC(12, 2) NOT NULL DEFAULT 0,
  price_m NUMERIC(12, 2) NOT NULL DEFAULT 0,
  price_l NUMERIC(12, 2) NOT NULL DEFAULT 0,
  price_xl NUMERIC(12, 2) NOT NULL DEFAULT 0,
  price_motor NUMERIC(12, 2) NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. Paket bundling layanan
CREATE TABLE bundling_packages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  package_name VARCHAR(100) NOT NULL,
  description TEXT,
  total_price NUMERIC(12, 2) NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE bundling_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id UUID NOT NULL REFERENCES bundling_packages(id) ON DELETE CASCADE,
  service_id UUID NOT NULL REFERENCES services(id) ON DELETE RESTRICT
);

-- 4. Rincian item tiap order POS (POS itemized)
CREATE TABLE order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  service_id UUID NULL REFERENCES services(id) ON DELETE SET NULL,
  item_name VARCHAR(120) NOT NULL,
  price NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (price >= 0),
  quantity NUMERIC(10, 2) NOT NULL DEFAULT 1 CHECK (quantity > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 5. Inventaris bahan baku per cabang (layar 13)
CREATE TABLE inventory_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  item_name VARCHAR(100) NOT NULL,
  current_stock NUMERIC(10, 2) NOT NULL DEFAULT 0,
  unit VARCHAR(20) NOT NULL DEFAULT 'ml',
  min_stock_alert NUMERIC(10, 2) NOT NULL DEFAULT 5.0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE stock_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  item_id UUID NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
  log_type stock_log_type NOT NULL,
  quantity NUMERIC(10, 2) NOT NULL CHECK (quantity > 0),
  balance_after NUMERIC(10, 2) NOT NULL,
  reference_id UUID NULL,
  created_by UUID NULL REFERENCES profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 6. Pengajuan izin/cuti/sakit (modal approval, spec 6.9)
CREATE TABLE time_off_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  type time_off_type NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  reason TEXT NOT NULL,
  proof_photo_url TEXT,
  status time_off_status NOT NULL DEFAULT 'pending',
  approver_id UUID NULL REFERENCES profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  decided_at TIMESTAMPTZ NULL
);

-- 7. Setting geofence workshop per cabang (spec 6.10)
CREATE TABLE workshop_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  workshop_name VARCHAR(100) NOT NULL DEFAULT 'RB AUTOLUXE',
  latitude NUMERIC(10, 7) NOT NULL,
  longitude NUMERIC(10, 7) NOT NULL,
  radius_meters NUMERIC(6, 2) NOT NULL DEFAULT 30.0,
  updated_by UUID NULL REFERENCES profiles(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 8. Setelan komisi staf (layar 18)
CREATE TABLE commission_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  service_id UUID NULL REFERENCES services(id) ON DELETE SET NULL,
  commission_type commission_type NOT NULL DEFAULT 'percent',
  value NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (value >= 0),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by UUID NULL REFERENCES profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 9. Klaim garansi / komplain pelanggan (layar 12; beda dari `warranties` = garansi terbit)
CREATE TABLE warranty_claims (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id),
  claim_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  problem_description TEXT NOT NULL,
  proof_photo_url TEXT,
  status warranty_claim_status NOT NULL DEFAULT 'pending',
  resolution_note TEXT,
  handled_by UUID NULL REFERENCES profiles(id),
  created_by UUID NULL REFERENCES profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 10. Notifikasi pengguna & jejak aktivitas sistem (layar 20)
CREATE TABLE notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  title VARCHAR(120) NOT NULL,
  body TEXT,
  category VARCHAR(40) NOT NULL DEFAULT 'system',
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  payload JSONB NULL,
  created_by UUID NULL REFERENCES profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE activity_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id UUID NULL REFERENCES profiles(id) ON DELETE SET NULL,
  action VARCHAR(60) NOT NULL,
  entity VARCHAR(40) NOT NULL,
  entity_id UUID NULL,
  metadata JSONB NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 11. Kolom tambahan non-destruktif pada tabel live
ALTER TABLE orders ADD COLUMN IF NOT EXISTS branch_id UUID NULL REFERENCES branches(id);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS cancellation_reason TEXT;
ALTER TABLE cash_flow ADD COLUMN IF NOT EXISTS branch_id UUID NULL REFERENCES branches(id);
ALTER TABLE cash_flow ADD COLUMN IF NOT EXISTS proof_photo_url TEXT;
ALTER TABLE shift_handoffs ADD COLUMN IF NOT EXISTS branch_id UUID NULL REFERENCES branches(id);
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS branch_id UUID NULL REFERENCES branches(id);
```

#### View `petty_cash` (layar 11, kas keluar operasional)

`petty_cash` bukan tabel baru; dibaca dari `cash_flow` bertipe `out` sehingga angka laporan keuangan harian konsisten:

```sql
CREATE OR REPLACE VIEW petty_cash AS
SELECT id, created_at, amount, COALESCE(category, 'petty_cash') AS category,
       description, proof_photo_url, branch_id, created_by,
       COALESCE(payment_method, 'cash') AS payment_method
FROM cash_flow
WHERE type = 'out';
```

---

## 2. Kebijakan Keamanan (RLS)

Pola policy live (sudah terpasang) dipertahankan: `*_insert_privileged` (owner/admin_kasir/maintainer), `*_select_authenticated`, `*_update_*`, `*_delete_maintainer`, dengan helper `has_role(...)` dan `current_profile_id()`.

Policy DITAMBAHKAN untuk tabel baru dan tetap idempoten:

```sql
-- branches: baca semua yang login, tulis maintainer (pola shifts)
CREATE POLICY branches_select_authenticated ON branches FOR SELECT TO authenticated USING (TRUE);
CREATE POLICY branches_maintainer_write ON branches FOR ALL TO authenticated
  USING (has_role(ARRAY['maintainer'])) WITH CHECK (has_role(ARRAY['maintainer']));

-- services: katalog dibaca semua yang login, dikelola maintainer
CREATE POLICY services_select_authenticated ON services FOR SELECT TO authenticated USING (TRUE);
CREATE POLICY services_insert_privileged ON services FOR INSERT TO authenticated
  WITH CHECK (has_role(ARRAY['owner','admin_kasir','maintainer']));
CREATE POLICY services_update_privileged ON services FOR UPDATE TO authenticated
  USING (has_role(ARRAY['owner','admin_kasir','maintainer']))
  WITH CHECK (has_role(ARRAY['owner','admin_kasir','maintainer']));
CREATE POLICY services_delete_maintainer ON services FOR DELETE TO authenticated
  USING (has_role(ARRAY['maintainer']));

-- order_items: pola orders (kasir input via RPC create_pos_order)
CREATE POLICY order_items_select_authenticated ON order_items FOR SELECT TO authenticated USING (TRUE);
CREATE POLICY order_items_insert_privileged ON order_items FOR INSERT TO authenticated
  WITH CHECK (has_role(ARRAY['owner','admin_kasir','maintainer']));
CREATE POLICY order_items_update_privileged ON order_items FOR UPDATE TO authenticated
  USING (has_role(ARRAY['owner','admin_kasir','maintainer']))
  WITH CHECK (has_role(ARRAY['owner','admin_kasir','maintainer']));
CREATE POLICY order_items_delete_maintainer ON order_items FOR DELETE TO authenticated
  USING (has_role(ARRAY['maintainer']));

-- bundling_packages & bundling_items: katalog dapat dibaca, dikelola maintainer
CREATE POLICY bundling_packages_public_select  ON bundling_packages FOR SELECT TO authenticated USING (TRUE);
CREATE POLICY bundling_packages_maintainer_write ON bundling_packages FOR ALL TO authenticated
  USING (has_role(ARRAY['maintainer'])) WITH CHECK (has_role(ARRAY['maintainer']));
CREATE POLICY bundling_items_public_select  ON bundling_items FOR SELECT TO authenticated USING (TRUE);
CREATE POLICY bundling_items_maintainer_write ON bundling_items FOR ALL TO authenticated
  USING (has_role(ARRAY['maintainer'])) WITH CHECK (has_role(ARRAY['maintainer']));

-- warranty_claims (pola cash_flow)
CREATE POLICY warranty_claims_insert_privileged ON warranty_claims FOR INSERT TO authenticated
  WITH CHECK (has_role(ARRAY['owner','admin_kasir','maintainer']));
CREATE POLICY warranty_claims_select_authenticated ON warranty_claims FOR SELECT TO authenticated
  USING (has_role(ARRAY['owner','admin_kasir','maintainer']));
CREATE POLICY warranty_claims_update_privileged ON warranty_claims FOR UPDATE TO authenticated
  USING (has_role(ARRAY['owner','admin_kasir','maintainer']))
  WITH CHECK (has_role(ARRAY['owner','admin_kasir','maintainer']));
CREATE POLICY warranty_claims_delete_maintainer ON warranty_claims FOR DELETE TO authenticated
  USING (has_role(ARRAY['maintainer']));

-- inventory_items & stock_logs (pola cash_flow, cabang dijaga di aplikasi)
CREATE POLICY inventory_items_select_privileged ON inventory_items FOR SELECT TO authenticated
  USING (has_role(ARRAY['owner','admin_kasir','maintainer']));
CREATE POLICY inventory_items_insert_privileged ON inventory_items FOR INSERT TO authenticated
  WITH CHECK (has_role(ARRAY['owner','admin_kasir','maintainer']));
CREATE POLICY inventory_items_update_privileged ON inventory_items FOR UPDATE TO authenticated
  USING (has_role(ARRAY['owner','admin_kasir','maintainer']))
  WITH CHECK (has_role(ARRAY['owner','admin_kasir','maintainer']));
CREATE POLICY inventory_items_delete_maintainer ON inventory_items FOR DELETE TO authenticated
  USING (has_role(ARRAY['maintainer']));
CREATE POLICY stock_logs_select_privileged ON stock_logs FOR SELECT TO authenticated
  USING (has_role(ARRAY['owner','admin_kasir','maintainer']));
CREATE POLICY stock_logs_insert_privileged ON stock_logs FOR INSERT TO authenticated
  WITH CHECK (has_role(ARRAY['owner','admin_kasir','maintainer']));
CREATE POLICY stock_logs_update_privileged ON stock_logs FOR UPDATE TO authenticated
  USING (has_role(ARRAY['owner','admin_kasir','maintainer']))
  WITH CHECK (has_role(ARRAY['owner','admin_kasir','maintainer']));
CREATE POLICY stock_logs_delete_maintainer ON stock_logs FOR DELETE TO authenticated
  USING (has_role(ARRAY['maintainer']));

-- time_off_requests: pengajuan sendiri, persetujuan owner/maintainer
CREATE POLICY time_off_insert_own ON time_off_requests FOR INSERT TO authenticated
  WITH CHECK (profile_id = current_profile_id());
CREATE POLICY time_off_select_own_or_privileged ON time_off_requests FOR SELECT TO authenticated
  USING (profile_id = current_profile_id() OR has_role(ARRAY['owner','admin_kasir','maintainer']));
CREATE POLICY time_off_update_own ON time_off_requests FOR UPDATE TO authenticated
  USING (profile_id = current_profile_id()) WITH CHECK (profile_id = current_profile_id());
CREATE POLICY time_off_approve_privileged ON time_off_requests FOR UPDATE TO authenticated
  USING (has_role(ARRAY['owner','maintainer'])) WITH CHECK (has_role(ARRAY['owner','maintainer']));

-- workshop_settings: maintainer saja (spec 6.10)
CREATE POLICY workshop_settings_select_maintainer ON workshop_settings FOR SELECT TO authenticated
  USING (has_role(ARRAY['maintainer']));
CREATE POLICY workshop_settings_write_maintainer ON workshop_settings FOR ALL TO authenticated
  USING (has_role(ARRAY['maintainer'])) WITH CHECK (has_role(ARRAY['maintainer']));

-- commission_settings (pola cash_flow)
CREATE POLICY commission_settings_select_privileged ON commission_settings FOR SELECT TO authenticated
  USING (has_role(ARRAY['owner','admin_kasir','maintainer']));
CREATE POLICY commission_settings_insert_privileged ON commission_settings FOR INSERT TO authenticated
  WITH CHECK (has_role(ARRAY['owner','admin_kasir','maintainer']));
CREATE POLICY commission_settings_update_privileged ON commission_settings FOR UPDATE TO authenticated
  USING (has_role(ARRAY['owner','admin_kasir','maintainer']))
  WITH CHECK (has_role(ARRAY['owner','admin_kasir','maintainer']));
CREATE POLICY commission_settings_delete_maintainer ON commission_settings FOR DELETE TO authenticated
  USING (has_role(ARRAY['maintainer']));

-- notifications: milik penerima
CREATE POLICY notifications_select_own ON notifications FOR SELECT TO authenticated
  USING (recipient_id = current_profile_id() OR has_role(ARRAY['owner','admin_kasir','maintainer']));
CREATE POLICY notifications_insert_privileged ON notifications FOR INSERT TO authenticated
  WITH CHECK (recipient_id = current_profile_id() OR has_role(ARRAY['owner','admin_kasir','maintainer']));
CREATE POLICY notifications_update_own ON notifications FOR UPDATE TO authenticated
  USING (recipient_id = current_profile_id()) WITH CHECK (recipient_id = current_profile_id());

-- activity_logs: audit dibaca role manajerial
CREATE POLICY activity_logs_select_privileged ON activity_logs FOR SELECT TO authenticated
  USING (has_role(ARRAY['owner','admin_kasir','maintainer']));
CREATE POLICY activity_logs_insert_privileged ON activity_logs FOR INSERT TO authenticated
  WITH CHECK (has_role(ARRAY['owner','admin_kasir','maintainer']));
```

Perbaikan policy yang menyalahi best practice (advisory multi-permissive policy):
- `shifts` punya `shifts_maintainer_write` (cmd ALL) dan `shifts_select_authenticated`; keduanya menghasilkan permissive SELECT untuk `authenticated`. Solusi: `shifts_maintainer_write` dipersempit menjadi INSERT/UPDATE/DELETE saja.

```sql
DROP POLICY IF EXISTS shifts_maintainer_write ON shifts;
CREATE POLICY shifts_maintainer_write ON shifts FOR INSERT TO authenticated
  WITH CHECK (has_role(ARRAY['maintainer']));
DO $$
BEGIN
  IF to_regprocedure('public.some_noop()') IS NULL THEN
    CREATE POLICY shifts_maintainer_update ON shifts FOR UPDATE TO authenticated
      USING (has_role(ARRAY['maintainer'])) WITH CHECK (has_role(ARRAY['maintainer']));
    CREATE POLICY shifts_maintainer_delete ON shifts FOR DELETE TO authenticated
      USING (has_role(ARRAY['maintainer']));
  END IF;
END $$;
```

---

## 3. Database Triggers & Stored Functions

### 3.1 Fungsi yang Sudah Ada (dipetakan apa adanya)

- `current_profile_id()` / `current_user_role()` / `has_role(user_role[])` / `current_jwt_role()` → helper identitas, semua `SECURITY DEFINER SET search_path TO ''`.
- `next_order_number()` → `RBA-YYYYMMDD-NNN` dengan advisory lock harian.
- `new_tracking_token()` → 48 hex acak.
- `guard_order_identity` / `guard_cash_flow_identity` / `guard_profile_privileges` / `guard_attendance_photo` / `set_warranty_code` → trigger guard.
- `set_updated_at()` → trigger `updated_at = now()`.
- `apply_order_status(p_order_id uuid, p_status order_status)` → transisi status ketat, `completed_at`, dan terbitan garansi 1 bulan untuk paket coating.
- `assign_order_technician(p_order_id, p_assigned_to)` → penugasan karyawan.
- `open_shift_handoff(p_date, p_shift_id, p_opening_cash, p_notes)` / `close_shift_handoff(p_handoff_id, p_actual_cash, p_notes)` + `expected_cash_for_date(p_date, p_opening_cash)` → serah terima kas titipan (layar 10).
- `public_order_tracking(p_token)` / `public_order_inspections(p_token)` → tracking publik anon.
- `handle_new_auth_user()` trigger on `auth.users` → profil default `karyawan`.
- `promote_profile_role(p_auth_id, p_role)` → hanya `service_role`/`postgres`.
- `rls_auto_enable()` event trigger → RLS otomatis untuk tabel `public` baru.
- `ensure_weekly_off_day_for_self()` → auto input `libur_shift` di hari off.

### 3.2 RPC Baru v3.0

#### `create_pos_order` (POS Checkout, layar 5/5.1/6/6.1/7)

Satu transaksi atomik: membuat order (header + item dari rincian POS), membukukan arus kas masuk, dan menghasilkan nomor order + tracking token via trigger yang sudah ada.

```sql
CREATE OR REPLACE FUNCTION create_pos_order(
  p_license_plate TEXT,
  p_vehicle_model TEXT,
  p_vehicle_size public.vehicle_size,
  p_customer_name TEXT,
  p_customer_phone TEXT,
  p_service_package TEXT,
  p_items JSONB,              -- [{"name":..., "price":..., "qty":..., "service_id":?}]
  p_payment_method public.payment_method DEFAULT 'cash'
)
RETURNS orders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_profile_id uuid;
  v_branch_id  uuid;
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

  -- Rincian wajib minimal satu item dan total non-negatif.
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

  SELECT p.branch_id INTO v_branch_id FROM public.profiles p WHERE p.id = v_profile_id;

  INSERT INTO public.orders (
    license_plate, vehicle_model, vehicle_size,
    customer_name, customer_phone, service_package,
    total_price, payment_method, status, branch_id
  ) VALUES (
    upper(nullif(btrim(p_license_plate), '')),
    nullif(btrim(p_vehicle_model), ''),
    p_vehicle_size,
    nullif(btrim(p_customer_name), ''),
    nullif(btrim(p_customer_phone), ''),
    nullif(btrim(p_service_package), ''),
    v_total, p_payment_method, 'queued'::public.order_status,
    v_branch_id
  ) RETURNING * INTO v_order;

  -- Item rincian untuk nota & komisi.
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

  -- Pembukuan arus kas masuk; metode tunai ikut hitung kas titipan pagi.
  INSERT INTO public.cash_flow (type, amount, category, description, payment_method, branch_id)
  VALUES (
    'in'::public.cash_flow_type,
    v_total,
    'pos_order',
    v_order.order_number || ' - ' || COALESCE(v_order.service_package, ''),
    p_payment_method,
    v_branch_id
  );

  RETURN v_order;
END;
$function$;
```

#### `cancel_order` (Batalkan antrean, layar 4)

```sql
CREATE OR REPLACE FUNCTION cancel_order(p_order_id uuid, p_reason TEXT DEFAULT NULL)
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
```

#### Trigger umum identitas `created_by` untuk tabel baru

```sql
CREATE OR REPLACE FUNCTION guard_created_by_identity()
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
```

Dipasang pada `commission_settings`, `warranty_claims`, `notifications`, `activity_logs`, `stock_logs`.

#### Perbaikan advisory (search_path role-mutable)

```sql
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
```

#### Pengurangan permukaan serangan anon

Fungsi berikut TIDAK boleh dipanggil langsung oleh `anon` via REST; tracker publik (`public_order_tracking`, `public_order_inspections`) sengaja tetap anon:

```sql
REVOKE EXECUTE ON FUNCTION
  current_profile_id, current_user_role, has_role,
  rls_auto_enable, promote_profile_role, guard_attendance_photo,
  handle_new_auth_user, guard_created_by_identity, create_pos_order, cancel_order
FROM anon;
```

---

## 4. Remediasi Advisory (Database Linter)

| Advisory | Tindakan |
| --- | --- |
| `function_search_path_mutable` (set_updated_at, set_warranty_code) | `CREATE OR REPLACE ... SET search_path TO ''` (Bagian 3.2) |
| `anon_security_definer_function_executable` (9 fungsi) | `REVOKE EXECUTE ... FROM anon` |
| `unindexed_foreign_keys` (6 FK) | `CREATE INDEX IF NOT EXISTS` pada kolom FK |
| `duplicate_index` (orders_tracking_token_idx) | `DROP INDEX IF EXISTS orders_tracking_token_idx` (unik constraint tetap) |
| `multiple_permissive_policies` (shifts SELECT) | `shifts_maintainer_write` dipersempit ke INSERT + UPDATE/DELETE terpisah |
| `auth_leaked_password_protection` | Aktifkan di dashboard Supabase Auth (bukan SQL) |

---

## 5. Integrasi Storage Gambar Cloudinary

Tidak berubah dari v2. Client-Side Direct Unsigned Upload:
- `NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME` + upload preset `rb_autoluxe_preset`, endpoint `/v1_1/<CLOUD_NAME>/image/upload`, folder `rb_autoluxe/inspections` (dan `rb_autoluxe/attendances` untuk absensi).
- Kompresi browser: `.webp`, max lebar 1080px, kualitas 0.70, < 100 KB per foto.

---

## 6. Logika Verifikasi Wajah & GPS Geofencing Cabang

- Absensi biometrik: `face_descriptor` (float8[]) di `profiles`, `face_similarity_score` + `validation_score` di `attendance_logs`.
- Geofence: koordinat `branches(latitude, longitude)` + `geofence_radius_meters` (default 30 m), diverifikasi lewat Haversine (`check_gps_radius` versi lama dipakai ulang bila perlu) atau perhitungan client-side; setting per-cabang disimpan di `workshop_settings`.
- Harian jadwal: `ensure_weekly_off_day_for_self()` mengisi `libur_shift`.

---

## 7. Bluetooth Printer, WhatsApp, dan Ekspor Excel

- Printer thermal ESC/POS via Web Bluetooth (`navigator.bluetooth`, service UUID `000018f0-0000-1000-8000-00805f9b34fb`), mencetak nota dari `create_pos_order` (order_number `RBA-YYYYMMDD-NNN`, item dari `order_items`).
- Kirim nota/tracking ke pelanggan via `wa.me/628xxx?text=...` berisi rincian nota dan token `RBA-YYYYMMDD-PLAT` (layar 6.1/23).
- Ekspor laporan (Omzet, Petty Cash, Rekap Absensi & Keterlambatan) client-side dengan SheetJS (`xlsx`).

---

## 8. Catatan Data Awal (Seed, Idempoten)

- Satu cabang default (`Cabang Utama`) dibuat bila belum ada; seluruh data live yang belum terikat cabang (`orders`, `cash_flow`, `shift_handoffs`, `profiles`) di-backfill ke cabang itu. Ini memastikan laporan per cabang menampilkan data lama dengan benar.
- Katalog `services` sengaja TIDAK di-seed dengan harga (anti-rekaan); kasir membuat katalog via layar 17. `create_pos_order` tetap jalan dengan harga eksplisit dari item POS.