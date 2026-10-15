-- 0037_tracking_token_column_default.sql
--
-- Kode lacak pelanggan tetap 48 karakter padahal 0034 sudah menyediakan
-- generator 8 karakter.
--
-- Penyebabnya bukan generatornya. Kolom orders.tracking_token punya
-- DEFAULT encode(gen_random_bytes(24), 'hex'), yaitu 48 karakter. Postgres
-- mengisi nilai default itu SEBELUM trigger BEFORE INSERT guard_order_identity
-- dijalankan. Cek di dalam fungsi:
--
--   IF NULLIF(btrim(COALESCE(new.tracking_token, '')), '') IS NULL THEN
--     new.tracking_token := public.new_tracking_token();
--   END IF;
--
-- Karena kolom sudah terisi 48 karakter sebelum trigger masuk, kondisi IS NULL
-- itu tidak pernah benar. new_tracking_token() tidak pernah dipanggil sama
-- sekali. 0034 mengganti fungsi generator tapi tidak membuang default kolom,
-- sehingga setiap order baru tetap mendapat hash penuh.
--
-- Perbaikannya satu baris: buang default kolom supaya trigger menjadi satu-satunya
-- sumber token.
--
-- Token yang sudah terbit tidak diubah di sini. Tautan lacak yang sudah
-- dibagikan ke pelanggan tetap harus hidup, dan mengganti kode lama tanpa
-- pemberitahuan akan mematikan tautan itu.
--
-- Idempoten: aman dijalankan berulang kali.

ALTER TABLE public.orders
  ALTER COLUMN tracking_token DROP DEFAULT;

COMMENT ON COLUMN public.orders.tracking_token IS
  'Kode lacak pelanggan, diisi guard_order_identity lewat new_tracking_token(). '
  'Jangan diberi DEFAULT kolom: default terisi sebelum trigger jalan, sehingga '
  'generator delapan karakter tidak akan pernah dipakai.';
