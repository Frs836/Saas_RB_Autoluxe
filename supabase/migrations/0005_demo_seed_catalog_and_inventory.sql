-- ============================================================================
-- 0005_demo_seed_catalog_and_inventory.sql
-- Data awal (dummy) untuk mengisi katalog POS dan stok gudang cabang.
-- Sifat: non-destruktif + idempoten (aman dijalankan ulang).
--
-- Catatan: data ini adalah data contoh agar modul POS dapat diuji sebelum
-- pemilik mengisi layanan dan stok yang sebenarnya. Nama sengaja dibuat
-- realistis namun tetap merupakan contoh.
-- ============================================================================

-- Kolom penanda add-on pada layanan (dipakai layar POS untuk memisahkan
-- paket utama dari layanan tambahan).
ALTER TABLE public.services ADD COLUMN IF NOT EXISTS is_addon BOOLEAN NOT NULL DEFAULT FALSE;

-- ----------------------------------------------------------------------------
-- 1. Layanan / paket contoh (harga per klasifikasi ukuran unit)
--    price_motor = 0 berarti layanan tidak tersedia untuk motor.
-- ----------------------------------------------------------------------------
INSERT INTO public.services (name, category, price_s, price_m, price_l, price_xl, price_motor, is_active, is_addon)
SELECT v.name, v.category::public.service_category,
       v.price_s, v.price_m, v.price_l, v.price_xl, v.price_motor, TRUE, v.is_addon
FROM (VALUES
  ('Wash Biasa',                       'wash',      35000,   45000,   55000,   65000,  20000, FALSE),
  ('Wash Salju (Snow Wash)',           'wash',      50000,   65000,   80000,   95000,  25000, FALSE),
  ('Wash Poles (Polish Ringan)',       'wash',      75000,   95000,  120000,  150000,  40000, FALSE),
  ('Coating Paket A - Nano Ceramic 1 Layer', 'coating', 1500000, 2000000, 2500000, 3000000, 0, FALSE),
  ('Coating Paket B - Nano Ceramic 3 Layers','coating', 2500000, 3000000, 3500000, 4200000, 0, FALSE),
  ('Coating Maintenance (1 Layer)',    'coating',  750000,  950000, 1200000, 1500000,      0, FALSE),
  ('Poles Body / Paint Correction',    'detailing',600000,  850000, 1100000, 1400000,      0, FALSE),
  ('Detailing Interior Deep Clean',    'detailing',500000,  650000,  800000,  950000,      0, FALSE),
  ('Engine Bay Cleaning',              'detailing',150000,  200000,  250000,  300000,  50000, FALSE),
  ('Glass Coating Kaca Penuh',                  'coating',  250000,  350000,  450000,  550000,      0, TRUE),
  ('Deep Interior Sanitizing & Leather Care',   'detailing',500000,  700000,  850000, 1000000,      0, TRUE),
  ('Antibacterial Fogging',                     'other',    100000,  125000,  150000,  175000,  75000, TRUE),
  ('Tambah Wax / Sealant',                      'other',     75000,  100000,  125000,  150000,  25000, TRUE),
  ('Pembersihan Jamur Kaca',                    'other',    120000,  150000,  180000,  200000,      0, TRUE),
  ('Ozon / Penghilang Bau',                     'other',    100000,  125000,  150000,  175000,  50000, TRUE)
) AS v(name, category, price_s, price_m, price_l, price_xl, price_motor, is_addon)
WHERE NOT EXISTS (SELECT 1 FROM public.services s WHERE s.name = v.name);

-- ----------------------------------------------------------------------------
-- 2. Stok gudang contoh per cabang
-- ----------------------------------------------------------------------------
INSERT INTO public.inventory_items (branch_id, item_name, current_stock, unit, min_stock_alert)
SELECT b.id, v.item_name, v.current_stock, v.unit, v.min_stock
FROM public.branches b
CROSS JOIN (VALUES
  ('Sabun Cuci Mobil',        40, 'liter', 10),
  ('Shampoo Snow Wash',       30, 'liter',  8),
  ('Obat Poles / Compound',   12, 'botol',  4),
  ('Obat Coating Ceramic 9H',  6, 'botol',  2),
  ('Wax / Sealant',           10, 'botol',  3),
  ('Interior Cleaner',        18, 'liter',  5),
  ('Leather Conditioner',      9, 'botol',  3),
  ('Glass Cleaner',           20, 'liter',  6),
  ('Ozon Cairan / Refill',     7, 'botol',  2),
  ('Clay Bar',                15, 'pcs',    5),
  ('Microfiber Towel',        60, 'pcs',   20),
  ('Kain Chamois',            25, 'pcs',   10),
  ('Sarung Tangan Karet',     40, 'pcs',   15),
  ('Masker / APD',            50, 'pcs',   20),
  ('Plastik Pelindung Kursi',  8, 'roll',   3)
) AS v(item_name, current_stock, unit, min_stock)
WHERE NOT EXISTS (
  SELECT 1 FROM public.inventory_items i
  WHERE i.branch_id = b.id AND i.item_name = v.item_name
);
