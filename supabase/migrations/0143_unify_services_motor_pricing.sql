-- ============================================================
-- 0143_unify_services_motor_pricing.sql
-- 1. Gabungkan harga motor ke layanan utama (Basic Wash, Super Wash, Premium Wash)
--    sehingga 1 paket melayani seluruh ukuran Mobil (S, M, L, XL) dan Motor (S, M, L, XL).
-- 2. Nonaktifkan layanan pecahan Motor ... agar katalog POS bersih dan terpadu.
-- 3. Update order item order ZEA ke Basic Wash dan jalankan consume_order_materials.
-- ============================================================

-- 1. Update harga motor di Basic Wash dari Motor Basic Wash
UPDATE public.services AS target
SET
  price_motor   = COALESCE(src.price_motor, 25000),
  price_motor_s = COALESCE(src.price_motor_s, 20000),
  price_motor_m = COALESCE(src.price_motor_m, 25000),
  price_motor_l = COALESCE(src.price_motor_l, 35000),
  price_motor_xl = COALESCE(src.price_motor_xl, 40000)
FROM public.services AS src
WHERE target.name = 'Basic Wash'
  AND src.name = 'Motor Basic Wash';

-- Update harga motor di Super Wash dari Motor Super Wash
UPDATE public.services AS target
SET
  price_motor   = COALESCE(src.price_motor, 35000),
  price_motor_s = COALESCE(src.price_motor_s, 30000),
  price_motor_m = COALESCE(src.price_motor_m, 35000),
  price_motor_l = COALESCE(src.price_motor_l, 45000),
  price_motor_xl = COALESCE(src.price_motor_xl, 50000)
FROM public.services AS src
WHERE target.name = 'Super Wash'
  AND src.name = 'Motor Super Wash';

-- Update harga motor di Premium Wash dari Motor Premium Wash
UPDATE public.services AS target
SET
  price_motor   = COALESCE(src.price_motor, 100000),
  price_motor_s = COALESCE(src.price_motor_s, 75000),
  price_motor_m = COALESCE(src.price_motor_m, 100000),
  price_motor_l = COALESCE(src.price_motor_l, 125000),
  price_motor_xl = COALESCE(src.price_motor_xl, 150000)
FROM public.services AS src
WHERE target.name = 'Premium Wash'
  AND src.name = 'Motor Premium Wash';

-- 2. Nonaktifkan layanan pecahan Motor yang duplikat
UPDATE public.services
SET is_active = false
WHERE name IN ('Motor Basic Wash', 'Motor Super Wash', 'Motor Premium Wash');

-- 3. Arahkan order ZEA (B 3456 ZEA) yang sebelumnya pakai 'Motor Basic Wash' ke 'Basic Wash'
DO $$
DECLARE
  v_basic_wash_id uuid;
  v_order_id      uuid;
BEGIN
  SELECT id INTO v_basic_wash_id FROM public.services WHERE name = 'Basic Wash' LIMIT 1;
  SELECT id INTO v_order_id FROM public.orders WHERE license_plate ILIKE '%ZEA%' ORDER BY created_at DESC LIMIT 1;

  IF v_basic_wash_id IS NOT NULL AND v_order_id IS NOT NULL THEN
    UPDATE public.order_items
    SET service_id = v_basic_wash_id,
        item_name  = 'Basic Wash'
    WHERE order_id = v_order_id;

    PERFORM pg_catalog.set_config('app.trusted_order_write', 'on', true);
    UPDATE public.orders
    SET service_package = 'Basic Wash'
    WHERE id = v_order_id;
    PERFORM pg_catalog.set_config('app.trusted_order_write', 'off', true);

    -- Potong bahan sesuai resep Motor L di Basic Wash
    PERFORM public.consume_order_materials(v_order_id);
  END IF;
END $$;
