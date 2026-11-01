CREATE TABLE IF NOT EXISTS public.order_payments (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  amount numeric(12,2) NOT NULL CHECK (amount > 0),
  payment_method public.payment_method NOT NULL DEFAULT 'cash',
  payment_type text NOT NULL CHECK (payment_type IN ('dp', 'pelunasan', 'full')),
  recorded_by uuid REFERENCES public.profiles(id),
  note text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.order_payments ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'order_payments' AND policyname = 'order_payments_select'
  ) THEN
    CREATE POLICY order_payments_select ON public.order_payments
      FOR SELECT USING (
        EXISTS (
          SELECT 1 FROM public.orders o
          WHERE o.id = order_payments.order_id
            AND public.can_access_branch(o.branch_id)
        )
      );
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'order_payments' AND policyname = 'order_payments_insert'
  ) THEN
    CREATE POLICY order_payments_insert ON public.order_payments
      FOR INSERT WITH CHECK (
        public.current_user_role() IN ('owner', 'admin_kasir', 'maintainer')
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS order_payments_order_id_idx ON public.order_payments(order_id);
