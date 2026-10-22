-- 0058_time_off_decision_actor.sql
--
-- Keputusan izin lewat UPDATE langsung (bukan RPC) tidak mengisi approver_id
-- dan decided_at, karena trigger guard_time_off_decision hanya mengosongkan
-- kolom itu untuk pembatalan. Akibatnya pengajuan bisa tampak "approved" tanpa
-- jejak siapa yang memutuskan dan kapan. Isi kedua kolom dari sesi yang sedang
-- bertindak, bukan dari nilai yang dikirim klien.

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

  -- Jejak keputusan selalu berasal dari sesi yang bertindak.
  IF NEW.status IN ('approved'::public.time_off_status,
                    'rejected'::public.time_off_status) THEN
    NEW.approver_id := (SELECT public.current_profile_id());
    NEW.decided_at := now();
  END IF;

  RETURN NEW;
end;
$function$;
