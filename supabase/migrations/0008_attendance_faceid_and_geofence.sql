-- 0008_attendance_faceid_and_geofence.sql
-- Modul Absensi & Biometrik Face ID (Fase 2 - Bagian B)
-- Non-destruktif & idempoten.
-- Isi:
--   1. Kolom keterlambatan pada attendance_logs (late_minutes, late_reason)
--   2. Bucket penyimpanan foto selfie + policy Storage
--   3. Helper haversine_meters (geofence)
--   4. RPC set_branch_location (owner/maintainer)
--   5. RPC set_face_descriptor (registrasi sampel wajah)
--   6. RPC attendance_check_in / attendance_check_out (validasi server-side)

-- ---------------------------------------------------------------------------
-- 1. Kolom keterlambatan
-- ---------------------------------------------------------------------------
alter table public.attendance_logs
  add column if not exists late_minutes integer;
alter table public.attendance_logs
  add column if not exists late_reason text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'attendance_logs_late_minutes_range'
  ) then
    alter table public.attendance_logs
      add constraint attendance_logs_late_minutes_range
      check (late_minutes is null or late_minutes >= 0);
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Bucket foto absensi (privat) + policy Storage
--    Path disimpan sebagai: <auth_uid>/<timestamp>.webp
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('attendance-photos', 'attendance-photos', false)
on conflict (id) do nothing;

drop policy if exists "attendance_photos_insert_own" on storage.objects;
create policy "attendance_photos_insert_own"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'attendance-photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "attendance_photos_select_scoped" on storage.objects;
create policy "attendance_photos_select_scoped"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'attendance-photos'
    and (
      (storage.foldername(name))[1] = (select auth.uid())::text
      or public.has_role(array['owner','admin_kasir','maintainer']::public.user_role[])
    )
  );

drop policy if exists "attendance_photos_delete_own" on storage.objects;
create policy "attendance_photos_delete_own"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'attendance-photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

-- ---------------------------------------------------------------------------
-- 3. Helper jarak (haversine, meter, radius bumi 6371000 m)
-- ---------------------------------------------------------------------------
create or replace function public.haversine_meters(
  p_lat1 double precision,
  p_lng1 double precision,
  p_lat2 double precision,
  p_lng2 double precision
) returns double precision
language sql
immutable
set search_path to ''
as $function$
  select 6371000.0 * 2 * pg_catalog.asin(
    pg_catalog.sqrt(
      pg_catalog.power(pg_catalog.sin(pg_catalog.radians(p_lat2 - p_lat1) / 2), 2)
      + pg_catalog.cos(pg_catalog.radians(p_lat1))
        * pg_catalog.cos(pg_catalog.radians(p_lat2))
        * pg_catalog.power(pg_catalog.sin(pg_catalog.radians(p_lng2 - p_lng1) / 2), 2)
    )
  );
$function$;

-- ---------------------------------------------------------------------------
-- 4. RPC set_branch_location (owner/maintainer)
-- ---------------------------------------------------------------------------
create or replace function public.set_branch_location(
  p_latitude double precision,
  p_longitude double precision,
  p_radius_meters double precision default null,
  p_branch_id uuid default null
) returns public.branches
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_profile uuid;
  v_target uuid;
  v_row public.branches;
begin
  if not public.has_role(array['owner','maintainer']::public.user_role[]) then
    raise exception 'Hanya owner atau maintainer yang dapat mengatur lokasi cabang.'
      using errcode = '42501';
  end if;

  v_profile := public.current_profile_id();
  v_target := coalesce(
    p_branch_id,
    (select p.branch_id from public.profiles p where p.id = v_profile)
  );

  if v_target is null then
    raise exception 'Cabang tujuan tidak ditemukan.';
  end if;

  if p_latitude is null or p_longitude is null
     or p_latitude < -90 or p_latitude > 90
     or p_longitude < -180 or p_longitude > 180 then
    raise exception 'Koordinat lokasi tidak valid.';
  end if;

  if p_radius_meters is not null and p_radius_meters <= 0 then
    raise exception 'Radius toleransi harus lebih dari 0 meter.';
  end if;

  update public.branches
     set latitude = p_latitude,
         longitude = p_longitude,
         geofence_radius_meters = coalesce(p_radius_meters, geofence_radius_meters),
         updated_at = now()
   where id = v_target
   returning * into v_row;

  if v_row.id is null then
    raise exception 'Cabang tidak ditemukan.';
  end if;

  insert into public.activity_logs (actor_id, action, entity, entity_id, metadata)
  values (
    v_profile, 'branch.location_updated', 'branches', v_row.id,
    jsonb_build_object(
      'latitude', p_latitude,
      'longitude', p_longitude,
      'radius_m', v_row.geofence_radius_meters
    )
  );

  return v_row;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 5. RPC set_face_descriptor (registrasi sampel wajah)
-- ---------------------------------------------------------------------------
create or replace function public.set_face_descriptor(
  p_descriptor double precision[]
) returns boolean
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

  update public.profiles
     set face_descriptor = p_descriptor,
         updated_at = now()
   where id = v_profile;

  insert into public.activity_logs (actor_id, action, entity, entity_id, metadata)
  values (
    v_profile, 'profile.face_registered', 'profiles', v_profile,
    jsonb_build_object('dimensions', v_len)
  );

  return true;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 6a. RPC attendance_check_in
-- ---------------------------------------------------------------------------
create or replace function public.attendance_check_in(
  p_latitude double precision,
  p_longitude double precision,
  p_accuracy_meters double precision default null,
  p_photo_url text default null,
  p_face_similarity_score double precision default null,
  p_late_reason text default null
) returns public.attendance_logs
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
-- 6b. RPC attendance_check_out
-- ---------------------------------------------------------------------------
create or replace function public.attendance_check_out(
  p_latitude double precision,
  p_longitude double precision,
  p_accuracy_meters double precision default null,
  p_photo_url text default null,
  p_face_similarity_score double precision default null
) returns public.attendance_logs
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
  v_date date;
  v_distance double precision;
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

  select b.latitude, b.longitude, b.geofence_radius_meters
    into v_branch_lat, v_branch_lng, v_radius
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

  select * into v_row
    from public.attendance_logs a
   where a.profile_id = v_profile and a.date = v_date;

  if not found or v_row.clock_in is null then
    raise exception 'Belum ada check-in hari ini.';
  end if;
  if v_row.clock_out is not null then
    raise exception 'Anda sudah melakukan check-out hari ini.';
  end if;

  update public.attendance_logs
     set clock_out = now(),
         clock_out_gps_lat = p_latitude,
         clock_out_gps_lng = p_longitude,
         clock_out_gps_accuracy_meters = p_accuracy_meters,
         clock_out_photo_url = p_photo_url,
         clock_out_validation_score = null
   where id = v_row.id
   returning * into v_row;

  insert into public.activity_logs (actor_id, action, entity, entity_id, metadata)
  values (
    v_profile, 'attendance.check_out', 'attendance_logs', v_row.id,
    jsonb_build_object('distance_m', pg_catalog.round(v_distance)::int)
  );

  return v_row;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 7. Hak akses
-- ---------------------------------------------------------------------------
revoke all on function public.haversine_meters(double precision, double precision, double precision, double precision) from public, anon;
revoke all on function public.set_branch_location(double precision, double precision, double precision, uuid) from public, anon;
revoke all on function public.set_face_descriptor(double precision[]) from public, anon;
revoke all on function public.attendance_check_in(double precision, double precision, double precision, text, double precision, text) from public, anon;
revoke all on function public.attendance_check_out(double precision, double precision, double precision, text, double precision) from public, anon;

grant execute on function public.haversine_meters(double precision, double precision, double precision, double precision) to authenticated;
grant execute on function public.set_branch_location(double precision, double precision, double precision, uuid) to authenticated;
grant execute on function public.set_face_descriptor(double precision[]) to authenticated;
grant execute on function public.attendance_check_in(double precision, double precision, double precision, text, double precision, text) to authenticated;
grant execute on function public.attendance_check_out(double precision, double precision, double precision, text, double precision) to authenticated;

grant select, insert, update on public.attendance_logs to authenticated;
