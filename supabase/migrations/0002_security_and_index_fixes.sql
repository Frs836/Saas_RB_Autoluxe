-- ============================================================================
-- RB AUTOLUXE - Migrasi 0002: Perbaikan Advisory (keamanan + kinerja)
-- Proyek: qidtfssldidzvehssevk  |  Tanggal: 2026-10-11
-- Sumber: hasil supabase_get_advisors setelah migrasi 0001
--
-- Isi:
--   1. petty_cash -> security_invoker (RLS tabel dasarnya berlaku)
--   2. Cabut EXECUTE PUBLIC untuk fungsi internal/admin, beri ulang ke
--      authenticated sesuai kebutuhan, pertahankan anon hanya untuk tracking
--      publik berbasis token
--   3. Konsolidasi policy permissive ganda (branches, bundling_*,
--      workshop_settings, time_off_requests)
--   4. Indeks untuk seluruh FK yang belum tertutup di tabel baru
--   5. Cabut grant eksplisit anon pada trigger guard sisa desain lama
-- ============================================================================

set search_path = public;

-- ----------------------------------------------------------------------------
-- 1. PETTY CASH: security_invoker
-- ----------------------------------------------------------------------------
DROP VIEW IF EXISTS public.petty_cash;
CREATE VIEW public.petty_cash WITH (security_invoker = on) AS
SELECT id, created_at, amount,
       COALESCE(category, 'petty_cash') AS category,
       description, proof_photo_url, branch_id, created_by,
       COALESCE(payment_method, 'cash') AS payment_method
FROM public.cash_flow
WHERE type = 'out';

GRANT SELECT ON public.petty_cash TO anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 2. HAK EKSEKUSI FUNGSI (REVOKE FROM PUBLIC, bukan hanya anon)
-- ----------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION
  public.current_profile_id(),
  public.current_user_role(),
  public.has_role(public.user_role[]),
  public.promote_profile_role(uuid, public.user_role),
  public.rls_auto_enable(),
  public.guard_attendance_photo(),
  public.handle_new_auth_user(),
  public.guard_created_by_identity(),
  public.guard_cash_flow_identity(),
  public.guard_order_identity(),
  public.set_updated_at(),
  public.set_warranty_code(),
  public.next_order_number(),
  public.new_tracking_token(),
  public.apply_order_status(uuid, public.order_status),
  public.assign_order_technician(uuid, uuid),
  public.open_shift_handoff(date, uuid, numeric, text),
  public.close_shift_handoff(uuid, numeric, text),
  public.expected_cash_for_date(date, numeric),
  public.ensure_weekly_off_day_for_self(date),
  public.create_pos_order(text, text, public.vehicle_size, text, text, text, jsonb, public.payment_method),
  public.cancel_order(uuid, text)
FROM PUBLIC;

GRANT EXECUTE ON FUNCTION
  public.current_profile_id(),
  public.current_user_role(),
  public.has_role(public.user_role[]),
  public.promote_profile_role(uuid, public.user_role),
  public.handle_new_auth_user(),
  public.guard_attendance_photo(),
  public.guard_created_by_identity(),
  public.guard_cash_flow_identity(),
  public.guard_order_identity(),
  public.set_updated_at(),
  public.set_warranty_code(),
  public.next_order_number(),
  public.new_tracking_token(),
  public.apply_order_status(uuid, public.order_status),
  public.assign_order_technician(uuid, uuid),
  public.open_shift_handoff(date, uuid, numeric, text),
  public.close_shift_handoff(uuid, numeric, text),
  public.expected_cash_for_date(date, numeric),
  public.ensure_weekly_off_day_for_self(date),
  public.create_pos_order(text, text, public.vehicle_size, text, text, text, jsonb, public.payment_method),
  public.cancel_order(uuid, text)
TO authenticated;

-- Tracking/pemeriksaan publik berbasis token tetap terbuka untuk anon
GRANT EXECUTE ON FUNCTION
  public.public_order_tracking(text),
  public.public_order_inspections(text)
TO anon, authenticated;

-- ----------------------------------------------------------------------------
-- 3. KONSOLIDASI POLICY PERMISSIVE GANDA
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS branches_maintainer_write ON public.branches;
CREATE POLICY branches_maintainer_write ON public.branches FOR INSERT TO authenticated
  WITH CHECK (public.has_role(ARRAY['maintainer']::public.user_role[]));
CREATE POLICY branches_maintainer_update ON public.branches FOR UPDATE TO authenticated
  USING (public.has_role(ARRAY['maintainer']::public.user_role[]))
  WITH CHECK (public.has_role(ARRAY['maintainer']::public.user_role[]));
CREATE POLICY branches_maintainer_delete ON public.branches FOR DELETE TO authenticated
  USING (public.has_role(ARRAY['maintainer']::public.user_role[]));

DROP POLICY IF EXISTS bundling_packages_maintainer_write ON public.bundling_packages;
CREATE POLICY bundling_packages_maintainer_write ON public.bundling_packages FOR INSERT TO authenticated
  WITH CHECK (public.has_role(ARRAY['maintainer']::public.user_role[]));
CREATE POLICY bundling_packages_maintainer_update ON public.bundling_packages FOR UPDATE TO authenticated
  USING (public.has_role(ARRAY['maintainer']::public.user_role[]))
  WITH CHECK (public.has_role(ARRAY['maintainer']::public.user_role[]));
CREATE POLICY bundling_packages_maintainer_delete ON public.bundling_packages FOR DELETE TO authenticated
  USING (public.has_role(ARRAY['maintainer']::public.user_role[]));

DROP POLICY IF EXISTS bundling_items_maintainer_write ON public.bundling_items;
CREATE POLICY bundling_items_maintainer_write ON public.bundling_items FOR INSERT TO authenticated
  WITH CHECK (public.has_role(ARRAY['maintainer']::public.user_role[]));
CREATE POLICY bundling_items_maintainer_update ON public.bundling_items FOR UPDATE TO authenticated
  USING (public.has_role(ARRAY['maintainer']::public.user_role[]))
  WITH CHECK (public.has_role(ARRAY['maintainer']::public.user_role[]));
CREATE POLICY bundling_items_maintainer_delete ON public.bundling_items FOR DELETE TO authenticated
  USING (public.has_role(ARRAY['maintainer']::public.user_role[]));

DROP POLICY IF EXISTS workshop_settings_write_maintainer ON public.workshop_settings;
CREATE POLICY workshop_settings_write_maintainer ON public.workshop_settings FOR INSERT TO authenticated
  WITH CHECK (public.has_role(ARRAY['maintainer']::public.user_role[]));
CREATE POLICY workshop_settings_update_maintainer ON public.workshop_settings FOR UPDATE TO authenticated
  USING (public.has_role(ARRAY['maintainer']::public.user_role[]))
  WITH CHECK (public.has_role(ARRAY['maintainer']::public.user_role[]));
CREATE POLICY workshop_settings_delete_maintainer ON public.workshop_settings FOR DELETE TO authenticated
  USING (public.has_role(ARRAY['maintainer']::public.user_role[]));

DROP POLICY IF EXISTS time_off_update_own ON public.time_off_requests;
DROP POLICY IF EXISTS time_off_approve_privileged ON public.time_off_requests;
CREATE POLICY time_off_update_own ON public.time_off_requests FOR UPDATE TO authenticated
  USING (profile_id = public.current_profile_id()
         OR public.has_role(ARRAY['owner','maintainer']::public.user_role[]))
  WITH CHECK (profile_id = public.current_profile_id()
         OR public.has_role(ARRAY['owner','maintainer']::public.user_role[]));

-- ----------------------------------------------------------------------------
-- 4. INDEKS FK YANG BELUM TERTUTUP
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS activity_logs_actor_id_idx          ON public.activity_logs (actor_id);
CREATE INDEX IF NOT EXISTS bundling_items_package_id_idx       ON public.bundling_items (package_id);
CREATE INDEX IF NOT EXISTS bundling_items_service_id_idx       ON public.bundling_items (service_id);
CREATE INDEX IF NOT EXISTS commission_settings_created_by_idx  ON public.commission_settings (created_by);
CREATE INDEX IF NOT EXISTS commission_settings_service_id_idx  ON public.commission_settings (service_id);
CREATE INDEX IF NOT EXISTS notifications_created_by_idx        ON public.notifications (created_by);
CREATE INDEX IF NOT EXISTS stock_logs_created_by_idx           ON public.stock_logs (created_by);
CREATE INDEX IF NOT EXISTS time_off_approver_id_idx            ON public.time_off_requests (approver_id);
CREATE INDEX IF NOT EXISTS warranty_claims_created_by_idx      ON public.warranty_claims (created_by);
CREATE INDEX IF NOT EXISTS warranty_claims_handled_by_idx      ON public.warranty_claims (handled_by);
CREATE INDEX IF NOT EXISTS workshop_settings_branch_id_idx     ON public.workshop_settings (branch_id);
CREATE INDEX IF NOT EXISTS workshop_settings_updated_by_idx    ON public.workshop_settings (updated_by);

-- ----------------------------------------------------------------------------
-- 5. CABUT GRANT ANON EKSPLISIT (trigger guard sisa desain lama)
-- ----------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION
  public.guard_cash_flow_identity(),
  public.guard_order_identity()
FROM anon;