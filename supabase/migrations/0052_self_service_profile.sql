-- Pengaturan akun mandiri: foto profil dan data diri milik staf sendiri.
--
-- Halaman Profil sebelumnya hanya menampilkan data. Staf tidak punya cara
-- memperbarui nama, nomor telepon, atau tanggal lahirnya sendiri, dan tidak
-- bisa mengganti kata sandinya kecuali lewat orang lain. Dua kolom dari
-- formulir pendaftaran (telepon dan tanggal lahir) praktis dikunci selamanya
-- hanya karena tidak ada jalur ubahnya.
--
-- Yang ditambahkan:
--   1. profiles.avatar_path, tempat foto profil disimpan.
--   2. Bucket profile-avatars, publik, mengikuti bucket inspection-photos
--      yang sudah dipakai untuk foto inspeksi.
--   3. Kebijakan storage: staf hanya boleh menulis di foldernya sendiri.
--   4. Pemeriksaan trigger: avatar_path harus berada di folder auth_id
--      pemilik profil, supaya tidak bisa menunjuk ke folder orang lain.
--
-- Kolom yang tetap dikunci trigger yang sudah ada: role, auth_id, is_active,
-- default_off_day, dan branch_id. Staf mengubah dirinya sendiri, bukan
--igibility atau penempatannya.

alter table public.profiles
  add column if not exists avatar_path text;

comment on column public.profiles.avatar_path is
  'Jalur objek di bucket profile-avatars. Awalan folder harus sama dengan auth_id pemilik profil.';

-- Bucket publik: foto profil dipakai untuk daftar staf dan absensi, bukan
-- dokumen sensitif seperti foto absensi atau bukti kas.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'profile-avatars',
  'profile-avatars',
  true,
  2097152,
  array['image/webp', 'image/jpeg', 'image/png']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists profile_avatars_insert_own on storage.objects;
create policy profile_avatars_insert_own
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'profile-avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists profile_avatars_update_own on storage.objects;
create policy profile_avatars_update_own
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'profile-avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  )
  with check (
    bucket_id = 'profile-avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists profile_avatars_delete_own on storage.objects;
create policy profile_avatars_delete_own
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'profile-avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

-- Pemzysan folder mengikuti auth_id pemilik, bukan id profil. auth_id adalah
-- satu-satunya hal yang dijaga trigger yang sudah ada, jadi policies storage
-- dan pemeriksaan di sini memakai nilai yang sama.
create or replace function public.guard_avatar_path()
returns trigger
language plpgsql
set search_path = ''
as $function$
declare
  v_privileged boolean;
begin
  if new.avatar_path is null or new.avatar_path = old.avatar_path then
    return new;
  end if;

  if coalesce(public.current_jwt_role(), '') in ('service_role', 'postgres') then
    return new;
  end if;

  select exists (
    select 1 from public.profiles p
     where p.auth_id = (select auth.uid())
       and p.is_active
       and p.role in ('owner'::public.user_role, 'maintainer'::public.user_role)
  ) into v_privileged;

  if v_privileged then
    return new;
  end if;

  if (storage.foldername(new.avatar_path))[1] is distinct from (select auth.uid())::text then
    raise exception
      'Foto profil hanya dapat menunjuk ke folder milik sendiri.'
      using errcode = '42501';
  end if;

  return new;
end;
$function$;

drop trigger if exists trg_guard_avatar_path on public.profiles;
create trigger trg_guard_avatar_path
  before update of avatar_path on public.profiles
  for each row execute function public.guard_avatar_path();
