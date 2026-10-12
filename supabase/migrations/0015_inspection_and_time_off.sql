-- ============================================================================
-- RB AUTOLUXE - Migrasi 0015: Inspeksi/QC, Pengajuan Izin, Perbaikan QC
-- Proyek: qidtfssldidzvehssevk  |  Tanggal: 2026-10-13
-- Sifat: NON-DESTRUKTIF & IDEMPOTEN.
--
-- Isi:
--   A. Perbaikan apply_order_status
--      - Tidak ada unique constraint pada warranties.order_id padahal fungsi ini
--        memakai `on conflict (order_id) do nothing`. Setiap persetujuan QC
--        berujung pada pembuatan garansi akan gagal dengan SQLSTATE 42P10.
--      - Masa garansi 1 bulan, sedangkan PRD 5.6 dan FLOW 4 meminta 180 hari.
--      - Tidak ada pemeriksaan role sama sekali, sehingga karyawan bisa
--        memindahkan order miliknya sendiri dari qc_review menjadi completed,
--        yaitu persetujuan QC yang seharusnya milik tim manajerial.
--   B. RPC add_order_inspection / delete_order_inspection untuk SOP foto.
--   C. RPC submit_time_off_request dan decide_time_off_request.
--   D. Bucket Storage inspection-photos dan timeoff-proofs beserta policy.
-- ============================================================================

set search_path = public;

-- ============================================================================
-- A. apply_order_status
-- ============================================================================

-- Satu sertifikat garansi per order. Tanpa ini `on conflict (order_id)` pada
-- apply_order_status tidak punya target constraint.
create unique index if not exists warranties_order_id_key
  on public.warranties (order_id);

CREATE OR REPLACE FUNCTION public.apply_order_status(
  p_order_id uuid,
  p_status public.order_status
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
declare
  v_order       public.orders%rowtype;
  v_started     date := (now() at time zone 'Asia/Jakarta')::date;
  v_warranty    text;
  v_officer     boolean;
  v_reviewer    uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'Status order hanya bisa diubah oleh pengguna yang sudah masuk.';
  end if;

  v_officer := coalesce((
    select public.has_role(array['owner', 'admin_kasir', 'maintainer']::public.user_role[])
  ), false);

  select * into v_order from public.orders where id = p_order_id;
  if not found then
    raise exception 'Order tidak ditemukan.';
  end if;

  -- Role non-manajerial boleh menjalankan transisi miliknya sendiri dari
  -- queued ke in_progress lalu ke qc_review. Namun keluar dari qc_review
  -- adalah keputusan mutu dan hanya boleh diambil tim manajerial.
  if p_status <> v_order.status
     and v_order.status in ('qc_review', 'completed')
     and not v_officer then
    raise exception 'Persetujuan dan penolakan QC hanya bisa dilakukan oleh owner, admin kasir, atau maintainer.';
  end if;

  if p_status <> v_order.status then
    if not (
      (v_order.status = 'queued'      and p_status = 'in_progress') or
      (v_order.status = 'in_progress' and p_status = 'qc_review')   or
      (v_order.status = 'qc_review'   and p_status = 'in_progress') or
      (v_order.status = 'qc_review'   and p_status = 'completed')
    ) then
      raise exception 'Status tidak bisa berubah dari % ke %.',
        v_order.status, p_status;
    end if;
  end if;

  update public.orders
     set status = p_status,
         completed_at = case
           when p_status = 'completed' then now()
           when v_order.status = 'completed' then null
           else v_order.completed_at
         end
   where id = p_order_id;

  -- Jejak audit untuk setiap perpindahan status, terutama keputusan QC.
  if p_status <> v_order.status then
    insert into public.activity_logs (actor_id, action, entity, entity_id, metadata)
    values (
      public.current_profile_id(),
      'order.status.' || p_status::text,
      'order',
      p_order_id,
      jsonb_build_object(
        'from', v_order.status,
        'to',   p_status
      )
    );
  end if;

  if p_status <> 'completed' then
    return null;
  end if;

  if not (
    strpos(lower(v_order.service_package), 'coating') > 0
    or strpos(lower(v_order.service_package), 'ceramic') > 0
    or strpos(lower(v_order.service_package), 'liquid glass') > 0
    or strpos(lower(v_order.service_package), 'nano') > 0
  ) then
    return null;
  end IF;

  insert into public.warranties (order_id, warranty_code, start_date, end_date)
  values (
    p_order_id,
    'WRT-' || v_order.order_number,
    v_started,
    v_started + 180
  )
  on conflict (order_id) do nothing
  returning warranty_code into v_warranty;

  if v_warranty is null then
    select w.warranty_code into v_warranty
      from public.warranties w
     where w.order_id = p_order_id;
  end if;

  -- Kabari teknisi unit yang baru selesai diperiksa.
  select o.assigned_to into v_reviewer from public.orders o where o.id = p_order_id;
  if v_reviewer is not null then
    insert into public.notifications (recipient_id, title, body, category, payload)
    values (
      v_reviewer,
      'QC selesai untuk ' || v_order.order_number,
      'Unit ' || v_order.license_plate || ' telah disetujui QC. Sertifikat garansi: ' || coalesce(v_warranty, 'tidak Berlaku untuk layanan ini') || '.',
      'order',
      jsonb_build_object('order_id', p_order_id, 'warranty_code', v_warranty)
    );
  end if;

  return v_warranty;
end;
$function$;

-- ============================================================================
-- B. Inspeksi foto kendaraan
-- ============================================================================

CREATE OR REPLACE FUNCTION public.add_order_inspection(
  p_order_id  uuid,
  p_phase      public.inspection_phase,
  p_photo_path text,
  p_notes      text
)
RETURNS public.order_inspections
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_profile uuid;
  v_row     public.order_inspections%rowtype;
  v_phase    text;
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN
    RAISE EXCEPTION 'Foto inspeksi hanya bisa diunggah pengguna yang sudah masuk.';
  END IF;

  v_profile := (SELECT public.current_profile_id());
  IF v_profile IS NULL THEN
    RAISE EXCEPTION 'Sesi tidak valid.';
  END IF;

  -- Sama dengan policy order_inspections_select_authenticated: teknisi hanya
  -- boleh mengunggah untuk order yang bisa ia lihat.
  IF NOT (SELECT public.can_view_order(p_order_id)) THEN
    RAISE EXCEPTION 'Order ini bukan tugas Anda.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.orders o
     WHERE o.id = p_order_id
       AND o.status IN ('queued', 'in_progress', 'qc_review')
  ) THEN
    RAISE EXCEPTION 'Foto inspeksi hanya bisa diunggah pada order yang sedang dikerjakan.';
  END IF;

  v_phase := lower(COALESCE(p_phase::text, ''));
  IF v_phase NOT IN ('before', 'process', 'after') THEN
    RAISE EXCEPTION 'Tahap inspeksi harus before, process, atau after.';
  END IF;

  IF NULLIF(btrim(COALESCE(p_photo_path, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Foto kondisi kendaraan wajib dilampirkan.';
  END IF;

  IF length(btrim(COALESCE(p_notes, ''))) < 5 THEN
    RAISE EXCEPTION 'Catatan kondisi kendaraan minimal 5 karakter.';
  END IF;

  -- Tahap 'after' hanya sah bila foto 'before' sudah ada. Ini yang menjaga
  -- bukti kondisi kendaraan sebelum pengerjaan tidak bisa dilewati.
  IF v_phase = 'after' AND NOT EXISTS (
    SELECT 1 FROM public.order_inspections i
     WHERE i.order_id = p_order_id
       AND i.phase = 'before'::public.inspection_phase
  ) THEN
    RAISE EXCEPTION 'Foto kondisi awal (before) wajib diunggah lebih dulu.';
  END IF;

  IF (SELECT count(*) FROM public.order_inspections i
       WHERE i.order_id = p_order_id
         AND i.phase = p_phase) >= 5 THEN
    RAISE EXCEPTION 'Maksimal 5 foto per tahap inspeksi.';
  END IF;

  INSERT INTO public.order_inspections (
    order_id, phase, photo_url, notes, inspector_id
  ) VALUES (
    p_order_id, p_phase, btrim(p_photo_path), btrim(p_notes), v_profile
  ) RETURNING * INTO v_row;

  INSERT INTO public.activity_logs (actor_id, action, entity, entity_id, metadata)
  VALUES (
    v_profile, 'inspection.add', 'order', p_order_id,
    jsonb_build_object('phase', v_phase)
  );

  RETURN v_row;
END;
$function$;

CREATE OR REPLACE FUNCTION public.delete_order_inspection(p_inspection_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_profile uuid;
  v_row     public.order_inspections%rowtype;
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN
    RAISE EXCEPTION 'Penghapusan foto inspeksi hanya untuk pengguna yang sudah masuk.';
  END IF;

  v_profile := (SELECT public.current_profile_id());
  IF v_profile IS NULL THEN
    RAISE EXCEPTION 'Sesi tidak valid.';
  END IF;

  SELECT * INTO v_row FROM public.order_inspections WHERE id = p_inspection_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Foto inspeksi tidak ditemukan.';
  END IF;

  -- Maintainer boleh menghapus apa pun untuk koreksi data. Selain itu hanya
  -- pemilik foto sendiri, dan hanya selama order belum selesai.
  IF NOT COALESCE((
    SELECT public.has_role(ARRAY['maintainer']::public.user_role[])
  ), false) THEN
    IF v_row.inspector_id IS DISTINCT FROM v_profile THEN
      RAISE EXCEPTION 'Hanya Maintainer yang bisa menghapus foto inspeksi orang lain.';
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.orders o
       WHERE o.id = v_row.order_id AND o.status = 'completed'::public.order_status
    ) THEN
      RAISE EXCEPTION 'Foto inspeksi order yang sudah selesai tidak bisa dihapus.';
    END IF;
  END IF;

  DELETE FROM public.order_inspections WHERE id = p_inspection_id;
  RETURN true;
END;
$function$;

-- ============================================================================
-- C. Pengajuan izin / cuti / sakit
-- ============================================================================

CREATE OR REPLACE FUNCTION public.submit_time_off_request(
  p_type        public.time_off_type,
  p_start_date  date,
  p_end_date    date,
  p_reason      text,
  p_proof_path  text DEFAULT NULL
)
RETURNS public.time_off_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_profile uuid;
  v_today   date := (now() AT TIME ZONE 'Asia/Jakarta')::date;
  v_row     public.time_off_requests%rowtype;
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN
    RAISE EXCEPTION 'Pengajuan hanya bisa dibuat oleh pengguna yang sudah masuk.';
  END IF;

  v_profile := (SELECT public.current_profile_id());
  IF v_profile IS NULL THEN
    RAISE EXCEPTION 'Sesi tidak valid.';
  END IF;

  IF p_start_date IS NULL OR p_end_date IS NULL THEN
    RAISE EXCEPTION 'Tanggal mulai dan selesai wajib diisi.';
  END IF;

  IF p_end_date < p_start_date THEN
    RAISE EXCEPTION 'Tanggal selesai tidak boleh lebih awal dari tanggal mulai.';
  END IF;

  IF p_start_date < v_today THEN
    RAISE EXCEPTION 'Tanggal mulai tidak boleh di masa lalu.';
  END IF;

  IF (p_end_date - p_start_date) > 90 THEN
    RAISE EXCEPTION 'Durasi pengajuan maksimal 90 hari.';
  END IF;

  IF length(btrim(COALESCE(p_reason, ''))) < 10 THEN
    RAISE EXCEPTION 'Alasan minimal 10 karakter.';
  END IF;

  -- Surat dokter adalah bukti wajib untuk sakit, sesuai FLOW 8.
  IF p_type = 'sakit'::public.time_off_type
     AND NULLIF(btrim(COALESCE(p_proof_path, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Pengajuan sakit wajib melampirkan foto surat dokter.';
  END IF;

  -- Cegah pengajuan tumpang tindih dengan pengajuan yang masih menggantung
  -- atau sudah disetujui, supaya tidak ada dobel Claims atas rentang yang sama.
  IF EXISTS (
    SELECT 1 FROM public.time_off_requests t
     WHERE t.profile_id = v_profile
       AND t.status IN ('pending', 'approved')
       AND t.start_date <= p_end_date
       AND t.end_date   >= p_start_date
  ) THEN
    RAISE EXCEPTION 'Rentang tanggal ini sudah ada pengajuan lain yang masih aktif.';
  END IF;

  INSERT INTO public.time_off_requests (
    profile_id, type, start_date, end_date, reason, proof_photo_url, status
  ) VALUES (
    v_profile, p_type, p_start_date, p_end_date,
    btrim(p_reason),
    nullif(btrim(COALESCE(p_proof_path, '')), ''),
    'pending'::public.time_off_status
  ) RETURNING * INTO v_row;

  -- Beri tahu pemutus di cabang agar pengajuan tidak menunggu ditanya.
  INSERT INTO public.notifications (recipient_id, title, body, category, payload)
  SELECT p.id,
         'Pengajuan ' || p_type::text || ' perlu ditinjau',
         'Ada pengajuan baru bertanggal ' || to_char(p_start_date, 'DD/MM/YYYY') ||
           ' sampai ' || to_char(p_end_date, 'DD/MM/YYYY') || '.',
         'attendance',
         jsonb_build_object('time_off_id', v_row.id)
    FROM public.profiles p
   WHERE p.branch_id = (SELECT pr.branch_id FROM public.profiles pr WHERE pr.id = v_profile)
     AND p.role IN ('owner'::public.user_role, 'maintainer'::public.user_role)
     AND p.is_active;

  RETURN v_row;
END;
$function$;

CREATE OR REPLACE FUNCTION public.decide_time_off_request(
  p_id       uuid,
  p_decision public.time_off_status
)
RETURNS public.time_off_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_profile uuid;
  v_row     public.time_off_requests%rowtype;
  v_requester uuid;
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN
    RAISE EXCEPTION 'Keputusan hanya bisa diambil pengguna yang sudah masuk.';
  END IF;

  v_profile := (SELECT public.current_profile_id());
  IF v_profile IS NULL THEN
    RAISE EXCEPTION 'Sesi tidak valid.';
  END IF;

  -- Policy time_off_decide_privileged juga menyaring, tapi pemeriksaan di sini
  -- membuat pesan error jelas dan menutup jalur lain yang mungkin terlewat.
  IF NOT COALESCE((
    SELECT public.has_role(ARRAY['owner', 'maintainer']::public.user_role[])
  ), false) THEN
    RAISE EXCEPTION 'Persetujuan izin hanya bisa dilakukan oleh owner atau maintainer.';
  END IF;

  IF p_decision NOT IN ('approved', 'rejected') THEN
    RAISE EXCEPTION 'Keputusan harus approved atau rejected.';
  END IF;

  SELECT * INTO v_row FROM public.time_off_requests WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pengajuan tidak ditemukan.';
  END IF;

  IF v_row.status <> 'pending'::public.time_off_status THEN
    RAISE EXCEPTION 'Pengajuan ini sudah diputuskan.';
  END IF;

  IF v_row.profile_id = v_profile THEN
    RAISE EXCEPTION 'Anda tidak boleh memutuskan pengajuan milik sendiri.';
  END IF;

  UPDATE public.time_off_requests
     SET status      = p_decision,
         approver_id = v_profile,
         decided_at  = now()
   WHERE id = p_id
  RETURNING * INTO v_row;

  v_requester := v_row.profile_id;

  INSERT INTO public.activity_logs (actor_id, action, entity, entity_id, metadata)
  VALUES (
    v_profile, 'time_off.' || p_decision::text, 'time_off_request', p_id,
    jsonb_build_object('type', v_row.type::text)
  );

  INSERT INTO public.notifications (recipient_id, title, body, category, payload)
  VALUES (
    v_requester,
    'Pengajuan ' || v_row.type::text || ' ' ||
      CASE WHEN p_decision = 'approved'::public.time_off_status
           THEN 'disetujui' ELSE 'ditolak' END,
    CASE WHEN p_decision = 'approved'::public.time_off_status
      THEN 'Pengajuan Anda tanggal ' || to_char(v_row.start_date, 'DD/MM/YYYY') ||
           ' sampai ' || to_char(v_row.end_date, 'DD/MM/YYYY') || ' telah disetujui.'
      ELSE 'Pengajuan Anda tanggal ' || to_char(v_row.start_date, 'DD/MM/YYYY') ||
           ' sampai ' || to_char(v_row.end_date, 'DD/MM/YYYY') ||
           ' belum disetujui. Alasan: ' || btrim(COALESCE(v_row.reason, '-'))
    END,
    'attendance',
    jsonb_build_object('time_off_id', p_id, 'status', p_decision::text)
  );

  RETURN v_row;
END;
$function$;

-- ============================================================================
-- D. Bucket Storage
-- ============================================================================

-- Foto inspeksi dibaca oleh halaman lacak publik milik pelanggan, jadi bucket
-- ini publik. Rahasianya ada di path: path memuat tracking_token order, jadi
-- tidak bisa ditebak tanpa mengetahui token tersebut.
insert into storage.buckets (id, name, public)
values ('inspection-photos', 'inspection-photos', true)
on conflict (id) do nothing;

drop policy if exists "inspection_photos_insert_own" on storage.objects;
create policy "inspection_photos_insert_own"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'inspection-photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "inspection_photos_update_own" on storage.objects;
create policy "inspection_photos_update_own"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'inspection-photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  )
  with check (
    bucket_id = 'inspection-photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "inspection_photos_delete_own" on storage.objects;
create policy "inspection_photos_delete_own"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'inspection-photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

-- Surat dokter tidak untuk publik. Hanya pemohon dan pemutus yang boleh
-- membacanya, jadi bucket ini privat.
insert into storage.buckets (id, name, public)
values ('timeoff-proofs', 'timeoff-proofs', false)
on conflict (id) do nothing;

drop policy if exists "timeoff_proofs_insert_own" on storage.objects;
create policy "timeoff_proofs_insert_own"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'timeoff-proofs'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "timeoff_proofs_select_scoped" on storage.objects;
create policy "timeoff_proofs_select_scoped"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'timeoff-proofs'
    and (
      (storage.foldername(name))[1] = (select auth.uid())::text
      or public.has_role(array['owner', 'admin_kasir', 'maintainer']::public.user_role[])
    )
  );

-- ============================================================================
-- E. Hak eksekusi
-- ============================================================================

REVOKE ALL ON FUNCTION public.add_order_inspection(uuid, public.inspection_phase, text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.add_order_inspection(uuid, public.inspection_phase, text, text)
  TO authenticated;

REVOKE ALL ON FUNCTION public.delete_order_inspection(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_order_inspection(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.submit_time_off_request(public.time_off_type, date, date, text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_time_off_request(public.time_off_type, date, date, text, text)
  TO authenticated;

REVOKE ALL ON FUNCTION public.decide_time_off_request(uuid, public.time_off_status)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.decide_time_off_request(uuid, public.time_off_status)
  TO authenticated;

REVOKE ALL ON FUNCTION public.apply_order_status(uuid, public.order_status)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.apply_order_status(uuid, public.order_status)
  TO authenticated;