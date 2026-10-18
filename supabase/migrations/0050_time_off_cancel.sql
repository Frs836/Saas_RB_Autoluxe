-- Pembatalan pengajuan izin, cuti, dan sakit oleh pemohon sendiri.
--
-- Sebelumnya tidak ada RPC pembatalan. Policy time_off_cancel_own_pending di
-- migrasi 0012 sudah mengizinkan pemohon mengubah statusnya sendiri selama
-- masih menunggu, tetapi tidak ada fungsi maupun tombol yang memanggilnya.
-- Halaman izin bahkan menampilkan kalimat "hanya bisa Anda batalkan" tanpa
-- memberi tombol untuk melakukannya.
--
-- Status 'cancelled' ditambahkan supaya penarikan berbeda dari penolakan.
-- Tanpa nilai itu, satu-satunya cara menarik pengajuan adalah menulis status
-- 'rejected', sehingga pengajuan yang ditarik sendiri terlihat sama persis
-- dengan pengajuan yang ditolak atasan di semua daftar dan laporan.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
     WHERE enumtypid = 'public.time_off_status'::regtype
       AND enumlabel = 'cancelled'
  ) THEN
    ALTER TYPE public.time_off_status ADD VALUE 'cancelled';
  END IF;
END
$$;

-- Kolom penarikan dicatat terpisah supaya tidak tertukar dengan penolakan.
alter table public.time_off_requests
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancelled_by uuid references public.profiles(id);

-- Trigger keputusan sebelumnya menolak semua perubahan status selain rejected.
-- Penarikan sekarang lewat jalurnya sendiri.
create or replace function public.guard_time_off_decision()
returns trigger
language plpgsql
set search_path to ''
as $function$
begin
  IF coalesce(public.current_jwt_role(), '') in ('service_role', 'postgres') THEN
    RETURN NEW;
  END IF;

  -- Penarikan oleh pemohon sendiri: status jadi cancelled dan kolom
  -- penolakan dikosongkan.
  IF NEW.status = 'cancelled'::public.time_off_status THEN
    IF OLD.profile_id <> (SELECT public.current_profile_id()) THEN
      RAISE EXCEPTION 'Pengajuan hanya dapat dibatalkan oleh pemohonnya.';
    END IF;
    IF OLD.status <> 'pending'::public.time_off_status THEN
      RAISE EXCEPTION 'Pengajuan ini sudah diputuskan dan tidak dapat ditarik lagi.';
    END IF;
    NEW.approver_id := NULL;
    NEW.decided_at := NULL;
    NEW.cancelled_by := OLD.profile_id;
    NEW.cancelled_at := now();
    RETURN NEW;
  END IF;

  -- Penolakan oleh pemohon sendiri tidak lagi dipakai; ditolak agar tidak ada
  -- dua jalan untuk hal yang sama.
  IF NEW.status = 'rejected'::public.time_off_status THEN
    IF OLD.profile_id = (SELECT public.current_profile_id()) THEN
      RAISE EXCEPTION 'Menarik pengajuan sendiri memakai status batal, bukan ditolak.';
    END IF;
  END IF;

  -- Selain itu hanya owner dan maintainer yang boleh memutuskan.
  IF OLD.profile_id = (SELECT public.current_profile_id()) THEN
    RAISE EXCEPTION 'Pengajuan hanya dapat dibatalkan oleh pemohonnya.';
  END IF;

  IF NOT COALESCE((SELECT public.has_role(
    array['owner', 'maintainer']::public.user_role[]
  )), false) THEN
    RAISE EXCEPTION 'Hanya owner dan maintainer yang bisa memutuskan pengajuan.';
  END IF;

  IF OLD.status <> 'pending'::public.time_off_status THEN
    RAISE EXCEPTION 'Pengajuan ini sudah diputuskan dan tidak dapat diubah lagi.';
  END IF;

  RETURN NEW;
END;
$function$;

-- Pembatalan sebagai fungsi, bukan update langsung dari klien.
create or replace function public.cancel_time_off_request(p_id uuid)
returns public.time_off_requests
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_profile uuid;
  v_row     public.time_off_requests%rowtype;
begin
  v_profile := (SELECT public.current_profile_id());
  IF v_profile IS NULL THEN
    RAISE EXCEPTION 'Sesi tidak valid.';
  END IF;

  SELECT * INTO v_row FROM public.time_off_requests r WHERE r.id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pengajuan tidak ditemukan.';
  END IF;

  IF v_row.profile_id <> v_profile THEN
    RAISE EXCEPTION 'Pengajuan hanya dapat dibatalkan oleh pemohonnya.';
  END IF;

  IF v_row.status <> 'pending'::public.time_off_status THEN
    RAISE EXCEPTION 'Pengajuan ini sudah diputuskan dan tidak dapat ditarik lagi.';
  END IF;

  UPDATE public.time_off_requests
     SET status = 'cancelled'::public.time_off_status,
         cancelled_at = now(),
         cancelled_by = v_profile,
         approver_id = NULL,
         decided_at = NULL
   WHERE id = p_id
  RETURNING * INTO v_row;

  INSERT INTO public.activity_logs (actor_id, action, entity, entity_id, metadata)
  VALUES (
    v_profile, 'time_off.cancel', 'time_off_requests', p_id,
    jsonb_build_object('type', v_row.type, 'start_date', v_row.start_date)
  );

  RETURN v_row;
end;
$function$;

-- Policy lama dituliskan sebagai update ke rejected, jadi tidak lagi dipakai.
drop policy if exists time_off_cancel_own_pending on public.time_off_requests;

revoke all on function public.cancel_time_off_request(uuid) from public;
grant execute on function public.cancel_time_off_request(uuid) to authenticated;