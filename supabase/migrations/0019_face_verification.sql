-- 0019: verifikasi wajah master oleh maintainer.
--
-- PRD 5.4 meminta Maintainer memverifikasi foto awal staf sebelum staf itu
-- diizinkan absensi harian. Sebelumnya tidak ada status verifikasi sama sekali.
-- Migrasi 0009 mengizinkan staf mendaftarkan sampel wajahnya sendiri, sehingga
-- begitu descriptor tersimpan staf langsung bisa absensi tanpa tinjauan siapa pun.
--
-- Yang ditambahkan:
--   1. Status verifikasi pada profil.
--   2. Pendaftaran ulang wajah otomatis mengembalikan status ke pending,
--      sehingga wajah yang sudah disetujui tidak bisa diganti lalu langsung
--      dipakai tanpa ditinjau lagi.
--   3. attendance_check_in menolak profil yang sampel wajahnya belum
--      disetujui.
--
-- Semua pernyataan ditulis idempoten memakai IF NOT EXISTS dan CREATE OR
-- REPLACE, sehingga migrasi aman dijalankan berulang kali.

-- ---------------------------------------------------------------------------
-- 1. Kolom status verifikasi
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (
    select 1 from pg_type where typname = 'face_verification_status'
  ) then
    create type public.face_verification_status as enum ('pending', 'approved', 'rejected');
  end if;
end
$$;

alter table public.profiles
  add column if not exists face_verification public.face_verification_status;
alter table public.profiles
  add column if not exists face_reviewed_by uuid references public.profiles(id) on delete set null;
alter table public.profiles
  add column if not exists face_reviewed_at timestamptz;
alter table public.profiles
  add column if not exists face_review_note text;

comment on column public.profiles.face_verification is
  'Status verifikasi wajah master: pending, approved, atau rejected.';
comment on column public.profiles.face_review_note is
  'Alasan penolakan atau catatan dari maintainer saat menilai sampel wajah.';

-- Profil tanpa sampel wajah dianggap belum terdaftar, bukan pending yang
-- menggantung.
update public.profiles
   set face_verification = case
         when face_descriptor is null then null
         else coalesce(face_verification, 'pending'::public.face_verification_status)
       end
 where face_verification is distinct from (
       case when face_descriptor is null then null
            else coalesce(face_verification, 'pending'::public.face_verification_status) end
     );

-- ---------------------------------------------------------------------------
-- 2. Helper status wajah
-- ---------------------------------------------------------------------------

-- Mengembalikan status verifikasi, dengan fallback pending bila descriptor ada
-- tapi kolomnya belum diisi, mis. oleh data lama sebelum migrasi ini.
create or replace function public.face_status(p_profile_id uuid)
returns public.face_verification_status
language sql
stable
security definer
set search_path to ''
as $function$
  select case
           when p.face_descriptor is null then null
           else coalesce(p.face_verification, 'pending'::public.face_verification_status)
         end
    from public.profiles p
   where p.id = p_profile_id;
$function$;

revoke all on function public.face_status(uuid) from public, anon;
grant execute on function public.face_status(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Pendaftaran ulang wajah mengembalikan status ke pending
-- ---------------------------------------------------------------------------

create or replace function public.set_face_descriptor(p_descriptor double precision[])
returns boolean
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_profile uuid;
  v_len integer;
begin
  v_profile := public.current_profile_id();
  if v_profile is null then
    raise exception 'Profil tidak ditemukan atau tidak aktif.'
      using errcode = '42501';
  end if;

  v_len := array_length(p_descriptor, 1);
  if p_descriptor is null or v_len is null or v_len < 32 then
    raise exception 'Sampel wajah tidak valid.';
  end if;

  -- Wajah yang baru didaftarkan wajib ditinjau ulang. Tanpa baris ini, staf
  -- cukup mendaftarkan wajah baru lalu langsung absensi walaupun wajah
  -- lamanya sudah disetujui.
  update public.profiles
     set face_descriptor      = p_descriptor,
         face_verification    = 'pending'::public.face_verification_status,
         face_reviewed_by     = null,
         face_reviewed_at     = null,
         face_review_note     = null,
         updated_at           = now()
   where id = v_profile;

  insert into public.activity_logs (actor_id, action, entity, entity_id, metadata)
  values (
    v_profile, 'profile.face_registered', 'profiles', v_profile,
    jsonb_build_object('dimensions', v_len, 'status', 'pending')
  );

  return true;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 4. Maintainer menyetujui atau menolak sampel wajah
-- ---------------------------------------------------------------------------

create or replace function public.review_staff_face(
  p_profile_id uuid,
  p_approved boolean,
  p_note text default null::text
)
returns public.profiles
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_reviewer uuid;
  v_target   public.profiles%rowtype;
  v_row      public.profiles%rowtype;
  v_status   public.face_verification_status;
  v_note     text;
begin
  if (select auth.uid()) is null then
    raise exception 'Verifikasi wajah hanya bisa dilakukan pengguna yang sudah masuk.';
  end if;

  v_reviewer := public.current_profile_id();
  if v_reviewer is null then
    raise exception 'Sesi tidak valid.';
  end if;

  -- Hanya maintainer yang menilai wajah master sesuai PRD 5.4.
  if not coalesce((
    select public.has_role(array['maintainer']::public.user_role[])
  ), false) then
    raise exception 'Verifikasi wajah hanya bisa dilakukan oleh maintainer.';
  end if;

  select * into v_target from public.profiles where id = p_profile_id;
  if not found then
    raise exception 'Profil staf tidak ditemukan.';
  end if;

  if v_target.id = v_reviewer then
    raise exception 'Wajah sendiri tidak dapat diverifikasi sendiri.';
  end if;

  if v_target.face_descriptor is null then
    raise exception 'Staf ini belum mendaftarkan sampel wajah.';
  end if;

  if not v_target.is_active then
    raise exception 'Akun staf ini sedang tidak aktif.';
  end if;

  v_status := case
                when p_approved then 'approved'::public.face_verification_status
                else 'rejected'::public.face_verification_status
              end;

  v_note := nullif(btrim(coalesce(p_note, '')), '');

  if not p_approved and v_note is null then
    raise exception 'Penolakan wajib disertai alasan yang bisa dibaca staf.';
  end if;

  update public.profiles
     set face_verification = v_status,
         face_reviewed_by  = v_reviewer,
         face_reviewed_at  = now(),
         face_review_note  = v_note,
         updated_at        = now()
   where id = p_profile_id
  returning * into v_row;

  insert into public.activity_logs (actor_id, action, entity, entity_id, metadata)
  values (
    v_reviewer,
    'profile.face_review.' || v_status::text,
    'profiles',
    p_profile_id,
    jsonb_build_object('status', v_status::text, 'note', v_note)
  );

  -- Kabari staf hasilnya supaya ia tahu harus mendaftarkan ulang.
  insert into public.notifications (recipient_id, title, body, category, payload)
  values (
    p_profile_id,
    case when p_approved
         then 'Wajah Anda disetujui'
         else 'Wajah Anda ditolak' end,
    case when p_approved
         then 'Maintener telah memverifikasi sampel wajah Anda. Anda dapat melakukan absensi.'
         else 'Maintener menolak sampel wajah Anda. Alasan: ' || coalesce(v_note, '-') ||
              '. Silakan mendaftarkan ulang di halaman absensi.' end,
    'account',
    jsonb_build_object('face_status', v_status::text)
  );

  return v_row;
end;
$function$;

revoke all on function public.review_staff_face(uuid, boolean, text) from public, anon;
grant execute on function public.review_staff_face(uuid, boolean, text) to authenticated;

-- Daftar staf yang sampel wajahnya menunggu tinjauan maintainer.
create or replace function public.pending_face_registrations()
returns table(
  profile_id uuid,
  full_name text,
  role public.user_role,
  branch_name text,
  face_verification public.face_verification_status,
  face_review_note text,
  registered_at timestamptz
)
language plpgsql
stable
security definer
set search_path to ''
as $function$
begin
  if (select auth.uid()) is null then
    raise exception 'Daftar verifikasi wajah hanya bisa dibaca pengguna yang sudah masuk.';
  end if;

  if not coalesce((
    select public.has_role(array['maintainer']::public.user_role[])
  ), false) then
    raise exception 'Daftar verifikasi wajah hanya bisa dibaca oleh maintainer.';
  end if;

  return query
  -- profiles.full_name bertipe varchar dan branches.branch_name bertipe varchar,
  -- sedangkan parameter OUT di atas bertipe text. Postgres menolak saat fungsi
  -- dipanggil bila tipenya tidak identik, jadi keduanya dicast eksplisit.
  select p.id,
         p.full_name::text,
         p.role,
         b.branch_name::text,
         coalesce(p.face_verification, 'pending'::public.face_verification_status),
         p.face_review_note::text,
         p.updated_at
    from public.profiles p
    left join public.branches b on b.id = p.branch_id
   where p.face_descriptor is not null
   order by
     case coalesce(p.face_verification, 'pending'::public.face_verification_status)
       when 'pending' then 0
       when 'rejected' then 1
       else 2
     end,
     p.full_name;
end;
$function$;

revoke all on function public.pending_face_registrations() from public, anon;
grant execute on function public.pending_face_registrations() to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Gerbang pada attendance_check_in
-- ---------------------------------------------------------------------------

create or replace function public.attendance_check_in(
  p_latitude double precision,
  p_longitude double precision,
  p_accuracy_meters double precision default null::double precision,
  p_photo_url text default null::text,
  p_face_similarity_score double precision default null::double precision,
  p_late_reason text default null::text
)
returns public.attendance_logs
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_profile uuid;
  v_branch uuid;
  v_branch_lat double precision;
  v_branch_lng double precision;
  v_radius double precision;
  v_open time;
  v_date date;
  v_local_time time;
  v_distance double precision;
  v_late_minutes integer := 0;
  v_reason text;
  v_face_status public.face_verification_status;
  v_existing public.attendance_logs;
  v_row public.attendance_logs;
begin
  v_profile := public.current_profile_id();
  if v_profile is null then
    raise exception 'Profil tidak ditemukan atau tidak aktif.'
      using errcode = '42501';
  end if;

  select p.branch_id into v_branch from public.profiles p where p.id = v_profile;
  if v_branch is null then
    raise exception 'Profil Anda belum terhubung ke cabang.';
  end if;

  -- Wajah harus sudah terdaftar dan disetujui maintainer sebelum absensi.
  -- Tanpa gerbang ini, mendaftarkan sampel wajah sendiri sudah cukup untuk
  -- bisa absensi karena migrasi 0009 mengizinkan pendaftaran mandiri.
  v_face_status := public.face_status(v_profile);

  if v_face_status is null then
    raise exception 'Sampel wajah belum terdaftar. Daftarkan terlebih dahulu pada halaman absensi.'
      using errcode = '42501';
  end if;

  if v_face_status = 'rejected'::public.face_verification_status then
    raise exception 'Sampel wajah Anda ditolak maintainer. Silakan mendaftarkan ulang.'
      using errcode = '42501';
  end if;

  if v_face_status <> 'approved'::public.face_verification_status then
    raise exception 'Sampel wajah Anda belum diverifikasi maintainer.'
      using errcode = '42501';
  end if;

  select b.latitude, b.longitude, b.geofence_radius_meters, b.operating_open_time
    into v_branch_lat, v_branch_lng, v_radius, v_open
    from public.branches b
   where b.id = v_branch;

  if v_branch_lat is null or v_branch_lng is null then
    raise exception 'Koordinat cabang belum dikonfigurasi oleh owner atau maintainer.';
  end if;

  if p_latitude is null or p_longitude is null then
    raise exception 'Koordinat GPS perangkat tidak tersedia.';
  end if;

  v_distance := public.haversine_meters(v_branch_lat, v_branch_lng, p_latitude, p_longitude);
  v_radius := coalesce(v_radius, 30.0);
  if v_distance > v_radius then
    raise exception 'Anda berada % meter dari cabang, di luar radius toleransi % meter.',
      pg_catalog.round(v_distance)::int, pg_catalog.round(v_radius)::int
      using errcode = '22023';
  end if;

  v_date := (now() at time zone 'Asia/Jakarta')::date;
  v_local_time := (now() at time zone 'Asia/Jakarta')::time;
  if v_open is not null and v_local_time > v_open then
    v_late_minutes := greatest(
      0,
      pg_catalog.floor(pg_catalog.date_part('epoch', v_local_time - v_open) / 60)::int
    );
  end if;

  v_reason := nullif(btrim(coalesce(p_late_reason, '')), '');
  if v_late_minutes > 0 and length(coalesce(v_reason, '')) < 5 then
    raise exception 'Alasan keterlambatan wajib diisi (minimal 5 karakter).';
  end if;

  select * into v_existing
    from public.attendance_logs a
   where a.profile_id = v_profile and a.date = v_date;

  if found then
    if v_existing.clock_in is not null then
      raise exception 'Anda sudah melakukan check-in hari ini.';
    else
      raise exception 'Hari ini sudah tercatat kehadiran dengan status %.', v_existing.status;
    end if;
  end if;

  insert into public.attendance_logs (
    profile_id, date, clock_in, gps_lat, gps_lng, gps_accuracy_meters,
    face_photo_url, face_similarity_score, status, notes, late_minutes, late_reason
  ) values (
    v_profile, v_date, now(), p_latitude, p_longitude, p_accuracy_meters,
    p_photo_url, p_face_similarity_score, 'hadir',
    case when v_late_minutes > 0 then v_reason else null end,
    v_late_minutes, v_reason
  )
  returning * into v_row;

  insert into public.activity_logs (actor_id, action, entity, entity_id, metadata)
  values (
    v_profile, 'attendance.check_in', 'attendance_logs', v_row.id,
    jsonb_build_object('late_minutes', v_late_minutes, 'distance_m', pg_catalog.round(v_distance)::int)
  );

  return v_row;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 6. Hanya maintainer yang boleh mengubah kolom verifikasi
-- ---------------------------------------------------------------------------

-- guard_profile_privileges sudah melindungi kolom lain. Kolom verifikasi
-- wajah ditambahkan ke daftar yang diproteksi trigger tersebut.
create or replace function public.guard_profile_privileges()
returns trigger
language plpgsql
set search_path to ''
as $function$
declare
  v_is_privileged boolean;
  v_is_own         boolean;
  v_face_touched    boolean;
begin
  if coalesce(public.current_jwt_role(), '') in ('service_role', 'postgres') then
    return new;
  end if;

  select exists (
    select 1 from public.profiles p
     where p.auth_id = (select auth.uid())
       and p.is_active
       and p.role = 'maintainer'::public.user_role
  ) into v_is_privileged;

  if v_is_privileged then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.role <> 'karyawan'::public.user_role then
      raise exception
        'Pendaftaran mandiri hanya dapat membuat akun dengan role karyawan. Hubungi Maintainer untuk role lain.';
    end if;
    return new;
  end if;

  v_is_own := new.id = public.current_profile_id();

  v_face_touched :=
       new.face_verification is distinct from old.face_verification
    or new.face_reviewed_by  is distinct from old.face_reviewed_by
    or new.face_reviewed_at  is distinct from old.face_reviewed_at
    or new.face_review_note  is distinct from old.face_review_note;

  -- Pemilik profil boleh mendaftarkan ulang sampel wajahnya sendiri, dan itu
  -- harus mengembalikan status ke pending serta mengosongkan kolom peninjau.
  -- Bentuk lain dari perubahan kolom verifikasi tetap ditolak, sehingga staf
  -- tidak dapat menyetujui wajahnya sendiri.
  if v_face_touched and not (
       v_is_own
       and new.face_verification = 'pending'::public.face_verification_status
       and new.face_reviewed_by is null
       and new.face_reviewed_at is null
       and new.face_review_note is null
  ) then
    raise exception
      'Verifikasi wajah hanya dapat diubah oleh maintainer. Pendaftaran ulang sampel wajah sendiri otomatis kembali ke status menunggu.';
  end if;

  if new.role is distinct from old.role
     or new.auth_id is distinct from old.auth_id
     or new.is_active is distinct from old.is_active
     or new.default_off_day is distinct from old.default_off_day
     or new.branch_id is distinct from old.branch_id
     or (
       new.face_descriptor is distinct from old.face_descriptor
       and not v_is_own
     ) then
    raise exception
      'Kolom role, auth_id, is_active, default_off_day, dan branch_id hanya dapat diubah oleh maintainer. Sampel Face ID hanya dapat didaftarkan untuk profil sendiri.';
  end if;

  return new;
end;
$function$;

comment on function public.guard_profile_privileges() is
  'Menjaga kolom hak akses profil. Staf boleh mendaftarkan ulang sampel wajahnya sendiri, yang mengembalikan status verifikasi ke menunggu.';