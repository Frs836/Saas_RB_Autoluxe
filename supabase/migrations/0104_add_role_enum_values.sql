-- 0104: Tambah nilai enum user_role saja (harus commit terpisah sebelum dipakai)
-- PostgreSQL tidak boleh menggunakan nilai enum baru dalam transaksi yang sama.
ALTER TYPE public.user_role ADD VALUE IF NOT EXISTS 'manager';
ALTER TYPE public.user_role ADD VALUE IF NOT EXISTS 'finance';
ALTER TYPE public.user_role ADD VALUE IF NOT EXISTS 'kepala_karyawan';
