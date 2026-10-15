-- 0033_widen_service_package.sql
--
-- Nama paket layanan bukan satu nama, melainkan gabungan beberapa layanan yang
-- dipilih kasir, disambung dengan koma.
--
-- Kolomnya varchar(150) padahal satu nama layanan sudah bisa 39 karakter.
-- Empat layanan jadi 162 karakter dan checkout gagal dengan pesan
-- "value too long for type character varying(150)" yang muncul mentah dari
-- trigger database tanpa menjelaskan penyebabnya.
--
-- Yang diperbaiki adalah batas kolomnya, bukan pemanggilnya. Nama layanan
-- memang boleh digabung dan tidak ada alasan bisnis untuk membatasi 150
-- karakter.

-- Kolom ini selalu diisi penuh dengan gabungan nama layanan, jadi batas
-- varchar tidak memberi perlindungan apa pun, hanya menolak data sah.
ALTER TABLE public.orders
  ALTER COLUMN service_package TYPE character varying(500);

-- Nama pelanggan punya batas yang jauh lebih longgar karena tidak pernah
-- digabung. Naikkan sedikit supaya nama yang wajar tidak ikut gagal.
ALTER TABLE public.orders
  ALTER COLUMN customer_name TYPE character varying(150);
