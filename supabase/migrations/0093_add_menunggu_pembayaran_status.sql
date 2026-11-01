ALTER TYPE public.order_status ADD VALUE IF NOT EXISTS 'menunggu_pembayaran' BEFORE 'menunggu_diambil';
