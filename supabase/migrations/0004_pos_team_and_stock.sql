-- ============================================================================
-- 0004_pos_team_and_stock.sql
-- Fase 2 (POS): penugasan tim order (1-5 teknisi) + klaim stok gudang.
-- Sifat: non-destruktif + idempoten (aman dijalankan ulang).
--
-- Latar: orders.assigned_to hanya menampung satu teknisi, sementara desain
-- meminta 1-5 orang per order. Stok juga belum punya jalur pemakaian gudang,
-- padahal kasir/admin dan leader operasional perlu mengklaim barang (sabun,
-- obat poles, obat coating, dll) lalu dikonfirmasi oleh pengguna berwenang.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. order_team_members
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.order_team_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  is_lead BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (order_id, profile_id)
);

CREATE INDEX IF NOT EXISTS order_team_members_order_idx   ON public.order_team_members (order_id);
CREATE INDEX IF NOT EXISTS order_team_members_profile_idx ON public.order_team_members (profile_id);

ALTER TABLE public.order_team_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS order_team_members_select_authenticated ON public.order_team_members;
CREATE POLICY order_team_members_select_authenticated ON public.order_team_members
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS order_team_members_insert_privileged ON public.order_team_members;
CREATE POLICY order_team_members_insert_privileged ON public.order_team_members
  FOR INSERT TO authenticated
  WITH CHECK (public.has_role(ARRAY['owner','admin_kasir','maintainer']::public.user_role[]));

DROP POLICY IF EXISTS order_team_members_update_privileged ON public.order_team_members;
CREATE POLICY order_team_members_update_privileged ON public.order_team_members
  FOR UPDATE TO authenticated
  USING (public.has_role(ARRAY['owner','admin_kasir','maintainer']::public.user_role[]))
  WITH CHECK (public.has_role(ARRAY['owner','admin_kasir','maintainer']::public.user_role[]));

DROP POLICY IF EXISTS order_team_members_delete_privileged ON public.order_team_members;
CREATE POLICY order_team_members_delete_privileged ON public.order_team_members
  FOR DELETE TO authenticated
  USING (public.has_role(ARRAY['owner','admin_kasir','maintainer']::public.user_role[]));

-- ----------------------------------------------------------------------------
-- 2. stock_claims (klaim ambil barang di gudang -> menunggu konfirmasi)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.stock_claims (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id UUID NOT NULL REFERENCES public.branches(id),
  item_id UUID NOT NULL REFERENCES public.inventory_items(id) ON DELETE RESTRICT,
  quantity NUMERIC NOT NULL CHECK (quantity > 0),
  unit VARCHAR(20) NOT NULL,
  note TEXT NULL,
  status VARCHAR(12) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','confirmed','rejected')),
  claimed_by UUID NOT NULL REFERENCES public.profiles(id),
  confirmed_by UUID NULL REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  confirmed_at TIMESTAMPTZ NULL
);

CREATE INDEX IF NOT EXISTS stock_claims_branch_status_idx ON public.stock_claims (branch_id, status);
CREATE INDEX IF NOT EXISTS stock_claims_item_idx          ON public.stock_claims (item_id);
CREATE INDEX IF NOT EXISTS stock_claims_claimed_by_idx    ON public.stock_claims (claimed_by);

ALTER TABLE public.stock_claims ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS stock_claims_select_authenticated ON public.stock_claims;
CREATE POLICY stock_claims_select_authenticated ON public.stock_claims
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS stock_claims_insert_own ON public.stock_claims;
CREATE POLICY stock_claims_insert_own ON public.stock_claims
  FOR INSERT TO authenticated
  WITH CHECK (claimed_by = public.current_profile_id());

DROP POLICY IF EXISTS stock_claims_update_privileged ON public.stock_claims;
CREATE POLICY stock_claims_update_privileged ON public.stock_claims
  FOR UPDATE TO authenticated
  USING (public.has_role(ARRAY['owner','admin_kasir','maintainer']::public.user_role[]))
  WITH CHECK (public.has_role(ARRAY['owner','admin_kasir','maintainer']::public.user_role[]));

-- ----------------------------------------------------------------------------
-- 3. inventory_items: karyawan/leader boleh MELIHAT stok (read-only).
--    Policy SELECT lama diganti agar tidak ada dua policy permissive bertumpuk.
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS inventory_items_select_privileged ON public.inventory_items;
DROP POLICY IF EXISTS inventory_items_select_authenticated ON public.inventory_items;
CREATE POLICY inventory_items_select_authenticated ON public.inventory_items
  FOR SELECT TO authenticated USING (true);

-- ----------------------------------------------------------------------------
-- 4. RPC: set_order_team
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_order_team(
  p_order_id uuid,
  p_member_ids uuid[],
  p_lead_id uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_profile_id uuid := (SELECT public.current_profile_id());
  v_order      public.orders%rowtype;
  v_members    uuid[] := COALESCE(p_member_ids, ARRAY[]::uuid[]);
  v_lead       uuid;
  v_member     uuid;
  v_target     public.profiles%rowtype;
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN
    RAISE EXCEPTION 'Penugasan tim hanya bisa dilakukan oleh pengguna yang sudah masuk.';
  END IF;

  IF NOT (SELECT public.has_role(ARRAY['owner','admin_kasir','maintainer']::public.user_role[])) THEN
    RAISE EXCEPTION 'Hanya owner, admin kasir, dan maintainer yang bisa menugaskan tim.';
  END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order tidak ditemukan.';
  END IF;

  IF array_length(v_members, 1) > 5 THEN
    RAISE EXCEPTION 'Tim maksimal 5 orang.';
  END IF;

  FOREACH v_member IN ARRAY v_members LOOP
    SELECT * INTO v_target FROM public.profiles WHERE id = v_member;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Profil teknisi tidak ditemukan.';
    END IF;
    IF NOT v_target.is_active THEN
      RAISE EXCEPTION 'Teknisi % sedang nonaktif.', v_target.full_name;
    END IF;
    IF v_target.role <> 'karyawan'::public.user_role THEN
      RAISE EXCEPTION 'Tim hanya boleh berisi karyawan, bukan %.', v_target.role;
    END IF;
  END LOOP;

  IF p_lead_id IS NOT NULL AND p_lead_id = ANY (v_members) THEN
    v_lead := p_lead_id;
  ELSIF array_length(v_members, 1) IS NOT NULL THEN
    v_lead := v_members[1];
  END IF;

  DELETE FROM public.order_team_members WHERE order_id = p_order_id;

  IF array_length(v_members, 1) IS NOT NULL THEN
    FOREACH v_member IN ARRAY v_members LOOP
      INSERT INTO public.order_team_members (order_id, profile_id, is_lead)
      VALUES (p_order_id, v_member, v_member = v_lead)
      ON CONFLICT (order_id, profile_id) DO NOTHING;
    END LOOP;
  END IF;

  UPDATE public.orders SET assigned_to = v_lead WHERE id = p_order_id;

  INSERT INTO public.activity_logs (actor_id, action, entity, entity_id, metadata)
  VALUES (
    v_profile_id,
    'order.team_assigned',
    'orders',
    p_order_id,
    jsonb_build_object('order_number', v_order.order_number, 'members', v_members, 'lead', v_lead)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.set_order_team(uuid, uuid[], uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_order_team(uuid, uuid[], uuid) TO authenticated;

-- ----------------------------------------------------------------------------
-- 5. RPC: create_stock_claim (kasir/admin MAUPUN karyawan/leader)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_stock_claim(
  p_item_id uuid,
  p_quantity numeric,
  p_note text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_profile_id uuid := (SELECT public.current_profile_id());
  v_item       public.inventory_items%rowtype;
  v_claim_id   uuid;
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN
    RAISE EXCEPTION 'Klaim stok hanya bisa dilakukan oleh pengguna yang sudah masuk.';
  END IF;

  IF v_profile_id IS NULL THEN
    RAISE EXCEPTION 'Sesi tidak valid.';
  END IF;

  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'Jumlah klaim harus lebih dari nol.';
  END IF;

  SELECT * INTO v_item FROM public.inventory_items WHERE id = p_item_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Item stok tidak ditemukan.';
  END IF;

  INSERT INTO public.stock_claims (branch_id, item_id, quantity, unit, note, claimed_by)
  VALUES (v_item.branch_id, v_item.id, p_quantity, v_item.unit,
          nullif(btrim(coalesce(p_note, '')), ''), v_profile_id)
  RETURNING id INTO v_claim_id;

  RETURN v_claim_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.create_stock_claim(uuid, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_stock_claim(uuid, numeric, text) TO authenticated;

-- ----------------------------------------------------------------------------
-- 6. RPC: confirm_stock_claim (potong stok + catat stock_logs)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.confirm_stock_claim(p_claim_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_profile_id uuid := (SELECT public.current_profile_id());
  v_claim      public.stock_claims%rowtype;
  v_item       public.inventory_items%rowtype;
  v_balance    numeric;
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN
    RAISE EXCEPTION 'Konfirmasi stok hanya bisa dilakukan oleh pengguna yang sudah masuk.';
  END IF;

  IF NOT (SELECT public.has_role(ARRAY['owner','admin_kasir','maintainer']::public.user_role[])) THEN
    RAISE EXCEPTION 'Hanya owner, admin kasir, dan maintainer yang bisa mengonfirmasi klaim stok.';
  END IF;

  SELECT * INTO v_claim FROM public.stock_claims WHERE id = p_claim_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Klaim stok tidak ditemukan.';
  END IF;
  IF v_claim.status <> 'pending' THEN
    RAISE EXCEPTION 'Klaim ini sudah % dan tidak bisa dikonfirmasi lagi.', v_claim.status;
  END IF;

  SELECT * INTO v_item FROM public.inventory_items WHERE id = v_claim.item_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Item stok tidak ditemukan.';
  END IF;

  IF v_item.current_stock < v_claim.quantity THEN
    RAISE EXCEPTION 'Stok % tidak cukup (tersisa %, diminta %).',
      v_item.item_name, v_item.current_stock, v_claim.quantity;
  END IF;

  v_balance := v_item.current_stock - v_claim.quantity;

  UPDATE public.inventory_items SET current_stock = v_balance WHERE id = v_item.id;

  INSERT INTO public.stock_logs (branch_id, item_id, log_type, quantity, balance_after, reference_id, created_by)
  VALUES (v_claim.branch_id, v_claim.item_id, 'out'::public.stock_log_type,
          v_claim.quantity, v_balance, v_claim.id, v_profile_id);

  UPDATE public.stock_claims
     SET status = 'confirmed', confirmed_by = v_profile_id, confirmed_at = now()
   WHERE id = p_claim_id;

  INSERT INTO public.activity_logs (actor_id, action, entity, entity_id, metadata)
  VALUES (
    v_profile_id,
    'stock.claim_confirmed',
    'stock_claims',
    p_claim_id,
    jsonb_build_object('item_id', v_claim.item_id, 'quantity', v_claim.quantity, 'balance_after', v_balance)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.confirm_stock_claim(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.confirm_stock_claim(uuid) TO authenticated;

-- ----------------------------------------------------------------------------
-- 7. RPC: reject_stock_claim
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reject_stock_claim(p_claim_id uuid, p_reason text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_profile_id uuid := (SELECT public.current_profile_id());
  v_claim      public.stock_claims%rowtype;
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN
    RAISE EXCEPTION 'Penolakan klaim hanya bisa dilakukan oleh pengguna yang sudah masuk.';
  END IF;

  IF NOT (SELECT public.has_role(ARRAY['owner','admin_kasir','maintainer']::public.user_role[])) THEN
    RAISE EXCEPTION 'Hanya owner, admin kasir, dan maintainer yang bisa menolak klaim stok.';
  END IF;

  SELECT * INTO v_claim FROM public.stock_claims WHERE id = p_claim_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Klaim stok tidak ditemukan.';
  END IF;
  IF v_claim.status <> 'pending' THEN
    RAISE EXCEPTION 'Klaim ini sudah % dan tidak bisa ditolak lagi.', v_claim.status;
  END IF;

  UPDATE public.stock_claims
     SET status = 'rejected',
         confirmed_by = v_profile_id,
         confirmed_at = now(),
         note = trim(both from concat_ws(' | ',
                  nullif(btrim(coalesce(v_claim.note, '')), ''),
                  nullif(btrim(coalesce(p_reason, '')), '')))
   WHERE id = p_claim_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.reject_stock_claim(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reject_stock_claim(uuid, text) TO authenticated;
