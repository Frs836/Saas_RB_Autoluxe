ALTER TYPE public.order_payment_state ADD VALUE IF NOT EXISTS 'partial';
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS paid_amount numeric(12,2) DEFAULT 0;
