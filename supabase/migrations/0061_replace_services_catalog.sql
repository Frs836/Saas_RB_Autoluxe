-- 0061: ganti seluruh katalog jasa dengan harga baru dari draft resmi.
--
-- Hapus semua layanan lama, masukkan paket coating, wash mobil, wash motor,
-- dan add-on sesuai daftar harga terbaru.

TRUNCATE public.services RESTART IDENTITY CASCADE;

-- Kategori: 'coating', 'wash', 'detailing', 'other'
-- is_addon: true untuk layanan tambahan (fogging, pickup, dll)

INSERT INTO public.services (name, category, is_addon,
  price_s, price_m, price_l, price_xl,
  price_motor_s, price_motor_m, price_motor_l, price_motor_xl, price_motor)
VALUES
-- ===== PAKET COATING & DETAILING =====
-- Graphene Package (5 layers)
('Graphene Package', 'coating', false,
  4000000, 4500000, 5000000, 6000000,
  0, 0, 0, 0, 0),

-- Premium Package (3 layers nano ceramic)
('Premium Package', 'coating', false,
  3000000, 3250000, 3500000, 4500000,
  0, 0, 0, 0, 0),

-- Light Package (2 layers nano ceramic)
('Light Package', 'coating', false,
  2350000, 2500000, 2750000, 3750000,
  0, 0, 0, 0, 0),

-- ===== CAR WASH =====
-- Basic Wash (Wash, Vacuum, & Semir Ban)
('Basic Wash', 'wash', false,
  45000, 45000, 50000, 55000,
  0, 0, 0, 0, 0),

-- Super Wash (Basic Wash & Wax)
('Super Wash', 'wash', false,
  95000, 105000, 120000, 140000,
  0, 0, 0, 0, 0),

-- Premium Wash (Super Wash & Quick Polish)
('Premium Wash', 'wash', false,
  200000, 225000, 250000, 275000,
  0, 0, 0, 0, 0),

-- Jamur Kaca (Basic Wash & Jamur Kaca)
('Jamur Kaca', 'wash', false,
  235000, 250000, 260000, 280000,
  0, 0, 0, 0, 0),

-- ===== MOTOR WASH =====
-- Motor Basic Wash (Wash & Dry)
('Motor Basic Wash', 'wash', false,
  0, 0, 0, 0,
  20000, 25000, 35000, 0, 0),

-- Motor Super Wash (Basic Wash & Wax)
('Motor Super Wash', 'wash', false,
  0, 0, 0, 0,
  30000, 35000, 45000, 0, 0),

-- Motor Premium Wash (Super Wash & Quick Polish)
('Motor Premium Wash', 'wash', false,
  0, 0, 0, 0,
  75000, 100000, 125000, 0, 0),

-- ===== ADD-ON (is_addon = true) =====
-- Fogging
('Fogging', 'other', true,
  40000, 40000, 40000, 40000,
  40000, 40000, 40000, 40000, 40000),

-- Pick Up & Drop
('Pick Up & Drop', 'other', true,
  15000, 15000, 15000, 15000,
  15000, 15000, 15000, 15000, 15000);