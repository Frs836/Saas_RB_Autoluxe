-- 0087: Cleanup All Test Data
-- HAPUS SEMUA data transaksional/keuangan/stok/absensi/face verification
-- Hanya sisakan role: maintainer, owner, admin_kasir, 1 karyawan

DO $$
BEGIN
  -- 1. Hapus data transaksional
  DELETE FROM order_inspections;
  DELETE FROM order_items;
  DELETE FROM order_team_members;
  DELETE FROM warranty_claims;
  DELETE FROM orders;
  DELETE FROM cash_flow;
  DELETE FROM shift_handoffs;
  DELETE FROM petty_cash;
  DELETE FROM warranties;
  DELETE FROM time_off_requests;
  DELETE FROM activity_logs;
  DELETE FROM notifications;
  DELETE FROM stock_logs;
  DELETE FROM stock_claims;
  DELETE FROM stock_opnames;
  DELETE FROM stock_opname_lines;
  DELETE FROM invoices;
  DELETE FROM service_material_recipes;

  -- 2. Reset face verification
  UPDATE profiles SET face_descriptor = NULL;

  -- 3. Hapus profiles KECUALI 4 role utama (maintainer, owner, admin_kasir, karyawan)
  DELETE FROM profiles 
  WHERE id NOT IN (
    SELECT id FROM profiles WHERE role IN ('owner','admin_kasir','maintainer','karyawan')
    LIMIT 4
  );

  -- 4. Hapus notifikasi semua
  DELETE FROM notifications;

  -- 5. Reset sequence
  ALTER SEQUENCE IF EXISTS orders_order_number_seq RESTART WITH 1;

  RAISE NOTICE 'Cleanup completed. Remaining profiles: %', (SELECT COUNT(*) FROM profiles);
END $$;
