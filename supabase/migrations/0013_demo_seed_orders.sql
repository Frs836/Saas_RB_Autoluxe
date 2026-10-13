-- ============================================================================
-- RB AUTOLUXE - Migrasi 0013: Re-seed Data Demo
-- Proyek: qidtfssldidzvehssevk  |  Tanggal: 2026-10-13
-- Sifat: NON-DESTRUKTIF & IDEMPOTEN.
--
-- Latar: data demo order/warranty/inspeksi ikut terhapus saat membersihkan
--   data uji. Migrasi ini membangun ulang himpunan demo yang realistis supaya
--   dasbor, laporan, rekap, dan lacak publik punya isi yang layak diuji.
--
-- Prinsip:
--   - Setiap INSERT dijaga `WHERE NOT EXISTS` sehingga aman dijalankan
--     berkali-kali dan tidak pernah menggandakan data.
--   - TIDAK menyentuh baris yang sudah ada. Hanya mengisi kekosongan.
--   - Nomor order memakai seri tanggal sendiri (20260901, 20261008, 20261010,
--     20261013) yang tidak bertabrakan dengan order lama, dan seluruh data anak
--     resolved ulang lewat order_number sehingga UUID foreign key selalu benar.
--   - Nilai profile dan service dicocokkan saat runtime lewat SELECT.
-- ============================================================================

set search_path = public;

DO $seed$
DECLARE
  v_branch   uuid;
  v_karyawan uuid;
  v_kasir    uuid;

  v_svc_wash     uuid;
  v_svc_poles    uuid;
  v_svc_snow     uuid;
  v_svc_coat_m   uuid;
  v_svc_coat_a   uuid;
  v_svc_coat_b   uuid;
  v_svc_interior uuid;
  v_svc_engine   uuid;
  v_svc_glass    uuid;
  v_svc_wax      uuid;

  -- Diisi setelah order dibuat, lewat resolusi ulang berdasarkan order_number.
  o_coat_exp uuid; o_coat_b uuid; o_poles uuid; o_cancel uuid;
  o_wash_a   uuid; o_wash_b   uuid; o_motor  uuid; o_qc      uuid;
  o_queue_a  uuid; o_queue_b  uuid;
BEGIN
  SELECT id INTO v_branch FROM public.branches ORDER BY created_at ASC LIMIT 1;
  IF v_branch IS NULL THEN
    RAISE NOTICE '0013 dilewati: belum ada cabang.';
    RETURN;
  END IF;

  SELECT id INTO v_karyawan FROM public.profiles
   WHERE role = 'karyawan' AND branch_id = v_branch AND is_active
   ORDER BY created_at LIMIT 1;

  SELECT id INTO v_kasir FROM public.profiles
   WHERE role = 'admin_kasir' AND branch_id = v_branch AND is_active
   ORDER BY created_at LIMIT 1;

  IF v_karyawan IS NULL OR v_kasir IS NULL THEN
    RAISE NOTICE '0013 dilewati: butuh minimal 1 karyawan dan 1 admin kasir aktif.';
    RETURN;
  END IF;

  SELECT id INTO v_svc_wash     FROM public.services WHERE name = 'Wash Biasa';
  SELECT id INTO v_svc_poles    FROM public.services WHERE name = 'Wash Poles (Polish Ringan)';
  SELECT id INTO v_svc_snow     FROM public.services WHERE name = 'Wash Salju (Snow Wash)';
  SELECT id INTO v_svc_coat_m   FROM public.services WHERE name = 'Coating Maintenance (1 Layer)';
  SELECT id INTO v_svc_coat_a   FROM public.services WHERE name = 'Coating Paket A - Nano Ceramic 1 Layer';
  SELECT id INTO v_svc_coat_b   FROM public.services WHERE name = 'Coating Paket B - Nano Ceramic 3 Layers';
  SELECT id INTO v_svc_interior FROM public.services WHERE name = 'Detailing Interior Deep Clean';
  SELECT id INTO v_svc_engine   FROM public.services WHERE name = 'Engine Bay Cleaning';
  SELECT id INTO v_svc_glass    FROM public.services WHERE name = 'Glass Coating Kaca Penuh';
  SELECT id INTO v_svc_wax      FROM public.services WHERE name = 'Tambah Wax / Sealant';

  ---------------------------------------------------------------------------
  -- 1. Order demo (10 order, 4 hari, lintas status)
  ---------------------------------------------------------------------------
  INSERT INTO public.orders (
    order_number, license_plate, vehicle_model, vehicle_size,
    customer_name, customer_phone, service_package, status, total_price,
    payment_method, tracking_token, created_by, branch_id, assigned_to,
    cancellation_reason, payment_state,
    cash_hold_profile_id, cash_hold_amount, cash_hold_payment_method,
    started_by, started_at, created_at, completed_at
  )
  SELECT v.order_number, v.plate, v.model, v.size,
         v.cust, v.phone, v.pkg, v.status, v.total,
         v.pay_method, public.new_tracking_token(),
         v.created_by, v_branch, v.assigned_to,
         v.cancel_reason, v.payment_state,
         v.hold_profile, v.hold_amount, v.hold_method,
         v.started_by, v.started_at, v.created_at, v.completed_at
    FROM (
      VALUES
        ('RBA-20260901-001','D 1234 FGH','Mitsubishi Xpander','L'::public.vehicle_size,
         'Agus Salim','081234567003',
         'Coating Paket A - Nano Ceramic 1 Layer','completed'::public.order_status,3200000.00,
         'cash'::public.payment_method, v_kasir, v_karyawan, NULL::text,
         'paid'::public.order_payment_state, NULL::uuid, NULL::numeric, NULL::public.payment_method,
         NULL::uuid, NULL::timestamptz,
         timestamptz '2026-09-01 01:00:00+00', timestamptz '2026-09-01 10:00:00+00'),

        ('RBA-20261008-001','B 9 ABC 123','Honda Brio','S'::public.vehicle_size,
         'Siti Nurhaliza','081234567002',
         'Coating Paket B - Nano Ceramic 3 Layers','completed'::public.order_status,2750000.00,
         'bank_transfer'::public.payment_method, v_kasir, v_karyawan, NULL::text,
         'paid'::public.order_payment_state, NULL::uuid, NULL::numeric, NULL::public.payment_method,
         NULL::uuid, NULL::timestamptz,
         timestamptz '2026-10-08 02:00:00+00', timestamptz '2026-10-08 09:30:00+00'),

        ('RBA-20261010-001','B1234EXA','Toyota Avanza','M'::public.vehicle_size,
         'Budi Santoso','081234567001',
         'Wash Poles (Polish Ringan)','completed'::public.order_status,195000.00,
         'qris'::public.payment_method, v_kasir, v_karyawan, NULL::text,
         'paid'::public.order_payment_state, NULL::uuid, NULL::numeric, NULL::public.payment_method,
         NULL::uuid, NULL::timestamptz,
         timestamptz '2026-10-10 01:05:00+00', timestamptz '2026-10-10 02:20:00+00'),

        ('RBA-20261010-002','B 1234 XYZ','Suzuki Ignis','S'::public.vehicle_size,
         'Rani Kusuma','081234567005',
         'Wash Biasa','cancelled'::public.order_status,35000.00,
         'cash'::public.payment_method, v_kasir, v_karyawan,
         'Pelanggan membatalkan, mobil dibawa pulang'::text,
         'paid'::public.order_payment_state, NULL::uuid, NULL::numeric, NULL::public.payment_method,
         NULL::uuid, NULL::timestamptz,
         timestamptz '2026-10-10 04:15:00+00', NULL::timestamptz),

        ('RBA-20261010-003','D 5678 ABC','Daihatsu Xenia','M'::public.vehicle_size,
         'Budi Pelanggan','081234567006',
         'Wash Biasa','completed'::public.order_status,45000.00,
         'cash'::public.payment_method, v_kasir, v_karyawan, NULL::text,
         'paid'::public.order_payment_state, NULL::uuid, NULL::numeric, NULL::public.payment_method,
         NULL::uuid, NULL::timestamptz,
         timestamptz '2026-10-10 05:00:00+00', timestamptz '2026-10-10 05:22:00+00'),

        ('RBA-20261010-004','B 1234  EZD','NINJA RR','Motor'::public.vehicle_size,
         'KURUS','081234567004',
         'Wash Salju (Snow Wash)','completed'::public.order_status,40000.00,
         'cash'::public.payment_method, v_kasir, v_karyawan, NULL::text,
         'paid'::public.order_payment_state, NULL::uuid, NULL::numeric, NULL::public.payment_method,
         NULL::uuid, NULL::timestamptz,
         timestamptz '2026-10-10 06:10:00+00', timestamptz '2026-10-10 06:25:00+00'),

        ('RBA-20261013-001','B 4321 KLM','Toyota Fortuner','L'::public.vehicle_size,
         'Rina Wijaya','081234567007',
         'Detailing Interior Deep Clean','in_progress'::public.order_status,1050000.00,
         'cash'::public.payment_method, v_karyawan, v_karyawan, NULL::text,
         'paid'::public.order_payment_state, v_karyawan, 1050000.00, 'cash'::public.payment_method,
         v_karyawan, timestamptz '2026-10-13 01:05:00+00',
         timestamptz '2026-10-13 00:55:00+00', NULL::timestamptz),

        ('RBA-20261013-002','B 5555 NOP','Honda Civic','M'::public.vehicle_size,
         'Dewi Lestari','081234567008',
         'Coating Maintenance (1 Layer)','qc_review'::public.order_status,1050000.00,
         'bank_transfer'::public.payment_method, v_kasir, v_karyawan, NULL::text,
         'paid'::public.order_payment_state, NULL::uuid, NULL::numeric, NULL::public.payment_method,
         v_karyawan, timestamptz '2026-10-13 02:00:00+00',
         timestamptz '2026-10-13 01:30:00+00', NULL::timestamptz),

        ('RBA-20261013-003','B 7777 QWE','Toyota Rush','M'::public.vehicle_size,
         'Fajar Nugroho','081234567009',
         'Wash Biasa','queued'::public.order_status,45000.00,
         'cash'::public.payment_method, v_kasir, NULL::uuid, NULL::text,
         'paid'::public.order_payment_state, NULL::uuid, NULL::numeric, NULL::public.payment_method,
         NULL::uuid, NULL::timestamptz,
         timestamptz '2026-10-13 03:00:00+00', NULL::timestamptz),

        ('RBA-20261013-004','B 8888 RTY','Yamaha NMAX','Motor'::public.vehicle_size,
         'Gita Ayu','081234567010',
         'Wash Salju (Snow Wash)','queued'::public.order_status,40000.00,
         'qris'::public.payment_method, v_karyawan, NULL::uuid, NULL::text,
         'unpaid'::public.order_payment_state, NULL::uuid, NULL::numeric, NULL::public.payment_method,
         NULL::uuid, NULL::timestamptz,
         timestamptz '2026-10-13 03:10:00+00', NULL::timestamptz)
    ) AS v(order_number, plate, model, size, cust, phone, pkg, status, total,
           pay_method, created_by, assigned_to, cancel_reason, payment_state,
           hold_profile, hold_amount, hold_method, started_by, started_at,
           created_at, completed_at)
   WHERE NOT EXISTS (
     SELECT 1 FROM public.orders o WHERE o.order_number = v.order_number
   );

  -- Resolusi id nyata lewat order_number. UUID tidak pernah di-hardcode supaya
  -- migrasi tetap aman walau order yang sama dibuat lewat RPC aplikasi.
  SELECT id INTO o_coat_exp FROM public.orders WHERE order_number = 'RBA-20260901-001';
  SELECT id INTO o_coat_b   FROM public.orders WHERE order_number = 'RBA-20261008-001';
  SELECT id INTO o_poles    FROM public.orders WHERE order_number = 'RBA-20261010-001';
  SELECT id INTO o_cancel   FROM public.orders WHERE order_number = 'RBA-20261010-002';
  SELECT id INTO o_wash_a   FROM public.orders WHERE order_number = 'RBA-20261010-003';
  SELECT id INTO o_wash_b   FROM public.orders WHERE order_number = 'RBA-20261010-004';
  SELECT id INTO o_motor    FROM public.orders WHERE order_number = 'RBA-20261013-001';
  SELECT id INTO o_qc       FROM public.orders WHERE order_number = 'RBA-20261013-002';
  SELECT id INTO o_queue_a  FROM public.orders WHERE order_number = 'RBA-20261013-003';
  SELECT id INTO o_queue_b  FROM public.orders WHERE order_number = 'RBA-20261013-004';

  ---------------------------------------------------------------------------
  -- 2. order_items
  ---------------------------------------------------------------------------
  INSERT INTO public.order_items (order_id, service_id, item_name, price, quantity)
  SELECT x.order_id, x.service_id, x.item_name, x.price, x.qty
    FROM (
      VALUES
        (o_coat_exp, v_svc_coat_a,   'Coating Paket A - Nano Ceramic 1 Layer', 2500000.00, 1),
        (o_coat_exp, v_svc_interior, 'Detailing Interior Deep Clean',           700000.00, 1),
        (o_coat_b,   v_svc_coat_b,   'Coating Paket B - Nano Ceramic 3 Layers',2500000.00, 1),
        (o_coat_b,   v_svc_glass,    'Glass Coating Kaca Penuh',                250000.00, 1),
        (o_poles,    v_svc_poles,    'Wash Poles (Polish Ringan)',             120000.00, 1),
        (o_poles,    v_svc_wax,      'Tambah Wax / Sealant',                    75000.00, 1),
        (o_cancel,   v_svc_wash,     'Wash Biasa',                              35000.00, 1),
        (o_wash_a,   v_svc_wash,     'Wash Biasa',                              45000.00, 1),
        (o_wash_b,   v_svc_snow,     'Wash Salju (Snow Wash)',                  40000.00, 1),
        (o_motor,    v_svc_interior, 'Detailing Interior Deep Clean',           800000.00, 1),
        (o_motor,    v_svc_engine,   'Engine Bay Cleaning',                     250000.00, 1),
        (o_qc,       v_svc_coat_m,   'Coating Maintenance (1 Layer)',          1050000.00, 1),
        (o_queue_a,  v_svc_wash,     'Wash Biasa',                              45000.00, 1),
        (o_queue_b,  v_svc_snow,     'Wash Salju (Snow Wash)',                  40000.00, 1)
    ) AS x(order_id, service_id, item_name, price, qty)
   WHERE x.order_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM public.order_items oi
        WHERE oi.order_id = x.order_id AND oi.item_name = x.item_name
     );

  ---------------------------------------------------------------------------
  -- 3. Tim pengerjaan
  ---------------------------------------------------------------------------
  INSERT INTO public.order_team_members (order_id, profile_id, is_lead)
  SELECT x.order_id, v_karyawan, true
    FROM (
      VALUES (o_coat_exp), (o_coat_b), (o_poles), (o_wash_a),
             (o_wash_b), (o_motor), (o_qc)
    ) AS x(order_id)
   WHERE x.order_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM public.order_team_members t
        WHERE t.order_id = x.order_id AND t.profile_id = v_karyawan
     );

  ---------------------------------------------------------------------------
  -- 4. Arus kas masuk hanya untuk order yang benar-benar dibayar
  ---------------------------------------------------------------------------
  INSERT INTO public.cash_flow (
    type, amount, category, description, payment_method,
    branch_id, created_by, created_at
  )
  SELECT
    'in'::public.cash_flow_type,
    o.total_price,
    CASE WHEN o.cash_hold_profile_id IS NOT NULL THEN 'employee_cash_hold'
         ELSE 'pos_order' END,
    o.order_number || ' - ' || o.service_package
      || CASE WHEN o.cash_hold_profile_id IS NOT NULL THEN ' (kas titipan karyawan)'
             ELSE '' END,
    o.payment_method,
    v_branch,
    o.created_by,
    o.created_at
  FROM public.orders o
  WHERE o.payment_state = 'paid'::public.order_payment_state
    AND NOT EXISTS (
      SELECT 1 FROM public.cash_flow c WHERE c.description LIKE o.order_number || '%'
    );

  ---------------------------------------------------------------------------
  -- 5. Garansi: coating & poles punya sertifikat, wash tidak
  ---------------------------------------------------------------------------
  INSERT INTO public.warranties (order_id, warranty_code, start_date, end_date, status)
  SELECT x.order_id, x.code, x.start_date, x.end_date, x.status
    FROM (
      VALUES
        (o_coat_exp, 'WRT-DEMO-COATA',  DATE '2026-09-01', DATE '2026-09-29', 'expired'::public.warranty_status),
        (o_coat_b,   'WRT-DEMO-COATB',  DATE '2026-10-08', DATE '2027-04-06', 'active'::public.warranty_status),
        (o_poles,    'WRT-DEMO-POLES1', DATE '2026-10-10', DATE '2027-04-08', 'active'::public.warranty_status),
        (o_qc,       'WRT-DEMO-QC',     DATE '2026-10-13', DATE '2027-04-11', 'active'::public.warranty_status)
    ) AS x(order_id, code, start_date, end_date, status)
   WHERE x.order_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM public.warranties w
        WHERE w.order_id = x.order_id OR w.warranty_code = x.code
     );

  ---------------------------------------------------------------------------
  -- 6. Catatan inspeksi before / process / after
  ---------------------------------------------------------------------------
  -- photo_url sengaja NULL. Seed ini semula menunjuk berkas seperti
  -- demo/coatm-002-before.webp, tetapi berkasnya tidak pernah diunggah ke
  -- bucket inspection-photos, sehingga halaman lacak publik menampilkan gambar
  -- rusak. Catatan inspeksi tetap dibuat karena nilainya informatif, sementara
  -- foto tidak boleh menjanjikan apa yang tidak ada.
  INSERT INTO public.order_inspections (order_id, phase, photo_url, notes, inspector_id, created_at)
  SELECT x.order_id, x.phase, x.photo_url, x.notes, v_karyawan, x.created_at
    FROM (
      VALUES
        (o_coat_exp, 'before'::public.inspection_phase, NULL::text, 'Cat lama tebal, perlu pretreatment.',      timestamptz '2026-09-01 01:05:00+00'),
        (o_coat_exp, 'after'::public.inspection_phase,  NULL::text,  'Hydrophobic terpasang, garansi 180 hari.', timestamptz '2026-09-01 09:55:00+00'),
        (o_coat_b,   'before'::public.inspection_phase, NULL::text, 'Bodi tanpa goresan, cat masih tebal.',    timestamptz '2026-10-08 02:05:00+00'),
        (o_coat_b,   'process'::public.inspection_phase,NULL::text,'Lapisan pertama sudah masuk.',            timestamptz '2026-10-08 05:40:00+00'),
        (o_coat_b,   'after'::public.inspection_phase,  NULL::text,  'Hydrophobic aktif, garansi 180 hari.',     timestamptz '2026-10-08 09:25:00+00'),
        (o_poles,    'before'::public.inspection_phase, NULL::text,    'Ada swirl mark halus pada pintu depan.',  timestamptz '2026-10-10 01:08:00+00'),
        (o_poles,    'after'::public.inspection_phase,  NULL::text,     'Kilap optimal, garansi aktif.',             timestamptz '2026-10-10 02:15:00+00'),
        (o_wash_a,   'before'::public.inspection_phase, NULL::text,     'Bodi bersih, tanpa goresan baru.',         timestamptz '2026-10-10 05:02:00+00'),
        (o_wash_a,   'after'::public.inspection_phase,  NULL::text,      'Hasil akhir memuaskan pelanggan.',        timestamptz '2026-10-10 05:20:00+00'),
        (o_wash_b,   'before'::public.inspection_phase, NULL::text,     'Motor kotor berat, perlu snow wash.',      timestamptz '2026-10-10 06:12:00+00'),
        (o_wash_b,   'after'::public.inspection_phase,  NULL::text,      'Bersih dan licin.',                        timestamptz '2026-10-10 06:23:00+00'),
        (o_motor,    'before'::public.inspection_phase, NULL::text, 'Kursi Etern penuh debu.',                  timestamptz '2026-10-13 01:00:00+00'),
        (o_qc,       'before'::public.inspection_phase, NULL::text,    'Cat penutup tidak rata di kap depan.',    timestamptz '2026-10-13 01:35:00+00'),
        (o_qc,       'after'::public.inspection_phase,  NULL::text,     'Menunggu pemeriksaan QC.',                 timestamptz '2026-10-13 03:40:00+00')
    ) AS x(order_id, phase, photo_url, notes, created_at)
   WHERE x.order_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM public.order_inspections oi
        WHERE oi.order_id = x.order_id AND oi.phase = x.phase
     );

  ---------------------------------------------------------------------------
  -- 7. Serah terima kas: satu tertutup (riwayat) + satu terbuka (hari ini)
  ---------------------------------------------------------------------------
  IF NOT EXISTS (SELECT 1 FROM public.shift_handoffs WHERE notes = 'Demo shift Riwayat') THEN
    INSERT INTO public.shift_handoffs (
      shift_date, opening_cash, expected_cash, unknown_method_cash, actual_cash,
      difference, status, notes, opened_by, closed_by, branch_id, opened_at, closed_at
    ) VALUES (
      (now() AT TIME ZONE 'Asia/Jakarta')::date - 7,
      500000, 1245000, 0, 1230000,
      -15000, 'closed'::public.shift_handoff_status, 'Demo shift Riwayat',
      v_kasir, v_kasir, v_branch,
      (now() AT TIME ZONE 'Asia/Jakarta')::date - 7 + time '00:55',
      (now() AT TIME ZONE 'Asia/Jakarta')::date - 7 + time '21:10'
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.shift_handoffs
     WHERE notes = 'Demo shift Aktif' AND status = 'open'::public.shift_handoff_status
  ) THEN
    INSERT INTO public.shift_handoffs (
      shift_date, opening_cash, expected_cash, unknown_method_cash,
      status, notes, opened_by, branch_id, opened_at
    ) VALUES (
      (now() AT TIME ZONE 'Asia/Jakarta')::date,
      750000, 750000, 0,
      'open'::public.shift_handoff_status, 'Demo shift Aktif',
      v_kasir, v_branch, now()
    );
  END IF;

  ---------------------------------------------------------------------------
  -- 8. Satu klaim garansi yang sedang diproses
  ---------------------------------------------------------------------------
  IF NOT EXISTS (
    SELECT 1 FROM public.warranty_claims
     WHERE problem_description = 'Demo: noda masih ada di panel pintu setelah 2 minggu'
  ) AND o_coat_b IS NOT NULL THEN
    -- proof_photo_url NULL, sama seperti foto inspeksi di atas. Berkas demo
    -- tidak pernah ada, sedangkan klaim ini sendiri tetap bernilai karena
    -- memuat kronologi keluhan pelanggan.
    INSERT INTO public.warranty_claims (
      order_id, claim_date, problem_description, proof_photo_url, status, created_by
    ) VALUES (
      o_coat_b, now() - interval '3 days',
      'Demo: noda masih ada di panel pintu setelah 2 minggu',
      NULL::text, 'pending'::public.warranty_claim_status, v_kasir
    );
  END IF;

  RAISE NOTICE '0013 re-seed selesai.';
END
$seed$;

-- Label warranty yang sudah lewat masa dikoreksi otomatis.
SELECT public.refresh_warranty_statuses();