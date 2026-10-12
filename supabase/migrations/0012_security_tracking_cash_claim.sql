-- ============================================================================
-- RB AUTOLUXE - Migrasi 0012: Tracking Publik, Anti Self-Approval Izin,
--               Kas Terikat Shift, dan Klaim Garansi
-- Proyek: qidtfssldidzvehssevk  |  Tanggal: 2026-10-13
-- Sifat: NON-DESTRUKTIF & IDEMPOTEN.
--
-- Isi:
--   A. get_order_tracking(p_token)  -> RPC yang benar-benar dipanggil
--      app/track/[token]/page.tsx. Sebelumnya halaman memanggil fungsi yang
--      tidak pernah ada, sehingga lacak publik selalu 404 / error.
--   B. time_off_requests: policy UPDATE lama digabung dengan OR sehingga
--      karyawan bisa menyetujui izin miliknya sendiri. Dipecah menjadi
--      "pemohon hanya bisa membatalkan saat masih pending" dan "hanya
--      owner/maintainer yang memutuskan", plus trigger pengaman kolom.
--   C. expected_cash_for_date menyumming SELURUH cabang sehingga angka
--      ekspektasi kas di satu cabang ikut tercampur cabang lain. Ditambah
--      overload bercabang dan dipakai ulang oleh open/close_shift_handoff.
--   D. cash_flow.shift_handoff_id + create_cash_transaction(). Selama ini
--      form petty cash memakai setTimeout palsu dan tidak pernah menyentuh DB.
--      Disertakan bucket privat cash-proofs untuk foto nota (PRD 5.6).
--   E. create_warranty_claim() dengan validasi masa garansi.
--   F. current_profile_state() untuk middleware + refresh_warranty_statuses().
-- ============================================================================

set search_path = public;

-- ============================================================================
-- A. RPC LACAK PUBLIK
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_order_tracking(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_order public.orders%rowtype;
  v_result jsonb;
BEGIN
  IF NULLIF(btrim(coalesce(p_token, '')), '') IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_order
    FROM public.orders o
   WHERE o.tracking_token = p_token;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  v_result := jsonb_build_object(
    'order', jsonb_build_object(
      'order_number',        v_order.order_number,
      'status',              v_order.status,
      'customer_name',       v_order.customer_name,
      'license_plate',       v_order.license_plate,
      'vehicle_model',       v_order.vehicle_model,
      'vehicle_size',        v_order.vehicle_size,
      'service_package',     v_order.service_package,
      'total_price',         v_order.total_price,
      'created_at',          v_order.created_at,
      'updated_at',          v_order.updated_at,
      'completed_at',        v_order.completed_at,
      'cancellation_reason', v_order.cancellation_reason
    ),
    'inspections', COALESCE((
      SELECT jsonb_agg(
               jsonb_build_object(
                 'phase',      i.phase,
                 'photo_url',  i.photo_url,
                 'notes',      i.notes,
                 'created_at', i.created_at
               )
               ORDER BY i.created_at
             )
        FROM public.order_inspections i
       WHERE i.order_id = v_order.id
    ), '[]'::jsonb),
    'warranty', (
      SELECT jsonb_build_object(
               'warranty_code', w.warranty_code,
               'start_date',    w.start_date,
               'end_date',      w.end_date,
               'status',        w.status
             )
        FROM public.warranties w
       WHERE w.order_id = v_order.id
       ORDER BY w.created_at DESC
       LIMIT 1
    ),
    'claims', COALESCE((
      SELECT jsonb_agg(
               jsonb_build_object(
                 'claim_date',           c.claim_date,
                 'problem_description',  c.problem_description,
                 'status',               c.status,
                 'resolution_note',      c.resolution_note,
                 'proof_photo_url',      c.proof_photo_url
               )
               ORDER BY c.claim_date
             )
        FROM public.warranty_claims c
       WHERE c.order_id = v_order.id
    ), '[]'::jsonb)
  );

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_order_tracking(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_order_tracking(text) TO anon, authenticated;

-- ============================================================================
-- B. time_off_requests: Anti Self-Approval
-- ============================================================================

DROP POLICY IF EXISTS time_off_update_own ON public.time_off_requests;

-- Pemohon boleh mengubah barisnya, tetapi hanya selama masih pending dan
-- hanya untuk MEMBATALKAN (status menjadi rejected). Approve/reject oleh
-- pemohon sendiri mustahil karena WITH CHECK memaksa status akhir rejected.
CREATE POLICY time_off_cancel_own_pending ON public.time_off_requests
  FOR UPDATE TO authenticated
  USING (
    profile_id = (SELECT public.current_profile_id())
    AND status = 'pending'::public.time_off_status
  )
  WITH CHECK (
    profile_id = (SELECT public.current_profile_id())
    AND status = 'rejected'::public.time_off_status
  );

-- Keputusan (approve/reject) hanya owner & maintainer.
CREATE POLICY time_off_decide_privileged ON public.time_off_requests
  FOR UPDATE TO authenticated
  USING ((SELECT public.has_role(ARRAY['owner', 'maintainer']::public.user_role[])))
  WITH CHECK ((SELECT public.has_role(ARRAY['owner', 'maintainer']::public.user_role[])));

-- Pengaman lapis trigger: pemohon tidak boleh mengisi kolom keputusan,
-- dan hanya boleh mencabut pengajuan yang masih pending.
CREATE OR REPLACE FUNCTION public.guard_time_off_decision()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_is_officer boolean;
BEGIN
  v_is_officer := COALESCE((
    SELECT public.has_role(ARRAY['owner', 'maintainer']::public.user_role[])
  ), false);

  IF v_is_officer THEN
    IF NEW.status <> 'pending'::public.time_off_status THEN
      NEW.approver_id := COALESCE(NEW.approver_id, public.current_profile_id());
      NEW.decided_at   := COALESCE(NEW.decided_at, now());
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE'
     AND (NEW.profile_id, NEW.type, NEW.start_date, NEW.end_date, NEW.reason,
          NEW.proof_photo_url, NEW.created_at)
       IS DISTINCT FROM
         (OLD.profile_id, OLD.type, OLD.start_date, OLD.end_date, OLD.reason,
          OLD.proof_photo_url, OLD.created_at) THEN
    RAISE EXCEPTION 'Isi pengajuan tidak boleh diubah setelah dikirim.';
  END IF;

  IF NEW.status <> 'rejected'::public.time_off_status THEN
    RAISE EXCEPTION 'Pengajuan hanya dapat dibatalkan oleh pemohon.';
  END IF;

  IF OLD.status <> 'pending'::public.time_off_status THEN
    RAISE EXCEPTION 'Pengajuan ini sudah diputuskan dan tidak dapat diubah lagi.';
  END IF;

  -- Pemohon menarik pengajuannya sendiri: kolom keputusan dikosongkan.
  NEW.approver_id := NULL;
  NEW.decided_at   := NULL;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_time_off_decision ON public.time_off_requests;
CREATE TRIGGER trg_time_off_decision
  BEFORE UPDATE ON public.time_off_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_time_off_decision();

-- ============================================================================
-- C. Ekspektasi kas per cabang
-- ============================================================================

ALTER TABLE public.cash_flow
  ADD COLUMN IF NOT EXISTS shift_handoff_id uuid
    REFERENCES public.shift_handoffs(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS cash_flow_shift_handoff_idx
  ON public.cash_flow (shift_handoff_id)
  WHERE shift_handoff_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.expected_cash_for_date(
  p_date date,
  p_opening_cash numeric,
  p_branch_id uuid DEFAULT NULL
)
RETURNS TABLE(cash_in numeric, cash_out numeric, unknown_method numeric)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_day_start timestamptz := (p_date::timestamp at time zone 'Asia/Jakarta');
  v_day_end   timestamptz := ((p_date + 1)::timestamp at time zone 'Asia/Jakarta');
BEGIN
  RETURN QUERY
  SELECT
    COALESCE(sum(c.amount) FILTER (
      WHERE c.type = 'in'::public.cash_flow_type
        AND c.payment_method = 'cash'::public.payment_method
    ), 0),
    COALESCE(sum(c.amount) FILTER (
      WHERE c.type = 'out'::public.cash_flow_type
    ), 0),
    COALESCE(sum(c.amount) FILTER (
      WHERE c.type = 'in'::public.cash_flow_type
        AND c.payment_method IS NULL
    ), 0)
  FROM public.cash_flow c
  WHERE c.created_at >= v_day_start
    AND c.created_at <  v_day_end
    AND (p_branch_id IS NULL OR c.branch_id IS NULL OR c.branch_id = p_branch_id);
END;
$function$;

-- Menambah parameter baru lewat CREATE OR REPLACE akan membuat OVERLOAD, bukan
-- mengganti, sehingga versi 2-arg lama tetap hidup dengan penjumlahan seluruh
-- cabang. Versi lama sekarang meneruskan ke versi bercabang memakai cabang
-- profil pemanggil, sehingga tidak ada lagi pemanggil yang bisa menjumlahkan
-- kas seluruh perusahaan tanpa disengaja.
CREATE OR REPLACE FUNCTION public.expected_cash_for_date(
  p_date date,
  p_opening_cash numeric
)
RETURNS TABLE(cash_in numeric, cash_out numeric, unknown_method numeric)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
  select * from public.expected_cash_for_date(
    p_date,
    p_opening_cash,
    (select p.branch_id from public.profiles p where p.id = public.current_profile_id())
  );
$function$;

-- open_shift_handoff: ekspektasi kini dihitung per cabang.
CREATE OR REPLACE FUNCTION public.open_shift_handoff(p_date date, p_shift_id uuid, p_opening_cash numeric, p_notes text)
  RETURNS uuid
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
AS $function$
declare
  v_profile   uuid;
  v_branch_id uuid;
  v_expected  numeric;
  v_unknown   numeric;
  v_id        uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'Serah terima kas hanya bisa dibuka oleh pengguna yang sudah masuk.';
  end if;

  if not (select public.has_role(
    array['owner', 'admin_kasir', 'maintainer']::public.user_role[]
  )) then
    raise exception 'Hanya owner, admin kasir, dan maintainer yang bisa melakukan serah terima kas.';
  end if;

  v_profile := (select public.current_profile_id());
  if v_profile is null then
    raise exception 'Sesi tidak valid.';
  end if;

  if p_opening_cash is null or p_opening_cash < 0 then
    raise exception 'Kas awal tidak boleh negatif.';
  end if;

  if p_shift_id is not null
     and not exists (select 1 from public.shifts s where s.id = p_shift_id) then
    raise exception 'Shift tidak ditemukan.';
  end if;

  v_branch_id := coalesce(
    (select p.branch_id from public.profiles p where p.id = v_profile),
    (select b.id from public.branches b where b.is_active order by b.created_at limit 1)
  );

  select p_opening_cash + coalesce(f.cash_in, 0) - coalesce(f.cash_out, 0),
         coalesce(f.unknown_method, 0)
    into v_expected, v_unknown
  from public.expected_cash_for_date(p_date, p_opening_cash, v_branch_id) f;

  insert into public.shift_handoffs (
    shift_date, shift_id, opening_cash, expected_cash, unknown_method_cash,
    status, notes, opened_by, branch_id
  )
  values (
    p_date, p_shift_id, p_opening_cash, v_expected, v_unknown,
    'open'::public.shift_handoff_status,
    nullif(btrim(coalesce(p_notes, '')), ''), v_profile, v_branch_id
  )
  returning id into v_id;

  return v_id;
end;
$function$;

-- close_shift_handoff: sama, memakai cabang dari baris handoff itu sendiri.
CREATE OR REPLACE FUNCTION public.close_shift_handoff(p_handoff_id uuid, p_actual_cash numeric, p_notes text)
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_profile  uuid;
  v_row      public.shift_handoffs%rowtype;
  v_expected numeric;
  v_unknown  numeric;
  v_diff     numeric;
begin
  if (select auth.uid()) is null then
    raise exception 'Serah terima kas hanya bisa ditutup oleh pengguna yang sudah masuk.';
  end if;

  if not (select public.has_role(
    array['owner', 'admin_kasir', 'maintainer']::public.user_role[]
  )) then
    raise exception 'Hanya owner, admin kasir, dan maintainer yang bisa melakukan serah terima kas.';
  end if;

  v_profile := (select public.current_profile_id());
  if v_profile is null then
    raise exception 'Sesi tidak valid.';
  end if;

  if p_actual_cash is null or p_actual_cash < 0 then
    raise exception 'Jumlah uang fisik tidak boleh kosong atau negatif.';
  end if;

  select * into v_row
    from public.shift_handoffs
   where id = p_handoff_id
     for update;

  if not found then
    raise exception 'Catatan serah terima kas tidak ditemukan.';
  end if;

  if v_row.status = 'closed'::public.shift_handoff_status then
    raise exception 'Serah terima kas ini sudah ditutup pada %.',
      to_char(v_row.closed_at at time zone 'Asia/Jakarta', 'DD/MM/YYYY HH24:MI');
  end if;

  select v_row.opening_cash + coalesce(f.cash_in, 0) - coalesce(f.cash_out, 0),
         coalesce(f.unknown_method, 0)
    into v_expected, v_unknown
  from public.expected_cash_for_date(v_row.shift_date, v_row.opening_cash, v_row.branch_id) f;

  v_diff := p_actual_cash - v_expected;

  update public.shift_handoffs
     set actual_cash          = p_actual_cash,
         expected_cash        = v_expected,
         unknown_method_cash  = v_unknown,
         difference           = v_diff,
         status               = 'closed'::public.shift_handoff_status,
         closed_by            = v_profile,
         closed_at            = now(),
         notes                 = coalesce(
           nullif(btrim(coalesce(p_notes, '')), ''),
           v_row.notes
         ),
         updated_at           = now()
   where id = p_handoff_id;

  return v_diff;
end;
$function$;

-- ============================================================================
-- D. create_cash_transaction  (pengganti setTimeout palsu di /kas)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.create_cash_transaction(
  p_type             public.cash_flow_type,
  p_amount           numeric,
  p_category         text,
  p_description      text DEFAULT NULL,
  p_payment_method   public.payment_method DEFAULT 'cash',
  p_proof_photo_url  text DEFAULT NULL,
  p_shift_handoff_id uuid DEFAULT NULL
)
RETURNS public.cash_flow
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_profile   uuid;
  v_branch_id uuid;
  v_handoff   uuid;
  v_row       public.cash_flow%rowtype;
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN
    RAISE EXCEPTION 'Transaksi kas hanya bisa dicatat oleh pengguna yang sudah masuk.';
  END IF;

  IF NOT COALESCE((SELECT public.has_role(
    ARRAY['owner', 'admin_kasir', 'maintainer']::public.user_role[]
  )), false) THEN
    RAISE EXCEPTION 'Hanya owner, admin kasir, dan maintainer yang bisa mencatat transaksi kas.';
  END IF;

  v_profile := (SELECT public.current_profile_id());
  IF v_profile IS NULL THEN
    RAISE EXCEPTION 'Sesi tidak valid.';
  END IF;

  v_branch_id := (SELECT p.branch_id FROM public.profiles p WHERE p.id = v_profile);
  IF v_branch_id IS NULL THEN
    RAISE EXCEPTION 'Akun Anda belum terikat pada cabang.';
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Nominal transaksi harus lebih dari nol.';
  END IF;

  IF NULLIF(btrim(coalesce(p_category, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Kategori transaksi wajib diisi.';
  END IF;

  -- Petty cash wajib melampirkan foto nota (PRD 5.6).
  IF p_type = 'out'::public.cash_flow_type
     AND NULLIF(btrim(coalesce(p_proof_photo_url, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Pengeluaran kas wajib melampirkan foto nota.';
  END IF;

  IF p_shift_handoff_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.shift_handoffs s
       WHERE s.id = p_shift_handoff_id
         AND s.branch_id = v_branch_id
         AND s.status = 'open'::public.shift_handoff_status
    ) THEN
      RAISE EXCEPTION 'Serah terima kas aktif tidak ditemukan pada cabang ini.';
    END IF;
    v_handoff := p_shift_handoff_id;
  ELSE
    SELECT s.id INTO v_handoff
      FROM public.shift_handoffs s
     WHERE s.branch_id = v_branch_id
       AND s.status = 'open'::public.shift_handoff_status
     ORDER BY s.opened_at DESC
     LIMIT 1;
  END IF;

  INSERT INTO public.cash_flow (
    type, amount, category, description,
    payment_method, branch_id, proof_photo_url, created_by, shift_handoff_id
  ) VALUES (
    p_type,
    round(p_amount, 2),
    btrim(p_category),
    nullif(btrim(coalesce(p_description, '')), ''),
    p_payment_method,
    v_branch_id,
    nullif(btrim(coalesce(p_proof_photo_url, '')), ''),
    v_profile,
    v_handoff
  ) RETURNING * INTO v_row;

  RETURN v_row;
END;
$function$;

REVOKE ALL ON FUNCTION public.create_cash_transaction(
  public.cash_flow_type, numeric, text, text, public.payment_method, text, uuid
) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.create_cash_transaction(
  public.cash_flow_type, numeric, text, text, public.payment_method, text, uuid
) TO authenticated;

-- Bucket privat bukti nota kas. Path: <auth_uid>/<timestamp>.webp
insert into storage.buckets (id, name, public)
values ('cash-proofs', 'cash-proofs', false)
on conflict (id) do nothing;

drop policy if exists "cash_proofs_insert_own" on storage.objects;
create policy "cash_proofs_insert_own"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'cash-proofs'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "cash_proofs_select_scoped" on storage.objects;
create policy "cash_proofs_select_scoped"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'cash-proofs'
    and (
      (storage.foldername(name))[1] = (select auth.uid())::text
      or public.has_role(array['owner','admin_kasir','maintainer']::public.user_role[])
    )
  );

drop policy if exists "cash_proofs_delete_own" on storage.objects;
create policy "cash_proofs_delete_own"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'cash-proofs'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

-- ============================================================================
-- E. create_warranty_claim
-- ============================================================================

CREATE OR REPLACE FUNCTION public.create_warranty_claim(
  p_order_id           uuid,
  p_problem_description text,
  p_proof_photo_url    text DEFAULT NULL
)
RETURNS public.warranty_claims
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_profile   uuid;
  v_branch_id uuid;
  v_order     public.orders%rowtype;
  v_warranty  public.warranties%rowtype;
  v_today     date := (now() AT TIME ZONE 'Asia/Jakarta')::date;
  v_row       public.warranty_claims%rowtype;
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN
    RAISE EXCEPTION 'Klaim garansi hanya bisa diajukan oleh pengguna yang sudah masuk.';
  END IF;

  IF NOT COALESCE((SELECT public.has_role(
    ARRAY['owner', 'admin_kasir', 'maintainer']::public.user_role[]
  )), false) THEN
    RAISE EXCEPTION 'Hanya owner, admin kasir, dan maintainer yang bisa mengajukan klaim garansi.';
  END IF;

  v_profile := (SELECT public.current_profile_id());
  IF v_profile IS NULL THEN
    RAISE EXCEPTION 'Sesi tidak valid.';
  END IF;

  v_branch_id := (SELECT p.branch_id FROM public.profiles p WHERE p.id = v_profile);

  IF length(btrim(coalesce(p_problem_description, ''))) < 10 THEN
    RAISE EXCEPTION 'Detail keluhan minimal 10 karakter.';
  END IF;

  SELECT * INTO v_order FROM public.orders o WHERE o.id = p_order_id FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order tidak ditemukan.';
  END IF;

  IF v_order.status <> 'completed'::public.order_status THEN
    RAISE EXCEPTION 'Klaim garansi hanya bisa diajukan untuk order yang sudah selesai.';
  END IF;

  IF v_branch_id IS NULL OR v_order.branch_id <> v_branch_id THEN
    RAISE EXCEPTION 'Order ini bukan milik cabang Anda.';
  END IF;

  SELECT * INTO v_warranty
    FROM public.warranties w
   WHERE w.order_id = p_order_id
   ORDER BY w.created_at DESC
   LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order ini tidak memiliki sertifikat garansi.';
  END IF;

  IF v_warranty.end_date < v_today THEN
    RAISE EXCEPTION 'Masa garansi berakhir pada %s.',
      to_char(v_warranty.end_date, 'DD/MM/YYYY');
  END IF;

  IF v_warranty.status <> 'active'::public.warranty_status THEN
    RAISE EXCEPTION 'Sertifikat garansi berstatus %, tidak dapat diklaim.',
      v_warranty.status;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.warranty_claims c
     WHERE c.order_id = p_order_id
       AND c.status = 'pending'::public.warranty_claim_status
  ) THEN
    RAISE EXCEPTION 'Sudah ada klaim yang sedang diproses untuk order ini.';
  END IF;

  INSERT INTO public.warranty_claims (
    order_id, problem_description, proof_photo_url, status, created_by
  ) VALUES (
    p_order_id,
    btrim(p_problem_description),
    nullif(btrim(coalesce(p_proof_photo_url, '')), ''),
    'pending'::public.warranty_claim_status,
    v_profile
  ) RETURNING * INTO v_row;

  RETURN v_row;
END;
$function$;

REVOKE ALL ON FUNCTION public.create_warranty_claim(uuid, text, text)
  FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.create_warranty_claim(uuid, text, text)
  TO authenticated;

-- Helper untuk expiry harian sertifikat garansi.
CREATE OR REPLACE FUNCTION public.refresh_warranty_statuses()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_count integer;
BEGIN
  UPDATE public.warranties w
     SET status = 'expired'::public.warranty_status,
         updated_at = now()
   WHERE w.status = 'active'::public.warranty_status
     AND w.end_date < (now() AT TIME ZONE 'Asia/Jakarta')::date;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$function$;

REVOKE ALL ON FUNCTION public.refresh_warranty_statuses() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.refresh_warranty_statuses() TO service_role;

-- ============================================================================
-- F. Status akun untuk middleware
--
--    profiles_select memakai current_profile_id() yang sudah menyaring
--    is_active, jadi middleware tidak bisa membedakan akun dinonaktifkan dari
--    akun yang belum punya baris profile. Fungsi ini melewati RLS khusus untuk
--    jawaban tiga kondisi itu, tanpa membocorkan data orang lain.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.current_profile_state()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
  select case
           when (select auth.uid()) is null then 'anonymous'
           when not exists (
                  select 1 from public.profiles p where p.auth_id = auth.uid()
                ) then 'unassigned'
           when (select p.is_active from public.profiles p where p.auth_id = auth.uid())
             then 'active'
           else 'inactive'
         end;
$function$;

REVOKE ALL ON FUNCTION public.current_profile_state() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_profile_state() TO authenticated;

-- ============================================================================
-- G. Perbaikan yang ditemukan lewat uji integrasi
-- ============================================================================

-- G1. guard_order_identity hanya mengizinkan status, completed_at,
--     cancellation_reason, dan updated_at untuk non-manajerial. Karena itu
--     start_order_work() selalu gagal saatkaryawan memulai order:kolom
--     started_by dan started_at termasuk perubahan di luar daftar itu.
--     Ditambahkan ke allowlist, TAPI untuk started_by hanya boleh diisi bila
--     pemanggil benar-benar pemilik order atau anggota timnya.
CREATE OR REPLACE FUNCTION public.guard_order_identity()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_role  public.user_role := (SELECT public.current_user_role());
  v_allow text[] := array[
    'status', 'completed_at', 'cancellation_reason', 'updated_at',
    'payment_state', 'started_by', 'started_at'
  ];
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.order_number  := public.next_order_number();
    NEW.tracking_token := public.new_tracking_token();

    IF (SELECT auth.uid()) IS NOT NULL THEN
      NEW.created_by := (SELECT public.current_profile_id());
      NEW.branch_id  := COALESCE(
        NEW.branch_id,
        (SELECT p.branch_id FROM public.profiles p WHERE p.id = NEW.created_by)
      );
    END IF;

    RETURN NEW;
  END IF;

  IF (SELECT auth.uid()) IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.created_by IS DISTINCT FROM OLD.created_by
     OR NEW.order_number IS DISTINCT FROM OLD.order_number
     OR NEW.tracking_token IS DISTINCT FROM OLD.tracking_token
     OR NEW.branch_id IS DISTINCT FROM OLD.branch_id THEN
    RAISE EXCEPTION
      'Kolom created_by, order_number, tracking_token, dan branch_id pada order tidak dapat diubah.';
  END IF;

  IF v_role IS DISTINCT FROM 'maintainer'::public.user_role THEN
    IF (SELECT public.has_role(ARRAY['owner','admin_kasir']::public.user_role[])) THEN
      v_allow := v_allow || array['assigned_to'];
    END IF;

    -- started_by tidak boleh dipindah ke profil lain oleh non-manajerial.
    IF NEW.started_by IS DISTINCT FROM OLD.started_by THEN
      IF NEW.started_by IS NULL
         OR NEW.started_by IS DISTINCT FROM (SELECT public.current_profile_id()) THEN
        RAISE EXCEPTION
          'Kolom started_by hanya dapat diisi dengan profil pemanggil.';
      END IF;
    END IF;

    IF (to_jsonb(NEW) - v_allow) IS DISTINCT FROM (to_jsonb(OLD) - v_allow) THEN
      RAISE EXCEPTION
        'Kolom order di luar daftar itu hanya dapat diubah oleh owner, admin kasir, atau maintainer.';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

-- G2. create_pos_order_with_hold mengisi cash_hold_amount untuk order unpaid,
--     padahal belum ada uang yang diterima. Akibatnya "Kas Titipan Saya"
--     menjumlahkan tagihan yang belum jadi uang. Kolom kas titipan kini hanya
--     terisi bila order benar-benar dibayar.
CREATE OR REPLACE FUNCTION public.create_pos_order_with_hold(
  p_license_plate   TEXT,
  p_vehicle_model   TEXT,
  p_vehicle_size    public.vehicle_size,
  p_customer_name   TEXT,
  p_customer_phone  TEXT,
  p_service_package TEXT,
  p_items           JSONB,
  p_payment_method  public.payment_method DEFAULT 'cash',
  p_payment_state   TEXT DEFAULT 'paid',
  p_start_work      BOOLEAN DEFAULT FALSE
)
RETURNS public.orders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_profile_id uuid;
  v_role       public.user_role;
  v_is_staff   boolean;
  v_order      public.orders%rowtype;
  v_total      numeric(12,2) := 0;
  v_item       jsonb;
  v_state      public.order_payment_state;
  v_category   text;
  v_holds_cash boolean;
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN
    RAISE EXCEPTION 'Order hanya bisa dibuat oleh pengguna yang sudah masuk.';
  END IF;

  v_profile_id := (SELECT public.current_profile_id());
  IF v_profile_id IS NULL THEN
    RAISE EXCEPTION 'Sesi tidak valid.';
  END IF;

  v_role := (SELECT p.role FROM public.profiles p WHERE p.id = v_profile_id);
  v_is_staff := COALESCE(public.has_role(
    ARRAY['owner', 'admin_kasir', 'maintainer']::public.user_role[]
  ), false);

  IF v_role IS NULL THEN
    RAISE EXCEPTION 'Peran akun tidak dikenali.';
  END IF;

  IF NOT v_is_staff AND v_role <> 'karyawan'::public.user_role THEN
    RAISE EXCEPTION 'Peran Anda tidak berwenang membuat order POS.';
  END IF;

  IF NULLIF(btrim(p_license_plate), '') IS NULL THEN
    RAISE EXCEPTION 'Plat nomor wajib diisi.';
  END IF;

  IF jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Rincian layanan POS tidak boleh kosong.';
  END IF;

  IF lower(COALESCE(p_payment_state, 'paid')) NOT IN ('paid', 'unpaid') THEN
    RAISE EXCEPTION 'Status pembayaran harus paid atau unpaid.';
  END IF;

  v_state := lower(COALESCE(p_payment_state, 'paid'))::public.order_payment_state;

  IF v_is_staff AND v_state = 'unpaid' AND NOT COALESCE(p_start_work, false) THEN
    v_state := 'paid'::public.order_payment_state;
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    IF NOT (v_item ? 'name' AND v_item ? 'price') THEN
      RAISE EXCEPTION 'Setiap item wajib memiliki name dan price.';
    END IF;
    v_total := v_total + round(
      COALESCE((v_item->>'price')::numeric, 0)
      * COALESCE((v_item->>'qty')::numeric, 1), 2);
  END LOOP;

  IF v_total <= 0 THEN
    RAISE EXCEPTION 'Total transaksi harus lebih dari nol.';
  END IF;

  v_category := CASE WHEN v_is_staff THEN 'pos_order' ELSE 'employee_cash_hold' END;

  -- Uang dianggap benar-benar dipegang hanya bila dibayar sekarang.
  v_holds_cash := (NOT v_is_staff) AND v_state = 'paid'::public.order_payment_state;

  INSERT INTO public.orders (
    license_plate, vehicle_model, vehicle_size,
    customer_name, customer_phone, service_package,
    total_price, payment_method, status, payment_state,
    cash_hold_profile_id, cash_hold_amount, cash_hold_payment_method,
    started_by
  ) VALUES (
    upper(nullif(btrim(p_license_plate), '')),
    nullif(btrim(p_vehicle_model), ''),
    p_vehicle_size,
    nullif(btrim(p_customer_name), ''),
    nullif(btrim(p_customer_phone), ''),
    nullif(btrim(p_service_package), ''),
    v_total, p_payment_method,
    CASE WHEN COALESCE(p_start_work, false)
      THEN 'in_progress'::public.order_status
      ELSE 'queued'::public.order_status
    END,
    v_state,
    CASE WHEN v_holds_cash THEN v_profile_id END,
    CASE WHEN v_holds_cash THEN v_total END,
    CASE WHEN v_holds_cash THEN p_payment_method END,
    CASE WHEN COALESCE(p_start_work, false) THEN v_profile_id ELSE NULL END
  ) RETURNING * INTO v_order;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    INSERT INTO public.order_items (order_id, service_id, item_name, price, quantity)
    VALUES (
      v_order.id,
      NULLIF(v_item->>'service_id', '')::uuid,
      v_item->>'name',
      COALESCE((v_item->>'price')::numeric, 0),
      COALESCE((v_item->>'qty')::numeric, 1)
    );
  END LOOP;

  IF v_state = 'paid'::public.order_payment_state THEN
    INSERT INTO public.cash_flow (type, amount, category, description, payment_method)
    VALUES (
      'in'::public.cash_flow_type,
      v_total,
      v_category,
      v_order.order_number || ' - ' || COALESCE(v_order.service_package, '')
        || CASE WHEN v_is_staff THEN ''
                ELSE ' (kas titipan karyawan)' END,
      p_payment_method
    );
  END IF;

  RETURN v_order;
END;
$function$;

-- G3. my_cash_hold_today ikut受影响: sekarang hanya menghitung baris yang
--     benar-benar memegang uang, dan tagihan yang belum dibayar dilaporkan
--     terpisah lewat unpaid_*.
CREATE OR REPLACE FUNCTION public.my_cash_hold_today()
RETURNS TABLE (
  cash_amount     numeric,
  qris_amount     numeric,
  transfer_amount numeric,
  held_total     numeric,
  held_count     bigint,
  unpaid_total   numeric,
  unpaid_count   bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_profile_id uuid;
  v_today      date;
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN
    RAISE EXCEPTION 'Data kas titipan hanya bisa dibaca pengguna yang sudah masuk.';
  END IF;

  v_profile_id := (SELECT public.current_profile_id());
  IF v_profile_id IS NULL THEN
    RAISE EXCEPTION 'Sesi tidak valid.';
  END IF;

  v_today := (now() AT TIME ZONE 'Asia/Jakarta')::date;

  RETURN QUERY
  SELECT
    COALESCE(sum(o.cash_hold_amount) FILTER (WHERE o.cash_hold_payment_method = 'cash'::public.payment_method), 0),
    COALESCE(sum(o.cash_hold_amount) FILTER (WHERE o.cash_hold_payment_method = 'qris'::public.payment_method), 0),
    COALESCE(sum(o.cash_hold_amount) FILTER (WHERE o.cash_hold_payment_method = 'bank_transfer'::public.payment_method), 0),
    COALESCE(sum(o.cash_hold_amount), 0),
    count(*) FILTER (WHERE o.cash_hold_amount IS NOT NULL),
    COALESCE(sum(o.total_price) FILTER (
      WHERE o.payment_state = 'unpaid'::public.order_payment_state
        AND o.created_by = v_profile_id
    ), 0),
    count(*) FILTER (
      WHERE o.payment_state = 'unpaid'::public.order_payment_state
        AND o.created_by = v_profile_id
    )
  FROM public.orders o
  WHERE (o.cash_hold_profile_id = v_profile_id OR o.created_by = v_profile_id)
    AND (o.created_at AT TIME ZONE 'Asia/Jakarta')::date = v_today;
END;
$function$;

-- Perbaikan data yang terlanjur tertulis oleh versi buggy (order unpaid yang
-- sempat punya cash_hold_amount). Idempoten.
UPDATE public.orders o
   SET cash_hold_amount           = NULL,
       cash_hold_payment_method   = NULL
  WHERE o.payment_state = 'unpaid'::public.order_payment_state
    AND o.cash_hold_amount IS NOT NULL;

REVOKE ALL ON FUNCTION public.my_cash_hold_today() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_cash_hold_today() TO authenticated;

REVOKE ALL ON FUNCTION public.create_pos_order_with_hold(
  text, text, public.vehicle_size, text, text, text, jsonb,
  public.payment_method, text, boolean
) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.create_pos_order_with_hold(
  text, text, public.vehicle_size, text, text, text, jsonb,
  public.payment_method, text, boolean
) TO authenticated;