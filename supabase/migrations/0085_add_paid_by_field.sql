-- 0085: Add paid_by and paid_at columns to orders table
-- Tracking siapa dan kapan melakukan pembayaran untuk audit trail

ALTER TABLE public.orders 
ADD COLUMN IF NOT EXISTS paid_by uuid REFERENCES public.profiles(id),
ADD COLUMN IF NOT EXISTS paid_at timestamptz;

-- Index untuk query audit
CREATE INDEX IF NOT EXISTS idx_orders_paid_by ON public.orders(paid_by);
CREATE INDEX IF NOT EXISTS idx_orders_paid_at ON public.orders(paid_at);

COMMENT ON COLUMN public.orders.paid_by IS 'Profile ID yang melakukan pembayaran';
COMMENT ON COLUMN public.orders.paid_at IS 'Timestamp saat pembayaran dilakukan';
