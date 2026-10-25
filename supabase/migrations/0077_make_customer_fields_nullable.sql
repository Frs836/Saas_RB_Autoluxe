-- ============================================================
-- Make customer_name & customer_phone nullable
-- Sesuai UI label "(opsional)" - walk-in customer tanpa nama didukung
-- ============================================================

ALTER TABLE public.orders
  ALTER COLUMN customer_name DROP NOT NULL,
  ALTER COLUMN customer_phone DROP NOT NULL;

-- Verifikasi
SELECT column_name, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public' 
  AND table_name = 'orders'
  AND column_name IN ('customer_name', 'customer_phone');